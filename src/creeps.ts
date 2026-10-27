import { Destructable, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS, CreepCamp, CreepUnit } from './creepCamps';
import { getMercCampLevel, getSpawnedMercUnits } from './mercenary';
import { registerSaveSegment, parseFields, parseNumberList } from './save';
import {
  awardHeroXP, getSpawnedHeroes, onHeroesSpawned, onAllHeroesDead, grantUnsummonToAllPeasants,
} from './heroes';
import {
  SUMMON_ABILITY_ID, PEASANT_SPELL_IDS, PEASANT_ID,
} from './constants';
import { isChallengeArmed, completeChallenge } from './challenges';
import { CH_TOUGH_CAMP } from './challengeList';
import { getNeutralAggressive } from './teams';
import { noteCampCleared, noteCampFightStarted } from './bossKey';
import { TRACK_SIZE } from './track/constants';
import { seededInt } from './rng';
import { isAlive, unitExists, nearestUnitInRange } from './util';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;
/** How much harder than the force a camp hits when the DPS check has not
 *  measured anything to scale from -- a round entered without passing through
 *  the inter-round lobby. The unit-stat estimate it multiplies is a poor one;
 *  the check (dpsCheck.ts) replaces it whenever it has run. */
const CREEP_DPS_ADVANTAGE = 1.1;
/** The same, with the Tough Creep Camp challenge armed. */
const TOUGH_CAMP_DPS_ADVANTAGE = 1.5;

/** The multiplier on the next camp's damage, as the DPS check last set it, or
 *  0 when there is none and the estimate stands in. */
let campDamageScale = 0;

/** Set by the DPS check whenever its estimate moves. 0 clears it. */
export function setCampDamageScale(scale: number): void {
  campDamageScale = scale;
}

export function getCampDamageScale(): number {
  return campDamageScale;
}

const cageBrokenListeners: Array<(this: void) => void> = [];

/** Run cb when a round's cage is broken, just before its creeps appear. */
export function onCageBroken(cb: (this: void) => void): void {
  cageBrokenListeners.push(cb);
}

// --- Creep camp state — persisted as an index into the flat camp list --------

let campIndex: number | null = null;

/** Camp indices already ENCOUNTERED this lap, kept as ONE LIST PER LEVEL.
 *
 *  Encountered, not defeated: a camp counts the moment it is picked, win or
 *  lose, so a camp you keep failing does not sit in front of you forever.
 *
 *  Per level rather than one shared list, because the two rules pull against
 *  each other otherwise. Each level is supposed to come up equally often, but
 *  the levels hold very different numbers of camps; with a single list, the
 *  smallest level runs out of unseen camps first and then stops being drawn,
 *  and the even split quietly becomes uneven near the end of a lap. Each level
 *  now finishes its own lap and wipes its own list, independently of the
 *  others, so the split holds forever. */
const encountered: Record<number, number[]> = {};

function metAtLevel(level: number): number[] {
  let list = encountered[level];
  if (list == null) {
    list = [];
    encountered[level] = list;
  }
  return list;
}

/** The cage destructable spawned for this round. */
let cageDestructable: Destructable | null = null;

/** The trigger registered on the current cage, so we can clean it up between rounds. */
let cageTrigger: Trigger | null = null;

// --- Save/load ---------------------------------------------------------------

/** Encode as "i=index;e1=...;e2=...;e3=..." -- one met-list per level. */
function encodeCamp(): string {
  if (campIndex == null) return '';
  const parts = ['i=' + tostring(campIndex)];
  for (const level of [1, 2, 3]) {
    const met = encountered[level];
    if (met != null && met.length > 0) {
      parts.push('e' + tostring(level) + '=' + met.join(','));
    }
  }
  return table.concat(parts, ';');
}

function decodeMet(level: number, val: string): void {
  encountered[level] = parseNumberList(val);
}

/** Decode "i=index;e1=...". */
function decodeCamp(raw: string): void {
  let index: number | null = null;
  for (const [key, val] of pairs(parseFields(raw))) {
    if (key === 'i') index = tonumber(val) ?? null;
    else if (key === 'e1') decodeMet(1, val);
    else if (key === 'e2') decodeMet(2, val);
    else if (key === 'e3') decodeMet(3, val);
  }
  campIndex = index;
}

/** Start the camp rotation over: nothing has been met, so every unlocked camp
 *  is eligible again. Used by the new-game/reset baseline. */
export function clearCampRotation(): void {
  for (const level of [1, 2, 3]) encountered[level] = [];
}

// The new-game baseline re-rolls the camp: a fresh random pick.
registerSaveSegment('cc', encodeCamp, decodeCamp, () => {
  clearCampRotation();
  rollCreepCamp();
});
onHeroesSpawned((heroes) => scaleCreepStats(heroes));
onAllHeroesDead(() => removeSpawnedCreeps());

// --- Camp selection ----------------------------------------------------------

/** Pick the next creep camp: a seeded draw from the camps you have unlocked
 *  and NOT yet met.
 *
 *  Every pick is recorded in `encountered` whether or not the camp is beaten,
 *  so the rotation works through what is available before repeating anything.
 *  Unlocking a level ADDS to the pool, it does not replace it: level 1 camps
 *  you have not met yet stay eligible alongside the new level 2 ones, and only
 *  meeting a camp takes it out. Meet ALL the level 1 camps first and level 2 is
 *  simply what is left. When nothing eligible remains the whole list clears
 *  together and the rotation starts over.
 *
 *  Within that pool the draw is two-stage -- level first, then camp -- so each
 *  unlocked level comes up equally often regardless of how many camps it has.
 *
 *  campIndex always indexes the full camp list, so saves stay stable. */
export function rollCreepCamp(): void {
  const camps = CREEP_CAMPS;
  if (camps.length === 0) return;
  // One camp level per living mercenary: none -> 1, one -> 2, both -> 3.
  // Losing one really does close its camps again.
  const maxLevel = getMercCampLevel();

  // Draw the LEVEL first, then a camp within it, rather than drawing flat from
  // every eligible camp. The catalogue is lopsided -- far more level 2 camps
  // than level 1 or 3 -- so a flat draw would hand out difficulty in proportion
  // to how many camps the ladder maps happened to contain, which is not a
  // decision anyone made. Two stages give each unlocked level an equal share.
  const levels: number[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    if (camps.some(c => c.level === level)) levels.push(level);
  }
  if (levels.length === 0) return;
  const level = levels[seededInt(0, levels.length - 1)];
  const chosen = drawCampAtLevel(level);
  if (chosen != null) campIndex = chosen;
}

/** Draw a camp of one level not met in its current lap, and record it as met.
 *  Returns its index into CREEP_CAMPS, or null if the level has no camps.
 *
 *  Each level keeps its own met-list and finishes its own lap, so running out
 *  of unseen camps at one level never changes how often that level is drawn:
 *  once every camp at it has been met, THIS level's list is wiped and the
 *  next lap begins with the draw. */
function drawCampAtLevel(level: number): number | null {
  const atLevel: number[] = [];
  for (let i = 0; i < CREEP_CAMPS.length; i++) {
    if (CREEP_CAMPS[i].level === level) atLevel.push(i);
  }
  if (atLevel.length === 0) return null;
  const met = metAtLevel(level);
  let fresh = atLevel.filter(i => !met.includes(i));
  if (fresh.length === 0) {
    encountered[level] = [];
    fresh = atLevel;
  }
  const chosen = fresh[seededInt(0, fresh.length - 1)];
  metAtLevel(level).push(chosen);
  return chosen;
}

/** Make the camp waiting for the next round a level 3 one -- what the Strange
 *  Meat buys.
 *
 *  It REPLACES the camp rather than flagging a future roll, because the roll
 *  has already happened: awardVictory rolls the next camp the moment the train
 *  arrives, before anybody reaches the shop. A flag would sit unread until the
 *  round after the one it was bought for.
 *
 *  Drawn exactly as an ordinary level 3 roll is, from level 3's own lap, so
 *  the meat shows you a camp you have not met where it can and spends a slot
 *  in that lap. */
export function forceLevel3Camp(): boolean {
  const chosen = drawCampAtLevel(3);
  if (chosen == null) return false;
  // The DPS check sees the camp change for itself (dpsCheck.ts describeSubject)
  // and starts over against the new one.
  campIndex = chosen;
  return true;
}

/** Test hook: the camp the next board will cage, by index into CREEP_CAMPS. */
export function setCampForTest(index: number): void {
  campIndex = index;
}

/** Which camp is selected, as an index into CREEP_CAMPS. Exported for the
 *  rotation test, which needs to tell two camps apart. */
export function getCampIndex(): number | null {
  return campIndex;
}

export function getCampData(): CreepCamp | null {
  if (campIndex == null) return null;
  if (campIndex < 0 || campIndex >= CREEP_CAMPS.length) return null;
  return CREEP_CAMPS[campIndex];
}

// --- Cage tracking -----------------------------------------------------------

/** Clean up the previous cage trigger (if any) without spawning creeps. */
export function clearCage(): void {
  if (cageTrigger != null) {
    cageTrigger.destroy();
    cageTrigger = null;
  }
  cageDestructable = null;
}

/** Register the cage destructable spawned for this round. */
export function setCage(dest: Destructable): void {
  cageDestructable = dest;
}

// --- Creep spawning (3x3 grid around cage position) --------------------------

// Grid offsets: top-left, top-center, top-right, mid-left, mid-center, mid-right, bot-left, bot-center, bot-right
const GRID_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-TRACK_SIZE, TRACK_SIZE],   // 1: top-left
  [0, TRACK_SIZE],             // 2: top-center
  [TRACK_SIZE, TRACK_SIZE],    // 3: top-right
  [-TRACK_SIZE, 0],            // 4: mid-left
  [0, 0],                      // 5: mid-center
  [TRACK_SIZE, 0],             // 6: mid-right
  [-TRACK_SIZE, -TRACK_SIZE],  // 7: bot-left
  [0, -TRACK_SIZE],            // 8: bot-center
  [TRACK_SIZE, -TRACK_SIZE],   // 9: bot-right
];

interface SpawnedCreep {
  unit: Unit;
  campUnit: CreepUnit;
  /** Pays XP and drops on death. Kept on the entry so it is destroyed with it:
   *  a creep removed rather than killed (all heroes dead, the board sweep)
   *  fires no death event, so a trigger that only destroyed itself on death
   *  leaked one per creep per failed camp. */
  deathTrig: Trigger | null;
  /** Re-checks the camp when Charm takes this creep; see scaleCreepStats. */
  charmTrig: Trigger | null;
}

/** Spawned creeps for the current round, paired with their camp data. */
let spawnedCreeps: SpawnedCreep[] = [];

/** Forget the spawned creeps, destroying their death triggers. */
function forgetSpawnedCreeps(): void {
  for (const c of spawnedCreeps) {
    if (c.deathTrig != null) c.deathTrig.destroy();
    if (c.charmTrig != null) c.charmTrig.destroy();
  }
  spawnedCreeps = [];
}

/** Where the current camp's cage stood, so a drop can be placed there after the
 *  cage itself is long gone. */
let campOrigin: { x: number; y: number } | null = null;

export function getCampOrigin(): { x: number; y: number } | null {
  return campOrigin;
}

/** Spawn creeps around the given world position in a 3x3 grid. Invulnerable until heroes arrive. */
function spawnCreepsAt(cx: number, cy: number, camp: CreepCamp): void {
  campOrigin = { x: cx, y: cy };
  forgetSpawnedCreeps();
  placeCamp(cx, cy, camp);
}

/** One camp's creeps on the 3x3 grid round (cx, cy), appended to spawnedCreeps. */
function placeCamp(cx: number, cy: number, camp: CreepCamp): void {
  const owner = getNeutralAggressive();
  const creeps = camp.creeps;
  for (let i = 0; i < creeps.length && i < 9; i++) {
    const [dx, dy] = GRID_OFFSETS[i];
    const u = Unit.create(owner, FourCC(creeps[i].id), cx + dx, cy + dy, 270);
    if (u == null) continue;
    prepareCampCreep(u);
    spawnedCreeps.push({ unit: u, campUnit: creeps[i], deathTrig: null, charmTrig: null });
  }
}

/** Ready a freshly made camp creep: invulnerable until the heroes arrive, and
 *  without the map's repurposed spells or a gold bounty. */
function prepareCampCreep(u: Unit): void {
  u.invulnerable = true;
  // Strip the abilities the map has repurposed for its own spells. Four
  // creeps carry RoarNeutralHostile natively, which is our Unsummon Heroes;
  // its stats are zeroed at compile time so it does nothing for them anyway,
  // and leaving it on means a selected creep shows an "Unsummon Heroes"
  // button. The trigger that acts on it also checks the caster, so this is
  // the second of two locks rather than the only one.
  for (const abilityId of PEASANT_SPELL_IDS) {
    UnitRemoveAbility(u.handle, abilityId);
  }
  BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_BASE, 0);
  BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_NUMBER_OF_DICE, 0);
  BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_SIDES_PER_DIE, 0);
}

/** Remove all spawned creeps (and their corpses). Called when all heroes die,
 *  so the failed camp doesn't leave creeps roaming the map. */
function removeSpawnedCreeps(): void {
  for (const c of spawnedCreeps) {
    if (unitExists(c.unit.handle)) {
      RemoveUnit(c.unit.handle);
    }
  }
  forgetSpawnedCreeps();
}

// --- Stat scaling — called after heroes are summoned -------------------------

/** Get average damage per hit for a unit (base + average dice roll). */
function getAvgDamage(u: unit): number {
  return BlzGetUnitBaseDamage(u, 0) + diceAverage(u);
}

/** The average roll of a unit's damage dice, on top of its base damage. */
function diceAverage(u: unit): number {
  return BlzGetUnitDiceNumber(u, 0) * (BlzGetUnitDiceSides(u, 0) + 1) / 2;
}

/** Get effective attack cooldown for a unit. */
function getCooldown(u: unit): number {
  return BlzGetUnitAttackCooldown(u, 0);
}

/** Get DPS for a unit (avg damage / cooldown). */
function getDPS(u: unit): number {
  const cd = getCooldown(u);
  return cd > 0 ? getAvgDamage(u) / cd : 0;
}

/** Effective HP accounting for armor: ehp = hp * (1 + 0.06 * armor).
 *  Armor of 0 is treated as 0 (no bonus). */
function getEffectiveHP(u: unit): number {
  return BlzGetUnitMaxHP(u) * armorMultiplier(u);
}

/** How much further a unit's armour stretches its hit points (negative armour
 *  counted as none). */
function armorMultiplier(u: unit): number {
  return 1 + 0.06 * Math.max(0, BlzGetUnitArmor(u));
}

/** Total HP, effective HP and damage across a set of units.
 *
 *  One place that answers "how strong is this force", so the only question a
 *  caller has to get right is WHICH units it passes. That is where the bug was
 *  when EHP was summed from the heroes alone while DPS covered heroes and
 *  mercenaries together: two copies of the same sum, disagreeing about the
 *  force they were measuring. */
function sumForce(units: Unit[]): { hp: number; ehp: number; dps: number } {
  let hp = 0;
  let ehp = 0;
  let dps = 0;
  for (const u of units) {
    hp += BlzGetUnitMaxHP(u.handle);
    ehp += getEffectiveHP(u.handle);
    dps += getDPS(u.handle);
  }
  return { hp, ehp, dps };
}


/** How much harder than the force a camp hits when only the estimate is to
 *  hand. Tough Camp raises it. Exported for the DPS check, which starts its
 *  search from it. */
export function getCampDPSAdvantage(): number {
  return isChallengeArmed(CH_TOUGH_CAMP) ? TOUGH_CAMP_DPS_ADVANTAGE : CREEP_DPS_ADVANTAGE;
}

/** Everyone fighting on our side in a round: the summoned heroes and any
 *  mercenaries. Difficulty scaling makes no distinction between them. */
function fieldedForce(): Unit[] {
  const all = getSpawnedHeroes();
  for (const m of getSpawnedMercUnits()) all.push(m);
  return all;
}

/**
 * A camp's scale factors against a force: the multiplier on each creep's
 * damage, and the one on its HP.
 *
 * The damage scale is the DPS check's whenever it has one: it is found by
 * fighting this camp against this party for real, at several scales, until the
 * party just barely loses (dpsCheck.ts). HP is then pegged to the force's raw
 * HP -- the check's fights are scaled the same way, so the damage scale it
 * found is the one that goes with it.
 *
 * With no check to hand, the units' own damage stands in, times the advantage,
 * and HP is pegged by EFFECTIVE health, since that estimate takes no armour
 * into its damage.
 */
function roundScaleFactors(creeps: Unit[], force: Unit[]): { dpsScale: number; hpScale: number } {
  const camp = sumForce(creeps);
  const fielded = sumForce(force);
  if (campDamageScale > 0) {
    return { dpsScale: campDamageScale, hpScale: camp.hp > 0 ? fielded.hp / camp.hp : 1 };
  }
  return {
    dpsScale: camp.dps > 0 ? fielded.dps * getCampDPSAdvantage() / camp.dps : 1,
    hpScale: camp.ehp > 0 ? fielded.ehp / camp.ehp : 1,
  };
}

/** The force's health and damage, split by kind. Diagnostics only: it exists so
 *  a test can put a number on how much a mercenary changes the scaling, rather
 *  than the change landing unmeasured. */
export function measureFieldedForce(): {
  heroes: number; mercs: number; heroEHP: number; mercEHP: number;
  heroDPS: number; mercDPS: number; mercsOwnedByHumans: number;
} {
  const heroes = getSpawnedHeroes();
  const mercs = getSpawnedMercUnits();
  const heroTotals = sumForce(heroes);
  const mercTotals = sumForce(mercs);
  let mercsOwnedByHumans = 0;
  for (const m of mercs) {
    if (GetPlayerController(m.owner.handle) === MAP_CONTROL_USER) mercsOwnedByHumans += 1;
  }
  return {
    heroes: heroes.length, mercs: mercs.length,
    heroEHP: heroTotals.ehp, mercEHP: mercTotals.ehp,
    heroDPS: heroTotals.dps, mercDPS: mercTotals.dps,
    mercsOwnedByHumans,
  };
}

/** Whether a creep is out of its camp's fight: dead, or charmed onto our side. */
function isOutOfCamp(u: unit): boolean {
  return !isAlive(u) || GetOwningPlayer(u) !== getNeutralAggressive().handle;
}

/** Set once this camp's clear has been paid, so a charmed creep dying after
 *  the camp was already beaten cannot pay it twice. */
let campBeatenPaid = false;

/** The camp is beaten once every creep in it is dead or charmed: peasants get
 *  Unsummon Heroes, the Tough Camp challenge completes, and a flawless level 3
 *  clear leaves the Strange Key where the cage stood -- however the creeps
 *  were dealt with. */
function checkCampBeaten(): void {
  if (campBeatenPaid) return;
  if (!spawnedCreeps.every(c => isOutOfCamp(c.unit.handle))) return;
  campBeatenPaid = true;
  grantUnsummonToAllPeasants();
  completeChallenge(CH_TOUGH_CAMP);
  const origin = campOrigin;
  const level = getCampData();
  if (origin != null && level != null) noteCampCleared(origin.x, origin.y, level.level);
}

/** Scale creep stats, remove invulnerability, register death triggers. */
export function scaleCreepStats(heroes: Unit[]): void {
  if (spawnedCreeps.length === 0 || heroes.length === 0) return;

  const { dpsScale, hpScale } = roundScaleFactors(spawnedCreeps.map(c => c.unit), fieldedForce());

  // Compute XP rewards: use creep level as weight, scale to target total
  const isFirstCamp = heroes.every(h => GetHeroXP(h.handle) === 0);
  const targetXP = isFirstCamp ? FIRST_CAMP_XP : TARGET_XP;
  let levelSum = 0;
  for (const c of spawnedCreeps) {
    levelSum += Math.max(1, GetUnitLevel(c.unit.handle));
  }
  const creepXPRewards: number[] = [];
  for (const c of spawnedCreeps) {
    const level = Math.max(1, GetUnitLevel(c.unit.handle));
    creepXPRewards.push(Math.max(1, Math.floor(level / levelSum * targetXP)));
  }

  // Apply scaled stats and remove invulnerability
  for (let i = 0; i < spawnedCreeps.length; i++) {
    const c = spawnedCreeps[i];
    const h = c.unit.handle;
    applyRoundScale(c.unit, dpsScale, hpScale);

    // Per-creep death trigger for XP award + item drops
    {
      const xpReward = creepXPRewards[i];
      const drops = c.campUnit.itemDrops;
      const deathTrig = Trigger.create();
      deathTrig.registerUnitEvent(c.unit, EVENT_UNIT_DEATH);
      c.deathTrig = deathTrig;
      deathTrig.addAction(() => {
        // A creep that dies after being charmed died as one of ours: as in the
        // base game, Charm takes the unit instead of its XP and its drops.
        const charmed = GetOwningPlayer(h) !== getNeutralAggressive().handle;
        if (!charmed) awardHeroXP(xpReward);
        if (drops != null && !charmed) {
          for (const drop of drops) {
            // A named drop is taken literally; everything else is a class and
            // a level for the engine to roll.
            const itemId = drop.id != null
              ? FourCC(drop.id)
              : ChooseRandomItemEx(drop.type ?? ITEM_TYPE_PERMANENT, drop.level ?? 1);
            if (itemId !== 0) CreateItem(itemId, GetUnitX(h), GetUnitY(h));
          }
        }
        checkCampBeaten();
      });
      // Charm takes a creep out of the camp without a death, and the camp is
      // beaten all the same once nothing in it still fights for it. Kept on
      // the entry like the death trigger, for the same reason: a creep removed
      // uncharmed never fires it.
      const charmTrig = Trigger.create();
      charmTrig.registerUnitEvent(c.unit, EVENT_UNIT_CHANGE_OWNER);
      c.charmTrig = charmTrig;
      charmTrig.addAction(() => checkCampBeaten());
    }
  }
  campBeatenPaid = false;
}

/** Scale one camp creep and let it fight. */
function applyRoundScale(u: Unit, dpsScale: number, hpScale: number): void {
  const h = u.handle;
  // DPS-based damage scaling: keep cooldown, scale base damage to match target DPS
  const cd = getCooldown(h);
  const targetAvgDmg = getDPS(h) * dpsScale * cd;
  const scaledDamage = Math.max(1, Math.floor(targetAvgDmg - diceAverage(h)));
  const scaledHP = Math.max(1, Math.floor(BlzGetUnitMaxHP(h) * hpScale));

  BlzSetUnitBaseDamage(h, scaledDamage, 0);
  BlzSetUnitMaxHP(h, scaledHP);
  SetUnitState(h, UNIT_STATE_LIFE, scaledHP);
  BlzSetUnitWeaponIntegerField(h, UNIT_WEAPON_IF_ATTACK_ATTACK_TYPE, 0, 5);
  u.invulnerable = false;
}

/** The current camp's creeps around (cx, cy), unscaled and invulnerable, with
 *  the map's own spells stripped. The caller's alone: none is in
 *  spawnedCreeps, and nothing a round's camp carries -- XP, drops, the
 *  camp-beaten check -- is attached. */
export function spawnUnscaledCampCopy(cx: number, cy: number): Unit[] {
  const camp = getCampData();
  const creeps: Unit[] = [];
  if (camp == null) return creeps;
  for (let i = 0; i < camp.creeps.length && i < 9; i++) {
    const [dx, dy] = GRID_OFFSETS[i];
    const u = Unit.create(getNeutralAggressive(), FourCC(camp.creeps[i].id), cx + dx, cy + dy, 270);
    if (u == null) continue;
    prepareCampCreep(u);
    creeps.push(u);
  }
  return creeps;
}

/** One copy of the current camp at (cx, cy), scaled against `force` as a round
 *  scales it but with the damage scale given: the DPS check's fights, each
 *  trying a scale of its own. */
export function spawnCampCopy(cx: number, cy: number, force: Unit[], dpsScale: number): Unit[] {
  const creeps = spawnUnscaledCampCopy(cx, cy);
  const campHP = sumForce(creeps).hp;
  const hpScale = campHP > 0 ? sumForce(force).hp / campHP : 1;
  for (const u of creeps) applyRoundScale(u, dpsScale, hpScale);
  return creeps;
}

// --- Cage death trigger ------------------------------------------------------

/** Register a death trigger on the current cage. Call after setCage(). */
export function registerCageTrigger(): void {
  if (cageDestructable == null) return;
  const trig = Trigger.create();
  cageTrigger = trig;
  TriggerRegisterDeathEvent(trig.handle, cageDestructable.handle);
  trig.addAction(() => {
    // Guard: if clearCage() already cleared us, do nothing (cage was
    // destroyed as part of map cleanup, not by the player).
    if (cageTrigger !== trig || cageDestructable == null) return;
    const camp = getCampData();
    if (camp == null) return;
    const cx = cageDestructable.x;
    const cy = cageDestructable.y;
    // The DPS check settles its estimate here, before the camp is scaled.
    for (const cb of cageBrokenListeners) cb();
    spawnCreepsAt(cx, cy, camp);
    noteCampFightStarted(camp.level);
    // Grant Summon Heroes ability to the nearest peasant
    // (GetKillingUnit() doesn't work for destructable death events)
    const nearest = nearestUnitInRange(cx, cy, 300, u => GetUnitTypeId(u) === PEASANT_ID);
    if (nearest != null) {
      UnitAddAbility(nearest, SUMMON_ABILITY_ID);
    }
    cageDestructable = null;
    cageTrigger = null;
    trig.destroy();
  });
}
