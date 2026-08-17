import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';

// The roll drives the peasant with a normal move order at a boosted speed, so
// the engine's own pathing keeps it from clipping through rocks, trees, water
// and the train (an earlier SetUnitX/Y version ignored all collision). Distance
// = ROLL_SPEED * ROLL_DURATION.
const ROLL_DISTANCE = 220; // units travelled (was ~430 — halved per feedback)
const ROLL_DURATION = 0.5; // seconds of the roll
const ROLL_SPEED = ROLL_DISTANCE / ROLL_DURATION; // move speed during the roll
const ROLL_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js
const ROLL_ANIM_TIME_SCALE = 2.3; // 1167ms sequence into ~0.5s

interface RollState {
  timer: Timer;
  defaultSpeed: number;
}

/** Peasants currently mid-roll, keyed by handle. */
const rolling = new Map<unit, RollState>();

/** True while the unit is executing a roll. Harvest order interception checks
 *  this so the roll's own move order isn't rejected as a "Requires Axe" etc. */
export function isRolling(h: unit): boolean {
  return rolling.has(h);
}

/** End the roll: restore speed/animation and halt residual movement. */
function endRoll(h: unit): void {
  const s = rolling.get(h);
  if (s == null) return;
  s.timer.destroy();
  rolling.delete(h);
  if (GetUnitTypeId(h) === 0) return; // unit removed mid-roll
  SetUnitTimeScale(h, 1);
  SetUnitMoveSpeed(h, s.defaultSpeed);
  IssueImmediateOrder(h, 'stop');
}

/** Start (or restart) a roll toward the target point. Peasants are permanently
 *  invulnerable here, so no invulnerability handling is needed. */
function startRoll(u: Unit, targetX: number, targetY: number): void {
  const h = u.handle;
  const angle = Atan2(targetY - u.y, targetX - u.x);
  const destX = u.x + ROLL_DISTANCE * Cos(angle);
  const destY = u.y + ROLL_DISTANCE * Sin(angle);

  // If already rolling, keep the original default speed (don't capture the
  // boosted one) and reset the timer.
  const existing = rolling.get(h);
  const defaultSpeed = existing != null ? existing.defaultSpeed : GetUnitMoveSpeed(h);
  if (existing != null) existing.timer.destroy();

  SetUnitFacing(h, angle * bj_RADTODEG);
  SetUnitMoveSpeed(h, ROLL_SPEED);
  SetUnitTimeScale(h, ROLL_ANIM_TIME_SCALE);
  SetUnitAnimationByIndex(h, ROLL_ANIM_INDEX);
  QueueUnitAnimation(h, 'stand');
  // A normal move order — pathing-respecting, so no clipping through obstacles.
  IssuePointOrder(h, 'move', destX, destY);

  const timer = Timer.create();
  rolling.set(h, { timer, defaultSpeed });
  timer.start(ROLL_DURATION, false, () => endRoll(h));
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
