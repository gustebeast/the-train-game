import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';

// Dash physics modeled on the roll from "Shooting Gay 0.6" (see
// docs/dash-roll-research.md): the cast adds an IMPULSE into a per-unit
// velocity that a fixed tick decays exponentially — fast burst, smooth
// bleed-off, motion slightly outlasting the roll.
const TICK = 0.02;
const IMPULSE = 50; // units/tick added per cast (~430 units total travel)
const DECAY = 0.9; // velocity multiplier per tick
const DEAD_ZONE = 2; // |v| below this snaps to 0
const MAX_SPEED = 100; // per-axis velocity cap (stacked casts)
const ROLL_DURATION = 0.5; // seconds of pause/roll state
const ROLL_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js
const ROLL_ANIM_TIME_SCALE = 2.3; // 1167ms sequence into ~0.5s

interface DashState {
  unit: Unit;
  vx: number;
  vy: number;
  rollTimer: Timer | null;
}

/** Units with live dash velocity or an active roll, keyed by handle. */
const states = new Map<unit, DashState>();

function getState(u: Unit): DashState {
  let s = states.get(u.handle);
  if (s == null) {
    s = { unit: u, vx: 0, vy: 0, rollTimer: null };
    states.set(u.handle, s);
  }
  return s;
}

/** Whether ground units can occupy (x, y). IsTerrainPathable is inverted. */
function walkable(x: number, y: number): boolean {
  return !IsTerrainPathable(x, y, PATHING_TYPE_WALKABILITY);
}

/** Apply velocities: clamp, decay, dead-zone, then move per axis so a
 *  blocked axis doesn't kill the other (slides along obstacles). */
function tick(): void {
  const stale: unit[] = [];
  for (const [handle, s] of states) {
    if (GetUnitTypeId(handle) === 0) {
      stale.push(handle);
      continue;
    }

    if (s.vx > MAX_SPEED) s.vx = MAX_SPEED;
    else if (s.vx < -MAX_SPEED) s.vx = -MAX_SPEED;
    if (s.vy > MAX_SPEED) s.vy = MAX_SPEED;
    else if (s.vy < -MAX_SPEED) s.vy = -MAX_SPEED;

    let x = GetUnitX(handle);
    let y = GetUnitY(handle);

    if (s.vx > -DEAD_ZONE && s.vx < DEAD_ZONE) {
      s.vx = 0;
    } else {
      s.vx = s.vx * DECAY;
      if (walkable(x + s.vx, y)) {
        x = x + s.vx;
        SetUnitX(handle, x);
      }
    }

    if (s.vy > -DEAD_ZONE && s.vy < DEAD_ZONE) {
      s.vy = 0;
    } else {
      s.vy = s.vy * DECAY;
      if (walkable(x, y + s.vy)) {
        y = y + s.vy;
        SetUnitY(handle, y);
      }
    }

    if (s.vx === 0 && s.vy === 0 && s.rollTimer == null) {
      stale.push(handle);
    }
  }
  for (const h of stale) states.delete(h);
}

/** End the roll state: restore animation control and orders. Movement may
 *  continue briefly from residual velocity — intentional. */
function endRoll(s: DashState): void {
  if (s.rollTimer != null) {
    s.rollTimer.destroy();
    s.rollTimer = null;
  }
  const h = s.unit.handle;
  if (GetUnitTypeId(h) === 0) return; // unit removed mid-roll
  SetUnitTimeScale(h, 1);
  PauseUnit(h, false);
  IssueImmediateOrder(h, 'stop');
}

/** Start (or extend) a roll toward the target point. Note: peasants are
 *  permanently invulnerable in this game, so no invulnerability handling. */
function startRoll(u: Unit, targetX: number, targetY: number): void {
  const s = getState(u);
  const angle = Atan2(targetY - u.y, targetX - u.x);
  s.vx = s.vx + IMPULSE * Cos(angle);
  s.vy = s.vy + IMPULSE * Sin(angle);

  SetUnitFacing(u.handle, angle * bj_RADTODEG);
  PauseUnit(u.handle, true);
  SetUnitAnimationByIndex(u.handle, ROLL_ANIM_INDEX);
  QueueUnitAnimation(u.handle, 'stand');
  SetUnitTimeScale(u.handle, ROLL_ANIM_TIME_SCALE);

  if (s.rollTimer == null) s.rollTimer = Timer.create();
  s.rollTimer.start(ROLL_DURATION, false, () => endRoll(s));
}

/** Init the dash: cast trigger (on CHANNEL for keypress-instant response)
 *  and the physics tick. Raw Timer so round resets don't kill it. */
export function initDash(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  t.addAction(() => {
    if (GetSpellAbilityId() !== DASH_ABILITY_ID) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    startRoll(u, GetSpellTargetX(), GetSpellTargetY());
  });

  Timer.create().start(TICK, true, tick);
}
