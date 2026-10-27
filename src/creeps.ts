import { Destructable, Timer, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS, CreepCamp, CreepUnit } from './creepCamps';
import {
  getMercCampLevel, spawnMercsForOwner, getSpawnedMercUnits, removeSpawnedMercUnits,
  spawnMercFromData, getLivingMercData,
} from './mercenary';
import { registerSaveSegment, parseFields } from './save';
import {
  awardHeroXP, getSpawnedHeroes, onHeroesSpawned, onAllHeroesDead, spawnHeroes,
  grantUnsummonToAllPeasants, hasHeroes, clearSpawnedHeroUnits,
  spawnHeroFromData, getChosenHeroData,
} from './heroes';
import {
  SUMMON_ABILITY_ID, UNSUMMON_ABILITY_ID, FILL_ABILITY_ID, BRIDGE_ABILITY_ID,
  WATER_TRAIN_ABILITY_ID, PEASANT_ID,
} from './constants';
import { isChallengeArmed, completeChallenge } from './challenges';
import { CH_TOUGH_CAMP } from './challengeList';
import { getDPSCheckPlayer, getNeutralAggressive } from './teams';
import { onCampCleared, onCampFightStarted } from './bossKey';
import { TRACK_SIZE } from './track/constants';
import { seededInt } from './rng';
import { forEachUnitOfPlayer, isAlive, unitExists, forEachUnitInRange, removeUnitsSummonsFirst } from './util';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;
/** How long a sparring match runs. Exported so tests wait on it rather than on
 *  a number of their own. */
export const SPARRING_DURATION = 30;

/**
 * The sparring match is fought six times over, at once, and measured as one.
 *
 * A single match is a noisy measurement. Whether the camp's spells land on a
 * hero or on a heavily armoured mercenary, which unit ends up in front, how
 * many casts happen in the window -- each swings the result, and repeat runs
 * of the same party against the same camp read anywhere from 1.4 to 3.4.
 * Six copies, summed, average most of that out: measured at six, the combined
 * result moved by about 5-10% between runs instead.
 *
 * Each copy approaches its camp from a different side, so the average is over
 * who gets hit first rather than six repeats of one arrangement. The top copy
 * of each strip tilts up, the bottom one down, the middle stays level: a tilt
 * toward a neighbour walks the heroes into its camp.
 *
 * Where they stand matters as much as how many:
 *   - out in the two walkable strips either side of the lobby's water, which
 *     no player can see. The walkable board is only x +-2624 by y +-1344;
 *     north and south of that is unwalkable boundary, and units placed there
 *     are shoved hundreds of units away before the fight begins;
 *   - 950 apart, which kept copies from fighting each other's camps;
 *   - NOT in the lobby's sparring corner, where the single match used to be.
 *     That camp sat jammed against the board edge, which favoured the heroes:
 *     the same fight measured about 1.6x stronger there than on open ground,
 *     and the next camp was scaled to match.
 *
 * Every copy belongs to the one check player. It is the only slot the map sets
 * up as a computer player, and an AI started in any other slot never casts --
 * which is half of what the match exists to measure.
 */
const SPARRING_COPIES: ReadonlyArray<{ x: number; y: number; approach: number }> = [
  { x: -1984, y: -950, approach: 210 },
  { x: -1984, y: 0, approach: 0 },
  { x: -1984, y: 950, approach: 150 },
  { x: 2048, y: -950, approach: 330 },
  { x: 2048, y: 0, approach: 180 },
  { x: 2048, y: 950, approach: 30 },
];
/**
 * The shortest sparring match whose result is kept as it is.
 *
 * Measured by cutting real matches short: before about 8 seconds the opening
 * dominates and the result is off by 2-6x; by 10 the typical error is about a
 * quarter, and a full 30 seconds only improves that to about a sixth. The ready
 * countdown waits for it -- see sparringSecondsToMinimum.
 */
export const SPARRING_MIN_SECONDS = 10;
/** How far from its camp each copy's party starts. */
const SPARRING_APPROACH = 4 * TRACK_SIZE;
/** How far one of the match's units may wander from its own copy before it is
 *  sent back. The check player's AI picks camps to attack for itself, and with
 *  six on the map it occasionally sends a party at a neighbour's. */
const SPARRING_LEASH = 700;
/** Creep DPS multiplier — scales creep output above measured hero DPS as a balance constant. */
const CREEP_DPS_ADVANTAGE = 1.1;
/** Creep DPS multiplier when the Tough Creep Camp challenge is armed. */
const TOUGH_CAMP_DPS_ADVANTAGE = 1.5;

/** Whether the inter-round lobby's sparring match is running. */
let sparringActive = false;

/** Measured hero DPS from the lobby's sparring match. Used for gameplay scaling. */
let measuredHeroDPS = 0;

/** Measured creep DPS from the lobby's sparring match (accounts for hero stuns/spells). */
let measuredCreepDPS = 0;

/** The running sparring match's timer, so it can be cancelled early. */
let sparringTimer: Timer | null = null;

/** HP each creep started the sparring match with. */
let sparringCreepStartHP = 0;

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
  // The lobby is very likely measuring the camp this just replaced, so the
  // measurement has to follow the camp. Here rather than at the call site, so a
  // future way of changing the camp cannot forget to.
  restartSparringMatch();
  return true;
}

/** Which camp is selected, as an index into CREEP_CAMPS. Exported for the
 *  rotation test, which needs to tell two camps apart. */
/** Test hook: the camp the next board will cage, by index into CREEP_CAMPS. */
export function setCampForTest(index: number): void {
  campIndex = index;
}

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
    cageTrigger.destroy();
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
  naturalHP.clear();
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
  // The sparring match puts the camp down once per copy, out in the strips;
  // the cage only says where it would have been, which restarts still need.
  if (sparringActive) {
    for (const c of SPARRING_COPIES) placeCamp(c.x, c.y, camp);
  } else {
    placeCamp(cx, cy, camp);
  }
}

/** Each spawned creep's own max HP before anything rigged or scaled it, by
 *  handle id. The sparring match needs it after rigging has replaced it. */
const naturalHP = new Map<number, number>();

/** One camp's creeps on the 3x3 grid round (cx, cy), appended to spawnedCreeps. */
function placeCamp(cx: number, cy: number, camp: CreepCamp): void {
  const owner = getNeutralAggressive();
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
    naturalHP.set(GetHandleId(u.handle), BlzGetUnitMaxHP(u.handle));
    spawnedCreeps.push({ unit: u, campUnit: creeps[i], deathTrig: null, charmTrig: null });
  }
}

/** Remove all spawned creeps (and their corpses). Called when all heroes die,
 *  so the failed camp doesn't leave creeps roaming the map. Not used in DPS
 *  test mode — cancelSparringMatch owns creep cleanup there. */
function removeSpawnedCreeps(): void {
  if (sparringActive) return;
  for (const c of spawnedCreeps) {
    if (unitExists(c.unit.handle)) {
      RemoveUnit(c.unit.handle);
    }
  }
  forgetSpawnedCreeps();
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

/** Total effective HP and damage across a set of units.
 *
 *  One place that answers "how strong is this force", so the only question a
 *  caller has to get right is WHICH units it passes. That is where the bug was
 *  when EHP was summed from the heroes alone while DPS covered heroes and
 *  mercenaries together: two copies of the same sum, disagreeing about the
 *  force they were measuring. */
function sumForce(units: Unit[]): { ehp: number; dps: number } {
  let ehp = 0;
  let dps = 0;
  for (const u of units) {
    ehp += getEffectiveHP(u.handle);
    dps += getDPS(u.handle);
  }
  return { ehp, dps };
}


/** How much harder than the force a camp is allowed to hit. Tough Camp raises
 *  it; everything that quotes or applies the damage scale asks here. */
function currentDpsAdvantage(): number {
  return isChallengeArmed(CH_TOUGH_CAMP) ? TOUGH_CAMP_DPS_ADVANTAGE : CREEP_DPS_ADVANTAGE;
}

/** Compute DPS and EHP scale factors for creep stat scaling. */
function computeScaleFactors(): { dpsScale: number; ehpScale: number } {
  let creepDPS = 0;
  let creepEHP = 0;
  for (const c of spawnedCreeps) {
    creepDPS += getDPS(c.unit.handle);
    creepEHP += getEffectiveHP(c.unit.handle);
  }

  if (sparringActive) {
    sparringCreepStartHP = SPARRING_HP;
    // What one camp and one copy of the party are worth BEFORE rigging, for
    // crediting a creep taken out early (see removalCredit). Copy 0 is the
    // roster's own units; every copy is the same party.
    sparringForceEHP = sumForce([...getSpawnedHeroes(), ...getSpawnedMercUnits()]).ehp;
    let campEHP = 0;
    for (const c of spawnedCreeps) campEHP += getEffectiveHP(c.unit.handle);
    sparringCampEHP = campEHP / SPARRING_COPIES.length;
    sparringRemovals = 0;
    sparringRemovalCredit = 0;
    // Mercenaries too: one that dies mid-match stops dealing damage and stops
    // taking it, quietly biasing both numbers.
    for (const h of fieldedForce()) {
      BlzSetUnitMaxHP(h.handle, SPARRING_HP);
      SetUnitState(h.handle, UNIT_STATE_LIFE, SPARRING_HP);
    }
    // Sampling does NOT start here. Only OUR side has been rigged at this
    // point; the creeps are still on their natural HP and do not get their
    // 99999-between-them pool until scaleCreepStats applies it, a hundred
    // lines below. Baselining them here recorded a creep at, say, 500 HP and
    // then read the jump to 33000 as 32500 HP of damage DEALT -- per creep,
    // in the first quarter-second. That made measuredHeroDPS large and
    // NEGATIVE, and since the camp's damage multiplier is
    // (our DPS x advantage) / creep DPS, it came out negative too and every
    // creep in the next round was floored at minimum damage.
    // startMatchSampling() is called at the end of scaleCreepStats instead,
    // once both sides are actually rigged.
    // Factors are unused in test mode -- scaleCreepStats splits
    // sparringCreepStartHP evenly and leaves creep damage at defaults.
    return { dpsScale: 1, ehpScale: 1 };
  }

  // Heroes AND mercenaries, on both axes. The measured DPS already covered the
  // whole force -- it is taken from damage the creeps took, whoever dealt it --
  // but EHP had no measured counterpart and was summed from the heroes alone,
  // so a camp's HP was pegged to a force smaller than the one it would meet.
  // That made every camp easier the better your mercenary was, on every round
  // rather than only before the first measurement.
  const fielded = sumForce(fieldedForce());
  const forceEHP = fielded.ehp;
  // The measured figure when there is one: it is taken from damage the creeps
  // took, so it already covers whoever dealt it. Before the first match there
  // is nothing to measure, and the units' own damage stands in.
  const forceDPS = measuredHeroDPS > 0 ? measuredHeroDPS : fielded.dps;
  const effectiveCreepDPS = measuredCreepDPS > 0 ? measuredCreepDPS : creepDPS;
  return {
    dpsScale: effectiveCreepDPS > 0 ? (forceDPS * currentDpsAdvantage()) / effectiveCreepDPS : 1,
    ehpScale: creepEHP > 0 ? forceEHP / creepEHP : 1,
  };
}

/** What the last match's sampling actually saw, in raw HP.
 *
 *  measuredCreepDPS is the denominator of the whole difficulty scale, so when a
 *  camp comes out absurdly hard or absurdly soft this is where the answer is:
 *  how much of our side's HP loss was taken by the force, and how much by
 *  summons standing in front of it. */
export function dpsSampleBreakdown(): {
  creepHPLost: number; ourHPLost: number; summonHPLost: number;
  removals: number; removalCredit: number;
} {
  return {
    creepHPLost, ourHPLost, summonHPLost,
    removals: sparringRemovals, removalCredit: sparringRemovalCredit,
  };
}

/** What the last completed match measured, and what it is doing to the next
 *  camp. Printed by -dpsnumbers.
 *
 *  scale is the multiplier applied to every creep's damage: 1 leaves them at
 *  their ladder values, 3 triples them. A number far from 1 means the match
 *  measured something lopsided. It uses the same advantage the next camp will
 *  get, so it is honest with Tough Camp armed. */
export function getDpsMeasured(): { heroDPS: number; creepDPS: number; scale: number } {
  return {
    heroDPS: measuredHeroDPS,
    creepDPS: measuredCreepDPS,
    scale: measuredCreepDPS > 0 ? measuredHeroDPS * currentDpsAdvantage() / measuredCreepDPS : 0,
  };
}

/** The same three numbers as lines, for -dpsnumbers to print. */
export function getDpsMeasurementReport(): string[] {
  const measured = getDpsMeasured();
  const lines: string[] = [];
  lines.push('Our DPS (measured): ' + I2S(R2I(measured.heroDPS)));
  lines.push('Creep DPS (measured): ' + I2S(R2I(measured.creepDPS)));
  lines.push('HP taken off the creeps: ' + I2S(R2I(creepHPLost)));
  if (sparringRemovals > 0) {
    lines.push('  of which ' + I2S(sparringRemovals) + ' creep(s) charmed or killed outright, credited '
      + I2S(R2I(sparringRemovalCredit)));
  }
  lines.push('HP taken off our side: ' + I2S(R2I(ourHPLost))
    + ' (of which summons took ' + I2S(R2I(summonHPLost)) + ')');
  if (measured.creepDPS > 0) {
    lines.push('=> creep damage scale: ' + I2S(R2I(measured.scale * 100)) + '%');
  } else {
    lines.push('=> no creep DPS measured; scaling falls back to the estimate');
  }
  return lines;
}

/** How many units the check player still owns. Zero except while a match is
 *  running: anything the match brings on -- heroes, mercenaries, and whatever
 *  they summon -- belongs to it, so this is what "the field is clear" means. */
export function getCheckPlayerUnitCount(): number {
  let n = 0;
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, () => { n += 1; });
  return n;
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
  if (origin != null && level != null) onCampCleared(origin.x, origin.y, level.level);
}

/** Scale creep stats, remove invulnerability, register death triggers. */
export function scaleCreepStats(heroes: Unit[]): void {
  if (spawnedCreeps.length === 0 || heroes.length === 0) return;

  const { dpsScale, ehpScale } = computeScaleFactors();

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

    if (sparringActive) {
      // High HP so heroes can't kill them; damage left at defaults to measure actual creep DPS
      // Split per CAMP: spawnedCreeps holds every copy's creeps, and dividing
      // the pool by all of them would leave each creep a sixth of its share.
      const perCamp = math.max(1, spawnedCreeps.length / SPARRING_COPIES.length);
      const scaledHP = math.max(1, math.floor(sparringCreepStartHP / perCamp));
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
    if (!sparringActive) {
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

  // Both sides are rigged now, so a baseline taken here is honest. Anything
  // earlier reads one side's rigging as the other side's damage.
  if (sparringActive) startMatchSampling();
}

// ---------------------------------------------------------------------------
// The sparring match: the inter-round lobby fight that measures real DPS
// ---------------------------------------------------------------------------

/** End the sparring match: measure damage, compute DPS, clean up all state.
 *  Safe to call at any point — handles the case where the timer hasn't started yet. */
export function cancelSparringMatch(): void {
  teardownSparringMatch(true);
}

/** Tear the match down. `record` says whether its numbers are worth keeping.
 *
 *  They are not, if the match was measuring a camp that is no longer the camp
 *  you will face -- see restartSparringMatch. */
function teardownSparringMatch(record: boolean): void {
  if (sparringTimer != null) {
    const elapsed = sparringTimer.elapsed;
    sparringTimer.destroy();
    sparringTimer = null;
    if (record && elapsed > 0) {
      sampleDPS();   // bank whatever landed since the last sample
      // Per copy, so "DPS" keeps meaning one party's against one camp. The
      // ratio between the two -- all the scaling uses -- is unchanged by it.
      measuredHeroDPS = creepHPLost / elapsed / SPARRING_COPIES.length;
      measuredCreepDPS = ourHPLost / elapsed / SPARRING_COPIES.length;
    }
  }
  // Clean up the sparring creeps so they don't linger into the next round
  stopDPSSampling();
  if (sparringActive) {
    for (const c of spawnedCreeps) {
      c.unit.destroy();
    }
    forgetSpawnedCreeps();
    // Order matters twice over. Summons go first: one whose summoner has
    // already been removed cannot be, and a Far Seer's wolves survived every
    // match that way. And the mercenary's kit is snapshotted off its live
    // unit, so that happens before the sweep removes it.
    clearCheckPlayerSummons();
    removeSpawnedMercUnits();
    clearSpawnedHeroUnits();
    clearCheckPlayerUnits();
    sparringExtras = [];
    sparringHome.clear();
  }
  sparringActive = false;
}

/** Seconds until the running sparring match reaches its minimum length, or 0
 *  when it has, or when there is no match to wait for. */
export function sparringSecondsToMinimum(): number {
  if (sparringTimer == null) return 0;
  return math.max(0, SPARRING_MIN_SECONDS - sparringTimer.elapsed);
}

/** What the sparring match is doing right now. Diagnostics only -- nothing in the
 *  game reads this; it exists so a test can watch the sparring match from the
 *  outside instead of inferring it. */
export function getSparringStatus(): {
  creeps: number; heroes: number; mercs: number; timer: boolean;
  elapsed: number; campIndex: number; copies: number;
} {
  return {
    copies: SPARRING_COPIES.length,
    campIndex: campIndex ?? -1,
    mercs: getSpawnedMercUnits().length,
    creeps: spawnedCreeps.length,
    heroes: getSpawnedHeroes().length,
    timer: sparringTimer != null,
    elapsed: sparringTimer != null ? sparringTimer.elapsed : 0,
  };
}

/** Start the sparring match: destroy the cage to spawn creeps, field the roster,
 *  and let them fight.
 *  Called after inter-round lobby terrain is spawned. */
export function startSparringMatch(): void {
  if (cageDestructable == null) return;
  // No roster means spawnHeroes produces nobody, and a match with no heroes is
  // worse than no match: scaleCreepStats bails on an empty hero list, so the
  // timer is never created, the creeps are never scaled or made vulnerable, and
  // sparringActive stays true with them standing in the lobby until the next
  // rebuild. Reachable through -lobby, which jumps here without playing the
  // round that picks the roster.
  if (!hasHeroes()) return;

  sparringActive = true;

  // Destroy cage → triggers creep spawn via registerCageTrigger, which puts
  // one camp down per copy because sparringActive is already set.
  cageDestructable.kill();

  fieldDPSHeroes();
}

/** Put the roster in against whatever creeps are standing, which is what
 *  starts the clock: spawnHeroes fires onHeroesSpawned a frame later, and
 *  scaleCreepStats is where the timer is created. */
function fieldDPSHeroes(): void {
  const check = getDPSCheckPlayer();
  sparringExtras = [];
  sparringHome.clear();
  const start = (c: { x: number; y: number; approach: number }): [number, number] => [
    c.x + SPARRING_APPROACH * Cos(c.approach * bj_DEGTORAD),
    c.y + SPARRING_APPROACH * Sin(c.approach * bj_DEGTORAD),
  ];
  // Copies 1..5 first, from the roster's data. Order matters: tome bonuses
  // land a frame after a hero spawns, and copy 0's spawn is what starts the
  // clock a frame later. Spawned after it, these copies' tomes would land
  // after sampling began and read as negative damage.
  const heroes = getChosenHeroData();
  const mercs = getLivingMercData();
  for (let i = 1; i < SPARRING_COPIES.length; i++) {
    const [hx, hy] = start(SPARRING_COPIES[i]);
    for (const h of heroes) {
      const u = spawnHeroFromData(h, check, hx, hy);
      if (u != null) sparringExtras.push(u);
    }
    for (let m = 0; m < mercs.length; m++) {
      const u = spawnMercFromData(mercs[m], check, hx + m * 96, hy - 96);
      if (u != null) sparringExtras.push(u);
    }
  }
  // Copy 0 through the roster's own spawn, which fires onHeroesSpawned and so
  // starts the match.
  const [hx0, hy0] = start(SPARRING_COPIES[0]);
  spawnHeroes([check], hx0, hy0);
  // Mercenaries fight alongside the heroes in a real round, so a measurement
  // taken without them understates the force the camp will actually face and
  // scales the next camp too easily. Owned by the check player like the heroes,
  // so the same teardown reaches them and no human's camera is involved.
  spawnMercsForOwner(check, hx0, hy0 - 96);
}

/** The match's units beyond copy 0's: copy 0 is the roster's own live units,
 *  which the hero and mercenary systems track; these are extra copies of them
 *  that only the match knows about. */
let sparringExtras: Unit[] = [];

/** Which copy each of the match's units belongs to, by handle id. Recorded the
 *  first time a unit is seen, when it is still beside its own camp. */
const sparringHome = new Map<number, number>();

function nearestCopy(x: number, y: number): number {
  let best = 0;
  let bestD = math.huge;
  for (let i = 0; i < SPARRING_COPIES.length; i++) {
    const dx = SPARRING_COPIES[i].x - x;
    const dy = SPARRING_COPIES[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Send anything that has wandered too far from its own copy back to it. */
function leashSparring(u: unit): void {
  const id = GetHandleId(u);
  let home = sparringHome.get(id);
  if (home == null) {
    home = nearestCopy(GetUnitX(u), GetUnitY(u));
    sparringHome.set(id, home);
  }
  const c = SPARRING_COPIES[home];
  const dx = GetUnitX(u) - c.x;
  const dy = GetUnitY(u) - c.y;
  if (dx * dx + dy * dy > SPARRING_LEASH * SPARRING_LEASH) {
    IssuePointOrder(u, 'attack', c.x, c.y);
  }
}

/** Take EVERYTHING the check player owns off the field.
 *
 *  Not just the heroes and mercenaries that were fielded: whatever they
 *  SUMMONED belongs to the check player too, and nothing was removing it. A Far
 *  Seer's Feral Spirit wolves outlived the match that summoned them, so a
 *  restart -- which is what rerolling does -- began the next match with the
 *  previous one's wolves still standing and still fighting, on top of the ones
 *  the new roster would summon.
 *
 *  That is why a single clean match measured fine and a rerolled one did not:
 *  the wolves only pile up across restarts, and entering a round wipes them
 *  anyway when the terrain is rebuilt.
 *
 *  Sweeping by OWNER rather than by list is what makes this hold: anything the
 *  match brings onto the field is owned by the check player, whether or not
 *  this file knew it would exist. */
function clearCheckPlayerUnits(): void {
  const all: unit[] = [];
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => { all.push(u); });
  removeUnitsSummonsFirst(all);
}

/** Just the summons the check player owns, ahead of the units that summoned
 *  them; see teardownSparringMatch. */
function clearCheckPlayerSummons(): void {
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => {
    if (IsUnitType(u, UNIT_TYPE_SUMMONED)) RemoveUnit(u);
  });
}

/** HP lost by each side so far, banked as it happens. */
let creepHPLost = 0;
let ourHPLost = 0;
/** The part of ourHPLost that summons took, rather than the fielded force.
 *  Diagnostic only -- nothing scales off it. */
let summonHPLost = 0;

/** A unit being watched, with the HP it had at the last sample. */
interface TrackedHP {
  unit: unit; lastHP: number; summon: boolean;
  /** A creep already taken out of the fight and credited; see removalCredit. */
  out?: boolean;
}

/** One copy of the party's effective HP, and one camp's, before rigging. */
let sparringForceEHP = 0;
let sparringCampEHP = 0;
/** Creeps taken out early this match, and the HP credited for them. */
let sparringRemovals = 0;
let sparringRemovalCredit = 0;

/**
 * What taking a creep out of the fight early is worth, in the match's units.
 *
 * Transmute kills a creep outright and Charm takes it over; either way, in a
 * real round the camp loses that creep's whole HP at once. Read naively the
 * match gets that badly wrong in both directions: a transmuted creep loses its
 * rigged share of the 99999 pool -- tens of thousands of HP in a quarter
 * second -- and a charmed one jumps to 99999 when our side rigs it, which read
 * as about -67000 HP of damage dealt. A party with both measured -1055 DPS.
 *
 * So the creep is credited with the HP it WOULD have had in the round: its own
 * natural HP scaled the way scaleCreepStats scales a real camp, by the party's
 * effective HP over the camp's. From then on a charmed creep is ours -- the
 * damage it deals and takes count on our side, because it has been picked up
 * and rigged like a summon.
 */
function removalCredit(u: unit): number {
  if (sparringCampEHP <= 0) return 0;
  return (naturalHP.get(GetHandleId(u)) ?? 0) * (sparringForceEHP / sparringCampEHP);
}
let trackedCreeps: TrackedHP[] = [];
let trackedOurs: TrackedHP[] = [];
let dpsSampler: Timer | null = null;

/** How often HP is sampled during the match. Often enough that a unit which
 *  dies or expires between samples loses at most a fraction of a second of
 *  contribution. */
const DPS_SAMPLE_INTERVAL = 0.25;
/** The HP every combatant in the match is rigged to (the creeps share it per
 *  camp). Exported for the tests. */
export const SPARRING_HP = 99999;

/** Rig a unit so the match cannot kill it, and start watching its HP. */
function trackForDPS(list: TrackedHP[], u: unit, rig: boolean): void {
  if (rig) {
    BlzSetUnitMaxHP(u, SPARRING_HP);
    SetUnitState(u, UNIT_STATE_LIFE, SPARRING_HP);
  }
  // `rig` is only ever true for a unit that appeared mid-match, which on our
  // side means a summon. Remembered so the breakdown can say how much of our
  // side's HP loss was taken by summons rather than by the force itself.
  list.push({ unit: u, lastHP: GetUnitState(u, UNIT_STATE_LIFE), summon: rig });
}

/** Sample both sides and bank what they lost since the last look.
 *
 *  HP lost rather than damage events, because HP is the number that has already
 *  had armour taken out of it and regeneration put back in -- it is what the
 *  fight actually cost. Banking it every quarter second rather than reading it
 *  once at the end is what lets a unit die or expire without taking its
 *  contribution with it.
 *
 *  Newly appeared units on our side are summons -- wolves, treants, beetles.
 *  They are rigged and tracked the moment they show up, so they neither die
 *  mid-match nor go uncounted. */
function sampleDPS(): void {
  const creepOwner = getNeutralAggressive().handle;
  for (const entry of trackedCreeps) {
    if (entry.out === true || !unitExists(entry.unit)) continue;
    const hp = GetUnitState(entry.unit, UNIT_STATE_LIFE);
    // Dead (no creep dies to damage in the match -- the pool is too deep --
    // so this is an instant kill) or charmed: credit it once, and stop
    // reading its HP, which no longer means anything for the camp.
    if (hp <= 0.405 || GetOwningPlayer(entry.unit) !== creepOwner) {
      const credit = removalCredit(entry.unit);
      creepHPLost += credit;
      sparringRemovals += 1;
      sparringRemovalCredit += credit;
      entry.out = true;
      continue;
    }
    creepHPLost += entry.lastHP - hp;
    entry.lastHP = hp;
  }
  for (const entry of trackedOurs) {
    if (!unitExists(entry.unit)) continue;
    const hp = GetUnitState(entry.unit, UNIT_STATE_LIFE);
    const lost = entry.lastHP - hp;
    ourHPLost += lost;
    if (entry.summon) summonHPLost += lost;
    entry.lastHP = hp;
  }
  // Pick up anything the fight has summoned since the last sample, and keep
  // every copy's units at their own camp.
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => {
    leashSparring(u);
    for (const e of trackedOurs) {
      if (e.unit === u) return;
    }
    trackForDPS(trackedOurs, u, true);
  });
}

/** Open the match: baseline both sides and start the clock that ends it.
 *
 *  Called from the END of scaleCreepStats, once the creeps have their pool.
 *  The order matters more than it looks: the sampler banks the DIFFERENCE
 *  between consecutive HP readings, so any HP change that is not damage --
 *  rigging included -- is indistinguishable from damage unless it has already
 *  happened before the first reading. */
function startMatchSampling(): void {
  beginDPSSampling();
  sparringTimer = Timer.create();
  sparringTimer.start(SPARRING_DURATION, false, () => {
    cancelSparringMatch();   // sweeps the field, summons included
  });
}

/** Begin watching, once both sides have their rigged HP. */
function beginDPSSampling(): void {
  stopDPSSampling();
  creepHPLost = 0;
  ourHPLost = 0;
  summonHPLost = 0;
  trackedCreeps = [];
  trackedOurs = [];
  for (const c of spawnedCreeps) trackForDPS(trackedCreeps, c.unit.handle, false);
  for (const h of fieldedForce()) trackForDPS(trackedOurs, h.handle, false);
  const t = Timer.create();
  t.start(DPS_SAMPLE_INTERVAL, true, () => sampleDPS());
  dpsSampler = t;
}

function stopDPSSampling(): void {
  if (dpsSampler != null) {
    dpsSampler.pause();
    dpsSampler.destroy();
    dpsSampler = null;
  }
}

/** Everyone fighting on our side: the summoned heroes and any mercenaries.
 *
 *  Difficulty scaling makes no distinction between them. A mercenary has health
 *  and damage exactly as a hero does, and the camp has to get through all of it,
 *  so counting only the heroes understated the force on both axes. */
function fieldedForce(): Unit[] {
  const all = getSpawnedHeroes();
  for (const m of getSpawnedMercUnits()) all.push(m);
  for (const e of sparringExtras) all.push(e);
  return all;
}

/** Throw the current match away and run it again against the camp as it now
 *  stands.
 *
 *  The match is a measurement OF A SPECIFIC CAMP -- it fights that camp's
 *  creeps and scales the next round from the result. Anything that changes
 *  which camp you will face therefore invalidates a match already in progress,
 *  and one that has already finished: its numbers describe creeps you are no
 *  longer going to meet.
 *
 *  The previous numbers are cleared rather than left standing, so a restart
 *  that cannot proceed falls back to the estimate instead of scaling the new
 *  camp by the old camp's measurement. */
export function restartSparringMatch(): void {
  const origin = campOrigin;
  teardownSparringMatch(false);   // discard: they measured the camp you just replaced
  measuredHeroDPS = 0;
  measuredCreepDPS = 0;

  const camp = getCampData();
  if (origin == null || camp == null || !hasHeroes()) return;
  sparringActive = true;
  spawnCreepsAt(origin.x, origin.y, camp);
  fieldDPSHeroes();
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
    onCampFightStarted(camp.level);
    // Grant Summon Heroes ability to the nearest peasant
    // (GetKillingUnit() doesn't work for destructable death events)
    let nearest: unit | null = null;
    let bestDist = math.huge;
    forEachUnitInRange(cx, cy, 300, u => {
      if (GetUnitTypeId(u) !== PEASANT_ID) return;
      const dx = GetUnitX(u) - cx;
      const dy = GetUnitY(u) - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = u;
      }
    });
    if (nearest != null) {
      UnitAddAbility(nearest, SUMMON_ABILITY_ID);
    }
    cageDestructable = null;
    cageTrigger = null;
    trig.destroy();
  });
}
