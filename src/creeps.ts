import { Destructable, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS } from './creep_camps';
import { registerSaveSegment } from './save';
import { log } from './debug';
import { awardHeroXP, onHeroesSpawned } from './heroes';
import { getNeutralAggressive } from './teams';
import { TRACK_SIZE } from './track/constants';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;

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
function spawnCreepsAt(cx: number, cy: number, creepIds: string[]): void {
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

/** Log a unit's combat stats. */
function logUnitStats(label: string, u: unit): void {
  const dmg = BlzGetUnitBaseDamage(u, 0);
  const dice = BlzGetUnitDiceNumber(u, 0);
  const sides = BlzGetUnitDiceSides(u, 0);
  const cooldown = BlzGetUnitWeaponRealField(u, UNIT_WEAPON_RF_ATTACK_BASE_COOLDOWN, 0);
  const armor = BlzGetUnitArmor(u);
  const hp = BlzGetUnitMaxHP(u);
  const avgDmg = dmg + dice * (sides + 1) / 2;
  const dps = cooldown > 0 ? avgDmg / cooldown : 0;
  log(label + ': dmg=' + dmg + '+' + dice + 'd' + sides + ' (avg=' + string.format('%.1f', avgDmg) + ') cd=' + string.format('%.2f', cooldown) + ' dps=' + string.format('%.1f', dps) + ' armor=' + string.format('%.1f', armor) + ' hp=' + hp);
}

/** Scale creep stats to match the two heroes' combined stats, then remove invulnerability.
 *  Preserves relative differences between creeps within the camp. */
export function scaleCreepStats(heroes: Unit[]): void {
  if (spawnedCreeps.length === 0 || heroes.length === 0) return;

  log('--- Creep stat scaling ---');
  for (const h of heroes) {
    logUnitStats('Hero ' + GetUnitName(h.handle), h.handle);
  }
  for (const c of spawnedCreeps) {
    logUnitStats('Creep (before) ' + GetUnitName(c.handle), c.handle);
  }

  // Sum hero stats
  let heroAttack = 0;
  let heroArmor = 0;
  let heroHP = 0;
  for (const h of heroes) {
    heroAttack += BlzGetUnitBaseDamage(h.handle, 0);
    heroArmor += BlzGetUnitArmor(h.handle);
    heroHP += BlzGetUnitMaxHP(h.handle);
  }

  // Sum original creep stats
  let creepAttack = 0;
  let creepArmor = 0;
  let creepHP = 0;
  for (const c of spawnedCreeps) {
    creepAttack += BlzGetUnitBaseDamage(c.handle, 0);
    creepArmor += BlzGetUnitArmor(c.handle);
    creepHP += BlzGetUnitMaxHP(c.handle);
  }

  // Compute scaling factors (avoid divide by zero)
  const attackScale = creepAttack > 0 ? heroAttack / creepAttack : 1;
  const armorScale = creepArmor > 0 ? heroArmor / creepArmor : 1;
  const hpScale = creepHP > 0 ? heroHP / creepHP : 1;
  log('Scaling factors: attack=' + string.format('%.2f', attackScale) + ' armor=' + string.format('%.2f', armorScale) + ' hp=' + string.format('%.2f', hpScale));

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

  // Apply scaled stats, set up XP death triggers, and remove invulnerability
  for (let i = 0; i < spawnedCreeps.length; i++) {
    const c = spawnedCreeps[i];
    const scaledDamage = math.max(1, math.floor(BlzGetUnitBaseDamage(c.handle, 0) * attackScale));
    const scaledArmor = math.max(0, math.floor(BlzGetUnitArmor(c.handle) * armorScale));
    const scaledHP = math.max(1, math.floor(BlzGetUnitMaxHP(c.handle) * hpScale));
    BlzSetUnitBaseDamage(c.handle, scaledDamage, 0);
    BlzSetUnitArmor(c.handle, scaledArmor);
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

  // Register damage logging trigger
  const dmgTrig = Trigger.create();
  TriggerRegisterAnyUnitEventBJ(dmgTrig.handle, EVENT_PLAYER_UNIT_DAMAGED);
  dmgTrig.addAction(() => {
    const src = GetEventDamageSource();
    const tgt = BlzGetEventDamageTarget();
    const dmg = GetEventDamage();
    if (src == null || tgt == null) return;
    log(GetUnitName(src) + ' -> ' + GetUnitName(tgt) + ': ' + string.format('%.1f', dmg) + ' dmg (tgt hp=' + string.format('%.0f', GetUnitState(tgt, UNIT_STATE_LIFE)) + ')');
  });
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
