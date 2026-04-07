import { Destructable, Timer, Trigger, Unit } from 'w3ts';
import { CREEP_CAMPS, CreepCamp, CreepUnit } from './creep_camps';
import { registerSaveSegment } from './save';
import { log } from './debug';
import { awardHeroXP, getSpawnedHeroes, onHeroesSpawned, spawnHeroes } from './heroes';
import { SUMMON_ABILITY_ID, PEASANT_ID } from './constants';
import { getDPSCheckPlayer, getNeutralAggressive } from './teams';
import { TRACK_SIZE } from './track/constants';

const TARGET_XP = 100;
const FIRST_CAMP_XP = 90;
const DPS_TEST_DURATION = 30;
/** Creep DPS multiplier to compensate for hero spells not being factored into heroDPS. */
const CREEP_DPS_ADVANTAGE = 1.2;

/** Whether we're in DPS test mode (lobby sparring). */
let dpsTestMode = false;

/** Measured hero DPS from the lobby DPS test. Used for gameplay scaling. */
let measuredHeroDPS = 0;

/** Active DPS test timer (so it can be cancelled early). */
let dpsTestTimer: Timer | null = null;

/** HP each creep started the DPS test with. */
let dpsTestCreepStartHP = 0;

// ---------------------------------------------------------------------------
// Creep camp state — persisted as tileset + campIndex
// ---------------------------------------------------------------------------

interface CreepCampState {
  tileset: string;
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

/** Encode as "t=tileset;i=index". */
function encodeCamp(): string {
  if (campState == null) return '';
  return 't=' + campState.tileset + ';i=' + tostring(campState.campIndex);
}

/** Decode "t=tileset;i=index". */
function decodeCamp(raw: string): void {
  let tileset = '';
  let campIndex = 0;
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    if (key === 't') tileset = val;
    else if (key === 'i') campIndex = tonumber(val) ?? 0;
  }
  if (tileset !== '') {
    campState = { tileset, campIndex };
  }
}

registerSaveSegment('cc', encodeCamp, decodeCamp);
onHeroesSpawned((heroes) => scaleCreepStats(heroes));

// ---------------------------------------------------------------------------
// Camp selection
// ---------------------------------------------------------------------------

/** Pick a random creep camp and store in state. Hardcoded to Lordaeron Summer for now. */
export function rollCreepCamp(): void {
  const tileset = 'Lordaeron Summer';
  const camps = CREEP_CAMPS[tileset];
  if (camps == null || camps.length === 0) return;
  const index = GetRandomInt(0, camps.length - 1);
  campState = { tileset, campIndex: index };
}

/** Get the selected camp, or null if none selected. */
export function getCampData(): CreepCamp | null {
  if (campState == null) return null;
  const camps = CREEP_CAMPS[campState.tileset];
  if (camps == null || campState.campIndex >= camps.length) return null;
  return camps[campState.campIndex];
}

/** Get the unit rawcodes for the current camp, or null if none selected. */
export function getCampCreeps(): string[] | null {
  const camp = getCampData();
  if (camp == null) return null;
  return camp.map(u => u.id);
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

/** XP reward per creep, computed during scaleCreepStats. Parallel to spawnedCreeps. */
let creepXPRewards: number[] = [];

/** Spawn creeps around the given world position in a 3x3 grid. Invulnerable until heroes arrive. */
export function spawnCreepsAt(cx: number, cy: number, camp: CreepCamp): void {
  const owner = getNeutralAggressive();
  spawnedCreeps = [];
  for (let i = 0; i < camp.length && i < 9; i++) {
    const [dx, dy] = GRID_OFFSETS[i];
    const u = Unit.create(owner, FourCC(camp[i].id), cx + dx, cy + dy, 270);
    if (u == null) continue;
    u.invulnerable = true;
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_BASE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_NUMBER_OF_DICE, 0);
    BlzSetUnitIntegerField(u.handle, UNIT_IF_GOLD_BOUNTY_AWARDED_SIDES_PER_DIE, 0);
    spawnedCreeps.push({ unit: u, campUnit: camp[i] });
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
    dpsTestTimer = Timer.create();
    dpsTestTimer.start(DPS_TEST_DURATION, false, () => {
      cancelDPSTest();
      for (const h of getSpawnedHeroes()) {
        h.destroy();
      }
    });
    return {
      dpsScale: creepDPS > 0 ? 1 / creepDPS : 1,
      ehpScale: creepEHP > 0 ? DPS_TEST_HP / creepEHP : 1,
    };
  }

  let heroEHP = 0;
  for (const h of heroes) {
    heroEHP += getEffectiveHP(h.handle);
  }
  const heroDPS = measuredHeroDPS > 0 ? measuredHeroDPS : (() => {
    let sum = 0;
    for (const h of heroes) sum += getDPS(h.handle);
    return sum;
  })();
  return {
    dpsScale: creepDPS > 0 ? (heroDPS * CREEP_DPS_ADVANTAGE) / creepDPS : 1,
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
  creepXPRewards = [];
  for (const c of spawnedCreeps) {
    const level = math.max(1, GetUnitLevel(c.unit.handle));
    creepXPRewards.push(math.max(1, math.floor(level / levelSum * targetXP)));
  }

  // Apply scaled stats and remove invulnerability
  for (let i = 0; i < spawnedCreeps.length; i++) {
    const c = spawnedCreeps[i];
    const h = c.unit.handle;

    if (dpsTestMode) {
      // Punching bags: fixed 1 damage, no dice variance, no armor, exact HP target
      BlzSetUnitBaseDamage(h, 0, 0);
      BlzSetUnitDiceNumber(h, 1, 0);
      BlzSetUnitDiceSides(h, 1, 0);
      BlzSetUnitArmor(h, 0);
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
      log('Creep ' + i + ' (' + GetUnitName(h) + '): xpReward=' + xpReward + ' dpsTestMode=' + tostring(dpsTestMode));
      const deathTrig = Trigger.create();
      TriggerRegisterUnitEvent(deathTrig.handle, h, EVENT_UNIT_DEATH);
      deathTrig.addAction(() => {
        const sh = getSpawnedHeroes();
        const xpBefore = sh.map(h => GetHeroXP(h.handle));
        log('Creep died: awarding ' + xpReward + ' XP. Before: ' + xpBefore.join(','));
        awardHeroXP(xpReward);
        const xpAfter = sh.map(h => GetHeroXP(h.handle));
        log('After: ' + xpAfter.join(','));
        if (drops != null) {
          for (const drop of drops) {
            const itemId = ChooseRandomItemEx(drop.type, drop.level);
            if (itemId !== 0) {
              const dying = GetTriggerUnit()!;
              CreateItem(itemId, GetUnitX(dying), GetUnitY(dying));
            }
          }
        }
        DestroyTrigger(deathTrig.handle);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// DPS test — lobby sparring to measure real DPS
// ---------------------------------------------------------------------------

/** End the DPS test: measure damage, compute DPS, clean up all state.
 *  Safe to call at any point — handles the case where the timer hasn't started yet. */
export function cancelDPSTest(): void {
  if (dpsTestTimer != null) {
    const elapsed = dpsTestTimer.elapsed;
    dpsTestTimer.destroy();
    dpsTestTimer = null;
    if (elapsed > 0) {
      let totalDamage = 0;
      for (const c of spawnedCreeps) {
        const maxHP = BlzGetUnitMaxHP(c.unit.handle);
        const currentHP = GetUnitState(c.unit.handle, UNIT_STATE_LIFE);
        totalDamage += maxHP - currentHP;
      }
      measuredHeroDPS = totalDamage / elapsed;
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
 *  Called after lobby terrain is spawned. */
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
  spawnHeroes(getDPSCheckPlayer(), heroX, cageY);
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
    spawnCreepsAt(cageDestructable.x, cageDestructable.y, camp);
    // Grant Summon Heroes ability to the nearest peasant
    // (GetKillingUnit() doesn't work for destructable death events)
    const cx = cageDestructable!.x;
    const cy = cageDestructable!.y;
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
