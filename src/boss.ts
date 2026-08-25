import { Timer, Trigger, Unit } from 'w3ts';
import { BOSS_ADD_ID, BOSS_ID, BOSS_INFERNO_ABILITY_ID } from './constants';
import { getNeutralAggressive } from './teams';

/**
 * The final boss: an oversized Infernal that calls down lesser infernals.
 *
 * Its stats are fixed in compiletime.ts rather than scaled off a DPS
 * measurement the way creep camps are, so tuning it means editing those numbers
 * and re-running the balance test.
 */

/** Inferno's order id, so the boss can be told to cast it. */
const INFERNO_ORDER = 'inferno';

/** How often to look at the boss and consider casting. Well under the ability's
 *  own 20s cooldown, so a cast that fails (no mana, already casting) is retried
 *  soon rather than skipping a whole cycle. */
const CAST_CHECK_SECONDS = 1.0;

let castLoop: Timer | null = null;

/** Spawn the boss, facing south, owned by neutral aggressive so heroes will
 *  engage it and it will engage them. */
export function spawnBoss(x: number, y: number): Unit | null {
  const u = Unit.create(getNeutralAggressive(), BOSS_ID, x, y, 270);
  if (u == null) return null;
  installAddSwap(u.owner.handle);
  driveInferno(u);
  return u;
}

/** The stock Infernal the meteor drops, which we swap out for ours. */
const STOCK_INFERNAL_ID = FourCC('ninf');
/** How long a summoned infernal lives, matching the ability's own duration. */
const ADD_LIFETIME = 180;
/** Buff id every timed-life summon uses. */
const TIMED_LIFE_BUFF = FourCC('BTLF');
/** Fallback if the ability will not report its own impact delay. */
const DEFAULT_IMPACT_DELAY = 1.0;

let swapInstalled = false;

/** Replace the stock infernal the meteor summons with our lesser one.
 *
 *  A swap rather than the ability's own "Data - Summoned Unit Type", which is
 *  the obvious place for it and does not work. Three routes were tried in game:
 *  setting it in object data writes a STRING (the library's field type) which
 *  serialises cleanly and the engine ignores; the typed runtime setter for the
 *  same field refuses the write and reads back 0; and the field is absent from
 *  the library's metadata for the neutral hostile Inferno altogether. Each time
 *  the meteor dropped a full-strength stock Infernal.
 *
 *  Catching the summon is the one route that does not depend on that field. The
 *  event is registered for the boss's own player rather than through
 *  registerAnyUnitEvent, which covers the playing slots and not neutral. */
/** The meteor's flight time, from the ability itself. */
function impactDelay(caster: unit): number {
  const ab = BlzGetUnitAbility(caster, BOSS_INFERNO_ABILITY_ID);
  if (ab == null) return DEFAULT_IMPACT_DELAY;
  const d = BlzGetAbilityRealLevelField(ab, ABILITY_RLF_IMPACT_DELAY, 0);
  return d > 0 ? d : DEFAULT_IMPACT_DELAY;
}

function installAddSwap(owner: player): void {
  if (swapInstalled) return;
  swapInstalled = true;
  const t = Trigger.create();
  TriggerRegisterPlayerUnitEvent(t.handle, owner, EVENT_PLAYER_UNIT_SUMMON, undefined);
  t.addAction(() => {
    const summoned = GetSummonedUnit();
    if (summoned == null || GetUnitTypeId(summoned) !== STOCK_INFERNAL_ID) return;
    const at = GetOwningPlayer(summoned);
    const x = GetUnitX(summoned);
    const y = GetUnitY(summoned);
    const facing = GetUnitFacing(summoned);
    RemoveUnit(summoned);
    // The event fires when the spell goes off, not when the meteor lands: the
    // engine makes its infernal at cast time and only shows it on impact, so
    // creating ours here put it on the ground a second early. Wait out the
    // ability's own impact delay so it arrives with the meteor.
    const caster = GetSummoningUnit();
    const delay = caster != null ? impactDelay(caster) : DEFAULT_IMPACT_DELAY;
    const drop = Timer.create();
    drop.start(delay, false, () => {
      drop.destroy();
      const add = CreateUnit(at, BOSS_ADD_ID, x, y, facing);
      if (add != null) UnitApplyTimedLife(add, TIMED_LIFE_BUFF, ADD_LIFETIME);
    });
  });
}

/** Cast Inferno on cooldown, on whatever the boss is currently fighting.
 *
 *  Scripted rather than left to the creep AI: the AI decides what to cast from
 *  data it holds about the STOCK abilities, and this Inferno is a fresh rawcode
 *  it has never heard of. Without this the boss would simply never use it. */
function driveInferno(boss: Unit): void {
  stopBoss();
  const timer = Timer.create();
  castLoop = timer;
  timer.start(CAST_CHECK_SECONDS, true, () => {
    const h = boss.handle;
    if (GetUnitTypeId(h) === 0 || IsUnitType(h, UNIT_TYPE_DEAD)) { stopBoss(); return; }
    if (GetUnitAbilityLevel(h, BOSS_INFERNO_ABILITY_ID) === 0) return;
    if (BlzGetUnitAbilityCooldownRemaining(h, BOSS_INFERNO_ABILITY_ID) > 0) return;

    // Drop it on the nearest enemy, or underfoot if nothing is in reach --
    // the meteor is an area effect, so its own position still catches melee.
    const spot = nearestEnemy(boss);
    IssuePointOrder(h, INFERNO_ORDER, spot.x, spot.y);
  });
}

/** Where to aim: the closest living enemy within HUNT_RANGE, else the boss. */
const HUNT_RANGE = 900;

function nearestEnemy(boss: Unit): { x: number; y: number } {
  const owner = boss.owner.handle;
  let bestX = boss.x;
  let bestY = boss.y;
  let bestDist = -1;
  const g = CreateGroup()!;
  GroupEnumUnitsInRange(g, boss.x, boss.y, HUNT_RANGE, undefined);
  ForGroup(g, () => {
    const e = GetEnumUnit();
    if (e == null) return;
    if (!IsUnitEnemy(e, owner)) return;
    if (IsUnitType(e, UNIT_TYPE_DEAD) || GetUnitTypeId(e) === 0) return;
    if (IsUnitType(e, UNIT_TYPE_STRUCTURE)) return;
    const dx = GetUnitX(e) - boss.x;
    const dy = GetUnitY(e) - boss.y;
    const dist = dx * dx + dy * dy;
    if (bestDist < 0 || dist < bestDist) { bestDist = dist; bestX = GetUnitX(e); bestY = GetUnitY(e); }
  });
  DestroyGroup(g);
  return { x: bestX, y: bestY };
}

export function stopBoss(): void {
  if (castLoop != null) { castLoop.destroy(); castLoop = null; }
}
