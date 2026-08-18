import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';

// Dash = a short, sharp movement-speed boost that reuses WC3's own pathing.
//
// Everything else was tried and rejected. Moving the unit by hand (SetUnitX/Y)
// needs hand-rolled collision that can't reproduce the engine's dynamics —
// especially against the moving train — and SetUnitPosition collides but
// interrupts the unit's current order. Driving it with our own move order works
// for pathing but replaces the player's order queue, so a shift-queued
// move -> dash -> move loses the last move.
//
// So the dash issues no order of its own when the player already has one
// queued: it just makes the next movement fast, and the engine does the rest.
// Only when nothing is queued (a bare dash on an idle peasant) does it send the
// unit at the cast point itself — safe there precisely because the queue is
// empty. No 'stop' is ever issued, so the queue advances with no delay.
const DASH_SPEED = 522; // WC3's default max move speed (peasant base is ~190)
const DASH_DURATION = 0.5; // seconds of boosted speed
const DASH_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js

interface DashState {
  timer: Timer;
  baseSpeed: number;
}

/** Peasants currently dashing, keyed by handle. */
const dashing = new Map<unit, DashState>();

/** True while the unit is mid-dash. */
export function isDashing(h: unit): boolean {
  return dashing.has(h);
}

/** End the dash: restore the unit's normal speed. Issues NO order — a 'stop'
 *  here would discard whatever the player queued behind the dash. */
function endDash(h: unit): void {
  const s = dashing.get(h);
  if (s == null) return;
  s.timer.destroy();
  dashing.delete(h);
  if (GetUnitTypeId(h) === 0) return; // unit removed mid-dash
  SetUnitMoveSpeed(h, s.baseSpeed);
  SetUnitTimeScale(h, 1);
}

function startDash(u: Unit, targetX: number, targetY: number): void {
  const h = u.handle;

  // Re-dashing: keep the original speed, don't capture the boosted one.
  const existing = dashing.get(h);
  const baseSpeed = existing != null ? existing.baseSpeed : GetUnitMoveSpeed(h);
  if (existing != null) existing.timer.destroy();

  SetUnitMoveSpeed(h, DASH_SPEED);
  SetUnitAnimationByIndex(h, DASH_ANIM_INDEX);
  QueueUnitAnimation(h, 'stand');

  const timer = Timer.create();
  dashing.set(h, { timer, baseSpeed });
  timer.start(DASH_DURATION, false, () => endDash(h));

  // Shortly after, the cast has resolved and the queue has advanced: the
  // current order is either whatever the player queued behind the dash, or
  // nothing (still the cast itself, or idle). Only in the latter case do we
  // supply a destination — that way a queued order is never clobbered.
  Timer.create().start(0.10, false, () => {
    if (GetUnitTypeId(h) === 0) return;
    const ord = GetUnitCurrentOrder(h);
    // Idle, or still showing the dash's own cast order: nothing was queued.
    if (ord === 0 || ord === OrderId('flare')) {
      IssuePointOrder(h, 'move', targetX, targetY);
    }
  });
}

/** Init the dash: cast trigger on CHANNEL for keypress-instant response. */
export function initDash(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  t.addAction(() => {
    if (GetSpellAbilityId() !== DASH_ABILITY_ID) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    startDash(u, GetSpellTargetX(), GetSpellTargetY());
  });
}
