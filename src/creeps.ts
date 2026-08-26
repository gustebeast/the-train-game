import { Destructable, Timer, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS, CreepCamp, CreepUnit } from './creep_camps';
import { mercCampLevel } from './mercenary';
import { registerSaveSegment, parseFields } from './save';
import { awardHeroXP, getSpawnedHeroes, onHeroesSpawned, onAllHeroesDead, spawnHeroes, grantUnsummonToAllPeasants } from './heroes';
import {
  SUMMON_ABILITY_ID, UNSUMMON_ABILITY_ID, FILL_ABILITY_ID, BRIDGE_ABILITY_ID,
  WATER_TRAIN_ABILITY_ID, PEASANT_ID,
} from './constants';
import { isChallengeArmed, completeChallenge } from './challenges';
import { CH_TOUGH_CAMP } from './challengeList';
import { getDPSCheckPlayer, getNeutralAggressive } from './teams';
import { onCampCleared } from './bosskey';
import { TRACK_SIZE } from './track/constants';
import { seededInt } from './rng';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;
const DPS_TEST_DURATION = 30;
/** Creep DPS multiplier — scales creep output above measured hero DPS as a balance constant. */
const CREEP_DPS_ADVANTAGE = 1.1;
/** Creep DPS multiplier when the Tough Creep Camp challenge is armed. */
const TOUGH_CAMP_DPS_ADVANTAGE = 1.5;

/** Whether we're in DPS test mode (inter-round lobby sparring). */
let dpsTestMode = false;

/** Measured hero DPS from the inter-round lobby DPS test. Used for gameplay scaling. */
let measuredHeroDPS = 0;

/** Measured creep DPS from the inter-round lobby DPS test (accounts for hero stuns/spells). */
let measuredCreepDPS = 0;

/** Active DPS test timer (so it can be cancelled early). */
let dpsTestTimer: Timer | null = null;

/** HP each creep started the DPS test with. */
let dpsTestCreepStartHP = 0;

// ---------------------------------------------------------------------------
// Creep camp state — persisted as an index into the flat camp list
// ---------------------------------------------------------------------------

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

/** Standard abilities the map has taken over for its own spells. Any creep
 *  that carries one natively must have it removed on spawn -- see the spawn
 *  loop. Keep in step with the repurposed abilities in compiletime.ts. */
const REPURPOSED_ABILITY_IDS = [
  UNSUMMON_ABILITY_ID,      // RoarNeutralHostile -- 4 creeps carry it
  SUMMON_ABILITY_ID,        // Roar
  FILL_ABILITY_ID,          // UndefinedNeutralHostile
  BRIDGE_ABILITY_ID,        // FingerOfDeathNeutralHostile
  WATER_TRAIN_ABILITY_ID,   // DrunkenHazeChen
];

/** The cage destructable spawned for this round. */
let cageDestructable: Destructable | null = null;

/** The trigger registered on the current cage, so we can clean it up between rounds. */
let cageTrigger: Trigger | null = null;

// ---------------------------------------------------------------------------
// Save/load
// ---------------------------------------------------------------------------

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
  const list: number[] = [];
  for (const [idxStr] of string.gmatch(val, '([^,]+)')) {
    const idx = tonumber(idxStr);
    if (idx != null) list.push(idx);
  }
  encountered[level] = list;
}

/** Decode "i=index;e1=...". A save from before the camp list was flattened
 *  carries "t=<tileset>" and an index into that tileset's camps, which means
 *  something different now; such a save drops its camp state and rolls afresh
 *  rather than pointing at an unrelated camp. */
function decodeCamp(raw: string): void {
  let index: number | null = null;
  let legacy = false;
  for (const [key, val] of pairs(parseFields(raw))) {
    if (key === 't') legacy = true;
    else if (key === 'i') index = tonumber(val) ?? null;
    else if (key === 'e1') decodeMet(1, val);
    else if (key === 'e2') decodeMet(2, val);
    else if (key === 'e3') decodeMet(3, val);
  }
  if (legacy) return;
  campIndex = index;
}

// Reset re-rolls the camp — the new-game baseline is a fresh random pick
/** Start the camp rotation over: nothing has been met, so every unlocked camp
 *  is eligible again. Used by the new-game/reset baseline. */
export function clearCampRotation(): void {
  for (const level of [1, 2, 3]) encountered[level] = [];
}

registerSaveSegment('cc', encodeCamp, decodeCamp, () => {
  clearCampRotation();
  rollCreepCamp();
});
onHeroesSpawned((heroes) => scaleCreepStats(heroes));
onAllHeroesDead(() => removeSpawnedCreeps());

// ---------------------------------------------------------------------------
// Camp selection
// ---------------------------------------------------------------------------

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
  const maxLevel = mercCampLevel();

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

  // Each level keeps its own met-list and finishes its own lap, so running out
  // of unseen camps at one level never changes how often that level is drawn.
  const atLevel: number[] = [];
  for (let i = 0; i < camps.length; i++) {
    if (camps[i].level === level) atLevel.push(i);
  }
  const met = metAtLevel(level);
  let fresh = atLevel.filter(i => !met.includes(i));
  if (fresh.length === 0) {
    // Every camp at this level has been met: wipe THIS level's list only.
    encountered[level] = [];
    fresh = atLevel;
  }

  const chosen = fresh[seededInt(0, fresh.length - 1)];
  metAtLevel(level).push(chosen);
  campIndex = chosen;
}

/** Make the camp waiting for the next round a level 3 one -- what the Strange
 *  Meat buys.
 *
 *  It REPLACES the camp rather than flagging a future roll, because the roll
 *  has already happened: awardVictory rolls the next camp the moment the train
 *  arrives, before anybody reaches the shop. A flag would sit unread until the
 *  round after the one it was bought for.
 *
 *  Prefers a level 3 camp not met yet, so the meat shows you something new
 *  where it can; falls back to any of them once the pool has been round once.
 *  Reads and records against level 3's own met-list, so buying meat spends a
 *  slot in that lap exactly as an ordinary level 3 roll would. */
export function forceLevel3Camp(): boolean {
  const top: number[] = [];
  for (let i = 0; i < CREEP_CAMPS.length; i++) {
    if (CREEP_CAMPS[i].level === 3) top.push(i);
  }
  if (top.length === 0) return false;
  const met = metAtLevel(3);
  let pool = top.filter(i => !met.includes(i));
  if (pool.length === 0) pool = top;
  const chosen = pool[seededInt(0, pool.length - 1)];
  if (!met.includes(chosen)) met.push(chosen);
  campIndex = chosen;
  return true;
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

// ---------------------------------------------------------------------------
// Cage tracking
// ---------------------------------------------------------------------------

/** Clean up the previous cage trigger (if any) without spawning creeps. */
export function cleanupCage(): void {
  if (cageTrigger != null) {
    DestroyTrigger(cageTrigger.handle);
    cageTrigger = null;
  }
  cageDestructable = null;
}

/** Register the cage destructable spawned for this round. */
export function setCage(dest: Destructable): void {
  cageDestructable = dest;
}

// ---------------------------------------------------------------------------
// Creep spawning (3x3 grid around cage position)
// ---------------------------------------------------------------------------

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

/** Spawned creeps for the current round, paired with their camp data. */
let spawnedCreeps: Array<{ unit: Unit; campUnit: CreepUnit }> = [];

/** Spawn creeps around the given world position in a 3x3 grid. Invulnerable until heroes arrive. */
/** Where the current camp's cage stood, so a drop can be placed there after the
 *  cage itself is long gone. */
let campOrigin: { x: number; y: number } | null = null;

export function getCampOrigin(): { x: number; y: number } | null {
  return campOrigin;
}

export function spawnCreepsAt(cx: number, cy: number, camp: CreepCamp): void {
  campOrigin = { x: cx, y: cy };
  const owner = getNeutralAggressive();
  spawnedCreeps = [];
  const creeps = camp.creeps;
  for (let i = 0; i < creeps.length && i < 9; i++) {
    const [dx, dy] = GRID_OFFSETS[i];
    const u = Unit.create(owner, FourCC(creeps[i].id), cx + dx, cy + dy, 270);
    if (u == null) continue;
    u.invulnerable = true;
    // Strip the abilities the map has repurposed for its own spells. Four
    // creeps carry RoarNeutralHostile natively, which is our Unsummon Heroes;
    // its stats are zeroed at compile time so it does nothing for them anyway,
    // and leaving it on means a selected creep shows an "Unsummon Heroes"
    // button. The trigger that acts on it also checks the caster, so this is
    // the second of two locks rather than the only one.
    for (const abilityId of REPURPOSED_ABILITY_IDS) {
      UnitRemoveAbility(u.handle, abilityId);
    }
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_BASE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_NUMBER_OF_DICE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_SIDES_PER_DIE, 0);
    spawnedCreeps.push({ unit: u, campUnit: creeps[i] });
  }
}

/** Remove all spawned creeps (and their corpses). Called when all heroes die,
 *  so the failed camp doesn't leave creeps roaming the map. Not used in DPS
 *  test mode — cancelDPSTest owns creep cleanup there. */
export function removeSpawnedCreeps(): void {
  if (dpsTestMode) return;
  for (const c of spawnedCreeps) {
    if (GetUnitTypeId(c.unit.handle) !== 0) {
      RemoveUnit(c.unit.handle);
    }
  }
  spawnedCreeps = [];
}

// ---------------------------------------------------------------------------
// Stat scaling — called after heroes are summoned
// ---------------------------------------------------------------------------

/** Get average damage per hit for a unit (base + average dice roll). */
function getAvgDamage(u: unit): number {
  const base = BlzGetUnitBaseDamage(u, 0);
  const dice = BlzGetUnitDiceNumber(u, 0);
  const sides = BlzGetUnitDiceSides(u, 0);
  return base + dice * (sides + 1) / 2;
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
  const armor = math.max(0, BlzGetUnitArmor(u));
  return BlzGetUnitMaxHP(u) * (1 + 0.06 * armor);
}


/** Compute DPS and EHP scale factors for creep stat scaling. */
function computeScaleFactors(heroes: Unit[]): { dpsScale: number; ehpScale: number } {
  let creepDPS = 0;
  let creepEHP = 0;
  for (const c of spawnedCreeps) {
    creepDPS += getDPS(c.unit.handle);
    creepEHP += getEffectiveHP(c.unit.handle);
  }

  if (dpsTestMode) {
    const DPS_TEST_HP = 99999;
    dpsTestCreepStartHP = DPS_TEST_HP;
    for (const h of heroes) {
      BlzSetUnitMaxHP(h.handle, DPS_TEST_HP);
      SetUnitState(h.handle, UNIT_STATE_LIFE, DPS_TEST_HP);
    }
    dpsTestTimer = Timer.create();
    dpsTestTimer.start(DPS_TEST_DURATION, false, () => {
      cancelDPSTest();
      for (const h of getSpawnedHeroes()) {
        h.destroy();
      }
    });
    // Factors are unused in test mode — scaleCreepStats splits
    // dpsTestCreepStartHP evenly and leaves creep damage at defaults.
    return { dpsScale: 1, ehpScale: 1 };
  }

  let heroEHP = 0;
  for (const h of heroes) {
    heroEHP += getEffectiveHP(h.handle);
  }
  let heroDPS = measuredHeroDPS;
  if (heroDPS <= 0) {
    for (const h of heroes) heroDPS += getDPS(h.handle);
  }
  const effectiveCreepDPS = measuredCreepDPS > 0 ? measuredCreepDPS : creepDPS;
  const dpsAdvantage = isChallengeArmed(CH_TOUGH_CAMP) ? TOUGH_CAMP_DPS_ADVANTAGE : CREEP_DPS_ADVANTAGE;
  return {
    dpsScale: effectiveCreepDPS > 0 ? (heroDPS * dpsAdvantage) / effectiveCreepDPS : 1,
    ehpScale: creepEHP > 0 ? heroEHP / creepEHP : 1,
  };
}

/** Scale creep stats, remove invulnerability, register death triggers. */
export function scaleCreepStats(heroes: Unit[]): void {
  if (spawnedCreeps.length === 0 || heroes.length === 0) return;

  const { dpsScale, ehpScale } = computeScaleFactors(heroes);

  // Compute XP rewards: use creep level as weight, scale to target total
  const isFirstCamp = heroes.every(h => GetHeroXP(h.handle) === 0);
  const targetXP = isFirstCamp ? FIRST_CAMP_XP : TARGET_XP;
  let levelSum = 0;
  for (const c of spawnedCreeps) {
    levelSum += math.max(1, GetUnitLevel(c.unit.handle));
  }
  const creepXPRewards: number[] = [];
  for (const c of spawnedCreeps) {
    const level = math.max(1, GetUnitLevel(c.unit.handle));
    creepXPRewards.push(math.max(1, math.floor(level / levelSum * targetXP)));
  }

  // Apply scaled stats and remove invulnerability
  for (let i = 0; i < spawnedCreeps.length; i++) {
    const c = spawnedCreeps[i];
    const h = c.unit.handle;

    if (dpsTestMode) {
      // High HP so heroes can't kill them; damage left at defaults to measure actual creep DPS
      const scaledHP = math.max(1, math.floor(dpsTestCreepStartHP / spawnedCreeps.length));
      BlzSetUnitMaxHP(h, scaledHP);
      SetUnitState(h, UNIT_STATE_LIFE, scaledHP);
    } else {
      // DPS-based damage scaling: keep cooldown, scale base damage to match target DPS
      const cd = getCooldown(h);
      const originalDPS = getDPS(h);
      const targetDPS = originalDPS * dpsScale;
      const targetAvgDmg = targetDPS * cd;
      const diceAvg = BlzGetUnitDiceNumber(h, 0) * (BlzGetUnitDiceSides(h, 0) + 1) / 2;
      const scaledDamage = math.max(1, math.floor(targetAvgDmg - diceAvg));

      // EHP-based HP scaling: keep armor, scale raw HP to match target EHP
      const armor = math.max(0, BlzGetUnitArmor(h));
      const armorMultiplier = 1 + 0.06 * armor;
      const scaledHP = math.max(1, math.floor(getEffectiveHP(h) * ehpScale / armorMultiplier));

      BlzSetUnitBaseDamage(h, scaledDamage, 0);
      BlzSetUnitMaxHP(h, scaledHP);
      SetUnitState(h, UNIT_STATE_LIFE, scaledHP);
    }
    BlzSetUnitWeaponIntegerField(h, UNIT_WEAPON_IF_ATTACK_ATTACK_TYPE, 0, 5);
    c.unit.invulnerable = false;

    // Register per-creep death trigger for XP award + item drops (gameplay only)
    if (!dpsTestMode) {
      const xpReward = creepXPRewards[i];
      const drops = c.campUnit.itemDrops;
      const deathTrig = Trigger.create();
      TriggerRegisterUnitEvent(deathTrig.handle, h, EVENT_UNIT_DEATH);
      deathTrig.addAction(() => {
        awardHeroXP(xpReward);
        if (drops != null) {
          for (const drop of drops) {
            // A named drop is taken literally; everything else is a class and
            // a level for the engine to roll.
            const itemId = drop.id != null
              ? FourCC(drop.id)
              : ChooseRandomItemEx(drop.type ?? ITEM_TYPE_PERMANENT, drop.level ?? 1);
            if (itemId !== 0) {
              const dying = GetTriggerUnit()!;
              CreateItem(itemId, GetUnitX(dying), GetUnitY(dying));
            }
          }
        }
        DestroyTrigger(deathTrig.handle);
        // Check if all creeps are dead — grant Unsummon Heroes to peasants
        if (spawnedCreeps.every(c => GetUnitState(c.unit.handle, UNIT_STATE_LIFE) <= 0)) {
          grantUnsummonToAllPeasants();
          completeChallenge(CH_TOUGH_CAMP);
          // A flawless level 3 clear leaves the Strange Key where the cage was.
          const origin = campOrigin;
          const level = getCampData();
          if (origin != null && level != null) onCampCleared(origin.x, origin.y, level.level);
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// DPS test — inter-round lobby sparring to measure real DPS
// ---------------------------------------------------------------------------

/** End the DPS test: measure damage, compute DPS, clean up all state.
 *  Safe to call at any point — handles the case where the timer hasn't started yet. */
export function cancelDPSTest(): void {
  if (dpsTestTimer != null) {
    const elapsed = dpsTestTimer.elapsed;
    dpsTestTimer.destroy();
    dpsTestTimer = null;
    if (elapsed > 0) {
      let totalDamageToCreeps = 0;
      for (const c of spawnedCreeps) {
        const maxHP = BlzGetUnitMaxHP(c.unit.handle);
        const currentHP = GetUnitState(c.unit.handle, UNIT_STATE_LIFE);
        totalDamageToCreeps += maxHP - currentHP;
      }
      measuredHeroDPS = totalDamageToCreeps / elapsed;

      let totalDamageToHeroes = 0;
      for (const h of getSpawnedHeroes()) {
        const maxHP = BlzGetUnitMaxHP(h.handle);
        const currentHP = GetUnitState(h.handle, UNIT_STATE_LIFE);
        totalDamageToHeroes += maxHP - currentHP;
      }
      measuredCreepDPS = totalDamageToHeroes / elapsed;

    }
  }
  // Clean up DPS test creeps so they don't linger into the next round
  if (dpsTestMode) {
    for (const c of spawnedCreeps) {
      c.unit.destroy();
    }
    spawnedCreeps = [];
  }
  dpsTestMode = false;
}

/** Start DPS test: destroy cage to spawn creeps, spawn heroes, let them fight.
 *  Called after inter-round lobby terrain is spawned. */
export function startDPSTest(): void {
  if (cageDestructable == null) return;

  dpsTestMode = true;
  const cageX = cageDestructable.x;
  const cageY = cageDestructable.y;

  // Destroy cage → triggers creep spawn via registerCageTrigger
  cageDestructable.kill();

  // Spawn heroes owned by DPS check player to the left of the 6x3 area
  // spawnHeroes fires onHeroesSpawnedCallback after 1 frame → scaleCreepStats
  const heroX = cageX - 4 * TRACK_SIZE;
  spawnHeroes([getDPSCheckPlayer()], heroX, cageY);
}

// ---------------------------------------------------------------------------
// Cage death trigger
// ---------------------------------------------------------------------------

/** Register a death trigger on the current cage. Call after setCage(). */
export function registerCageTrigger(): void {
  if (cageDestructable == null) return;
  const trig = Trigger.create();
  cageTrigger = trig;
  TriggerRegisterDeathEvent(trig.handle, cageDestructable.handle);
  trig.addAction(() => {
    // Guard: if cleanupCage() already cleared us, do nothing (cage was
    // destroyed as part of map cleanup, not by the player).
    if (cageTrigger !== trig || cageDestructable == null) return;
    const camp = getCampData();
    if (camp == null) return;
    const cx = cageDestructable.x;
    const cy = cageDestructable.y;
    spawnCreepsAt(cx, cy, camp);
    // Grant Summon Heroes ability to the nearest peasant
    // (GetKillingUnit() doesn't work for destructable death events)
    let nearest: unit | null = null;
    let bestDist = math.huge;
    const g = CreateGroup()!;
    GroupEnumUnitsInRange(g, cx, cy, 300, null!);
    ForGroup(g, () => {
      const u = GetEnumUnit()!;
      if (GetUnitTypeId(u) !== PEASANT_ID) return;
      const dx = GetUnitX(u) - cx;
      const dy = GetUnitY(u) - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = u;
      }
    });
    DestroyGroup(g);
    if (nearest != null) {
      UnitAddAbility(nearest, SUMMON_ABILITY_ID);
    }
    cageDestructable = null;
    cageTrigger = null;
    DestroyTrigger(trig.handle);
  });
}
