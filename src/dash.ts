import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';

// The roll moves the peasant with SetUnitX/SetUnitY on a fixed tick — an
// action, not an order (the same reason UnitDropItemPoint can drop an item
// without disturbing the queue). That matters twice over:
//   * it issues no order, so a shift-queued roll -> walk still walks, and
//   * the unit is never "executing a move", so the Roll animation plays
//     instead of being overridden by Walk.
// SetUnitX/Y ignores collision entirely, so every step is gated on canStandAt()
// below, which checks terrain, destructables (rocks/trees) and units (water
// blocks, the train). An earlier version only checked terrain and rolled
// straight through rocks; SetUnitPosition does collide but interrupts the
// unit's current order, which breaks the queue requirement.
const TICK = 0.02;
const ROLL_DISTANCE = 220; // units travelled over the roll
const ROLL_DURATION = 0.5; // seconds of the roll
const ROLL_STEP = ROLL_DISTANCE / (ROLL_DURATION / TICK); // per-tick distance
const ROLL_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js
const ROLL_ANIM_TIME_SCALE = 2.3; // 1167ms sequence into ~0.5s
const CLEARANCE = 44; // half-extent probed for blockers (peasant collision is 32)

interface RollState {
  timer: Timer;
  dx: number; // per-tick offset
  dy: number;
  ticksLeft: number;
}

/** Peasants currently mid-roll, keyed by handle. */
const rolling = new Map<unit, RollState>();

/** True while the unit is executing a roll. */
export function isRolling(h: unit): boolean {
  return rolling.has(h);
}

/** Is there a living destructable (tree/rock/granite) blocking this spot? */
function destructableBlocks(x: number, y: number): boolean {
  let blocked = false;
  const r = Rect(x - CLEARANCE, y - CLEARANCE, x + CLEARANCE, y + CLEARANCE);
  EnumDestructablesInRect(r, undefined, () => {
    const d = GetEnumDestructable();
    if (d != null && GetDestructableLife(d) > 0) blocked = true;
  });
  RemoveRect(r);
  return blocked;
}

/** Is another collidable unit (water block, the train, a building) here? */
function unitBlocks(self: unit, x: number, y: number): boolean {
  let blocked = false;
  const g = CreateGroup()!;
  GroupEnumUnitsInRange(g, x, y, CLEARANCE, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u == null || u === self) return;
    if (GetUnitTypeId(u) === 0 || IsUnitType(u, UNIT_TYPE_DEAD)) return;
    // Flying units don't block a ground roll.
    if (IsUnitType(u, UNIT_TYPE_FLYING)) return;
    blocked = true;
  });
  DestroyGroup(g);
  return blocked;
}

/** Whether the rolling unit may occupy (x, y). IsTerrainPathable is inverted. */
function canStandAt(self: unit, x: number, y: number): boolean {
  if (IsTerrainPathable(x, y, PATHING_TYPE_WALKABILITY)) return false;
  if (destructableBlocks(x, y)) return false;
  if (unitBlocks(self, x, y)) return false;
  return true;
}

/** End the roll: restore the animation clock. Deliberately issues NO order —
 *  a 'stop' here would discard whatever the player queued behind the roll. */
function endRoll(h: unit): void {
  const s = rolling.get(h);
  if (s == null) return;
  s.timer.destroy();
  rolling.delete(h);
  if (GetUnitTypeId(h) === 0) return; // unit removed mid-roll
  SetUnitTimeScale(h, 1);
}

/** Advance one roll step, per axis so a blocked axis still lets the other
 *  through (the roll slides along walls instead of dead-stopping). */
function stepRoll(h: unit): void {
  const s = rolling.get(h);
  if (s == null) return;
  if (GetUnitTypeId(h) === 0) { endRoll(h); return; }

  const x = GetUnitX(h);
  const y = GetUnitY(h);
  let moved = false;

  if (canStandAt(h, x + s.dx, y)) { SetUnitX(h, x + s.dx); moved = true; }
  const nx = GetUnitX(h);
  if (canStandAt(h, nx, y + s.dy)) { SetUnitY(h, y + s.dy); moved = true; }

  s.ticksLeft = s.ticksLeft - 1;
  if (!moved || s.ticksLeft <= 0) endRoll(h);
}

/** Start (or restart) a roll toward the target point. Peasants are permanently
 *  invulnerable here, so no invulnerability handling is needed. */
function startRoll(u: Unit, targetX: number, targetY: number): void {
  const h = u.handle;
  const angle = Atan2(targetY - u.y, targetX - u.x);

  const existing = rolling.get(h);
  if (existing != null) existing.timer.destroy();

  SetUnitFacing(h, angle * bj_RADTODEG);
  SetUnitTimeScale(h, ROLL_ANIM_TIME_SCALE);
  SetUnitAnimationByIndex(h, ROLL_ANIM_INDEX);
  QueueUnitAnimation(h, 'stand');

  const timer = Timer.create();
  rolling.set(h, {
    timer,
    dx: ROLL_STEP * Cos(angle),
    dy: ROLL_STEP * Sin(angle),
    ticksLeft: Math.floor(ROLL_DURATION / TICK),
  });
  timer.start(TICK, true, () => stepRoll(h));
}

/** Init the dash: cast trigger on CHANNEL for keypress-instant response. */
export function initDash(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  t.addAction(() => {
    if (GetSpellAbilityId() !== DASH_ABILITY_ID) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    startRoll(u, GetSpellTargetX(), GetSpellTargetY());
  });
}
