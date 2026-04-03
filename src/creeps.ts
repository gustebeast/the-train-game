import { Destructable, Timer, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS } from './creep_camps';
import { registerSaveSegment } from './save';
import { log } from './debug';
import { awardHeroXP, onHeroesSpawned, spawnHeroes } from './heroes';
import { getDPSCheckPlayer, getNeutralAggressive } from './teams';
import { TRACK_SIZE } from './track/constants';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;
const DPS_TEST_DURATION = 30;

/** Whether we're in DPS test mode (lobby sparring). */
let dpsTestMode = false;

/** Measured hero DPS from the lobby DPS test. Used for gameplay scaling. */
let measuredHeroDPS = 0;

// ---------------------------------------------------------------------------
// Creep camp state — persisted as tileset + itemLevel + campIndex
// ---------------------------------------------------------------------------

interface CreepCampState {
  tileset: string;
  itemLevel: number;
  campIndex: number;
}

let campState: CreepCampState | null = null;

/** The cage destructable spawned for this round. */
let cageDestructable: Destructable | null = null;

/** The trigger registered on the current cage, so we can clean it up between rounds. */
let cageTrigger: Trigger | null = null;

// ---------------------------------------------------------------------------
// Save/load
// ---------------------------------------------------------------------------

/** Encode as "t=tileset;l=level;i=index". */
function encodeCamp(): string {
  if (campState == null) return '';
  return 't=' + campState.tileset + ';l=' + tostring(campState.itemLevel) + ';i=' + tostring(campState.campIndex);
}

/** Decode "t=tileset;l=level;i=index". */
function decodeCamp(raw: string): void {
  let tileset = '';
  let itemLevel = 0;
  let campIndex = 0;
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    if (key === 't') tileset = val;
    else if (key === 'l') itemLevel = tonumber(val) ?? 0;
    else if (key === 'i') campIndex = tonumber(val) ?? 0;
  }
  if (tileset !== '' && itemLevel > 0) {
    campState = { tileset, itemLevel, campIndex };
  }
}

registerSaveSegment('cc', encodeCamp, decodeCamp);
onHeroesSpawned((heroes) => scaleCreepStats(heroes));

// ---------------------------------------------------------------------------
// Camp selection
// ---------------------------------------------------------------------------

/** Pick a random creep camp and store in state. Hardcoded to Lordaeron Summer + Lv1 for now. */
export function rollCreepCamp(): void {
  const tileset = 'Lordaeron Summer';
  const itemLevel = 1;
  const camps = CREEP_CAMPS[tileset]?.[itemLevel];
  if (camps == null || camps.length === 0) return;
  const index = GetRandomInt(0, camps.length - 1);
  campState = { tileset, itemLevel, campIndex: index };
}

/** Get the unit rawcodes for the current camp, or null if none selected. */
export function getCampCreeps(): string[] | null {
  if (campState == null) return null;
  const camps = CREEP_CAMPS[campState.tileset]?.[campState.itemLevel];
  if (camps == null || campState.campIndex >= camps.length) return null;
  return camps[campState.campIndex];
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

/** Spawned creeps for the current round. */
let spawnedCreeps: Unit[] = [];

/** XP reward per creep, computed during scaleCreepStats. Parallel to spawnedCreeps. */
let creepXPRewards: number[] = [];

/** Spawn creeps around the given world position in a 3x3 grid. Invulnerable until heroes arrive. */
export function spawnCreepsAt(cx: number, cy: number, creepIds: string[]): void {
  const owner = getNeutralAggressive();
  spawnedCreeps = [];
  for (let i = 0; i < creepIds.length && i < 9; i++) {
    const [dx, dy] = GRID_OFFSETS[i];
    const u = Unit.create(owner, FourCC(creepIds[i]), cx + dx, cy + dy, 270);
    if (u == null) continue;
    u.invulnerable = true;
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_BASE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_NUMBER_OF_DICE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_SIDES_PER_DIE, 0);
    spawnedCreeps.push(u);
  }
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

/** Log a unit's combat stats. */
export function logUnitStats(label: string, u: unit): void {
  const dmg = BlzGetUnitBaseDamage(u, 0);
  const dice = BlzGetUnitDiceNumber(u, 0);
  const sides = BlzGetUnitDiceSides(u, 0);
  const cd = getCooldown(u);
  const armor = BlzGetUnitArmor(u);
  const hp = BlzGetUnitMaxHP(u);
  const ehp = getEffectiveHP(u);
  const dps = getDPS(u);
  log(label + ': dmg=' + dmg + '+' + dice + 'd' + sides + ' (avg=' + string.format('%.1f', getAvgDamage(u)) + ') cd=' + string.format('%.2f', cd) + ' dps=' + string.format('%.1f', dps) + ' armor=' + string.format('%.1f', armor) + ' hp=' + hp + ' ehp=' + string.format('%.0f', ehp));
}

/** Scale creep stats to match the two heroes' combined stats, then remove invulnerability.
 *  In DPS test mode: sets creep dmg=1, hp=9999, starts 30s measurement timer.
 *  In gameplay mode: uses measuredHeroDPS for damage scaling, EHP for health scaling. */
export function scaleCreepStats(heroes: Unit[]): void {
  if (spawnedCreeps.length === 0 || heroes.length === 0) return;

  if (dpsTestMode) {
    log('--- DPS test: preparing creeps ---');
    // Set creeps to punching bags: dmg=1, hp=9999
    const creepStartHP = 9999;
    for (const c of spawnedCreeps) {
      BlzSetUnitBaseDamage(c.handle, 1, 0);
      BlzSetUnitDiceNumber(c.handle, 1, 0);
      BlzSetUnitDiceSides(c.handle, 1, 0);
      BlzSetUnitMaxHP(c.handle, creepStartHP);
      SetUnitState(c.handle, UNIT_STATE_LIFE, creepStartHP);
      BlzSetUnitWeaponIntegerField(c.handle, UNIT_WEAPON_IF_ATTACK_ATTACK_TYPE, 0, 5);
      c.invulnerable = false;
    }

    // After 30 seconds, measure total damage dealt by checking HP loss
    const t = Timer.create();
    t.start(DPS_TEST_DURATION, false, () => {
      t.destroy();
      let totalDamage = 0;
      for (const c of spawnedCreeps) {
        const currentHP = GetUnitState(c.handle, UNIT_STATE_LIFE);
        totalDamage += creepStartHP - currentHP;
      }
      measuredHeroDPS = totalDamage / DPS_TEST_DURATION;
      log('DPS test complete: totalDamage=' + string.format('%.0f', totalDamage)
        + ' duration=' + DPS_TEST_DURATION + 's'
        + ' measuredHeroDPS=' + string.format('%.1f', measuredHeroDPS));
      dpsTestMode = false;
    });
    return;
  }

  // --- Gameplay scaling ---
  log('--- Creep stat scaling ---');
  for (const h of heroes) {
    logUnitStats('Hero ' + GetUnitName(h.handle), h.handle);
  }
  for (const c of spawnedCreeps) {
    logUnitStats('Creep (before) ' + GetUnitName(c.handle), c.handle);
  }

  // Hero EHP (armor + HP are accurate with items)
  let heroEHP = 0;
  for (const h of heroes) {
    heroEHP += getEffectiveHP(h.handle);
  }

  // Creep stats (no items, so API values are accurate)
  let creepDPS = 0;
  let creepEHP = 0;
  for (const c of spawnedCreeps) {
    creepDPS += getDPS(c.handle);
    creepEHP += getEffectiveHP(c.handle);
  }

  // Use measured hero DPS from lobby test, fall back to API-based if not available
  const heroDPS = measuredHeroDPS > 0 ? measuredHeroDPS : (() => {
    let sum = 0;
    for (const h of heroes) sum += getDPS(h.handle);
    return sum;
  })();

  const dpsScale = creepDPS > 0 ? heroDPS / creepDPS : 1;
  const ehpScale = creepEHP > 0 ? heroEHP / creepEHP : 1;
  log('heroDPS=' + string.format('%.1f', heroDPS) + ' (measured=' + (measuredHeroDPS > 0 ? 'yes' : 'no') + ')');
  log('Scaling factors: dps=' + string.format('%.2f', dpsScale) + ' ehp=' + string.format('%.2f', ehpScale));

  // Compute XP rewards: use creep level as weight, scale to target total
  const isFirstCamp = heroes.every(h => GetHeroXP(h.handle) === 0);
  const targetXP = isFirstCamp ? FIRST_CAMP_XP : TARGET_XP;
  let levelSum = 0;
  for (const c of spawnedCreeps) {
    levelSum += math.max(1, GetUnitLevel(c.handle));
  }
  creepXPRewards = [];
  for (const c of spawnedCreeps) {
    const level = math.max(1, GetUnitLevel(c.handle));
    creepXPRewards.push(math.max(1, math.floor(level / levelSum * targetXP)));
  }

  // Apply scaled stats and remove invulnerability
  for (let i = 0; i < spawnedCreeps.length; i++) {
    const c = spawnedCreeps[i];

    // DPS-based damage scaling: keep cooldown, scale base damage to match target DPS
    const cd = getCooldown(c.handle);
    const originalDPS = getDPS(c.handle);
    const targetDPS = originalDPS * dpsScale;
    const targetAvgDmg = targetDPS * cd;
    const diceAvg = BlzGetUnitDiceNumber(c.handle, 0) * (BlzGetUnitDiceSides(c.handle, 0) + 1) / 2;
    const scaledDamage = math.max(1, math.floor(targetAvgDmg - diceAvg));

    // EHP-based HP scaling: keep armor, scale raw HP to match target EHP
    const armor = math.max(0, BlzGetUnitArmor(c.handle));
    const armorMultiplier = 1 + 0.06 * armor;
    const scaledHP = math.max(1, math.floor(getEffectiveHP(c.handle) * ehpScale / armorMultiplier));

    BlzSetUnitBaseDamage(c.handle, scaledDamage, 0);
    BlzSetUnitMaxHP(c.handle, scaledHP);
    SetUnitState(c.handle, UNIT_STATE_LIFE, scaledHP);
    BlzSetUnitWeaponIntegerField(c.handle, UNIT_WEAPON_IF_ATTACK_ATTACK_TYPE, 0, 5);
    c.invulnerable = false;
    logUnitStats('Creep (after) ' + GetUnitName(c.handle), c.handle);

    // Register per-creep death trigger for XP award
    const xpReward = creepXPRewards[i];
    const deathTrig = Trigger.create();
    TriggerRegisterUnitEvent(deathTrig.handle, c.handle, EVENT_UNIT_DEATH);
    deathTrig.addAction(() => {
      awardHeroXP(xpReward);
      DestroyTrigger(deathTrig.handle);
    });
  }
}

// ---------------------------------------------------------------------------
// DPS test — lobby sparring to measure real DPS
// ---------------------------------------------------------------------------

/** Start DPS test: destroy cage to spawn creeps, spawn heroes, let them fight.
 *  Called after lobby terrain is spawned. */
export function startDPSTest(): void {
  if (cageDestructable == null) { log('DPS test: no cage found'); return; }

  dpsTestMode = true;
  const cageX = cageDestructable.x;
  const cageY = cageDestructable.y;

  // Destroy cage → triggers creep spawn via registerCageTrigger
  cageDestructable.kill();

  // Spawn heroes owned by DPS check player to the left of the 6x3 area
  // spawnHeroes fires onHeroesSpawnedCallback after 1 frame → scaleCreepStats
  const heroX = cageX - 4 * TRACK_SIZE;
  spawnHeroes(getDPSCheckPlayer(), heroX, cageY);
  log('DPS test started');
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
    const creepIds = getCampCreeps();
    if (creepIds == null) return;
    spawnCreepsAt(cageDestructable.x, cageDestructable.y, creepIds);
    cageDestructable = null;
    cageTrigger = null;
    DestroyTrigger(trig.handle);
  });
}
