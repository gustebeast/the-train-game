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
const BARE_DASH_GRACE = 0.12; // s to wait before deciding the queue is empty
const DASH_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js

interface DashState {
  timer: Timer;
  baseSpeed: number;
}

/** Peasants currently dashing, keyed by handle. */
const dashing = new Map<unit, DashState>();

// Diagnostics, read through a function: TSTL importers snapshot a mutable
// `export let`, so an exported variable would always read its initial value.
const dbg = { tx: -99999, ty: -99999, ord: -1, issued: 0 };
export function getDashDebug(): number[] {
  return [dbg.tx, dbg.ty, dbg.ord, dbg.issued];
}

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
  dbg.tx = targetX; dbg.ty = targetY; dbg.ord = -1; dbg.issued = 0;

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

  // Channel is a CHANNELLING spell: its order stays current until something
  // interrupts it. A queued order does that by itself (which is why a
  // shift-queued move runs straight after the dash, and why we must not touch
  // it). With an empty queue nothing interrupts, so the peasant would just
  // stand there mid-channel — the "turned around and did nothing" case.
  //
  // That difference is the discriminator: if the channel is STILL running a
  // beat after the cast, the queue was empty, and only then do we end it and
  // supply the dash's own destination.
  const dashOrder = OrderId('flare');
  const poll = Timer.create();
  let waited = 0;
  poll.start(0.02, true, () => {
    waited = waited + 0.02;
    if (GetUnitTypeId(h) === 0) { poll.destroy(); return; }
    const ord = GetUnitCurrentOrder(h);
    dbg.ord = ord;
    if (ord !== dashOrder) { poll.destroy(); return; } // something queued — leave it
    if (waited < BARE_DASH_GRACE) return;              // still deciding
    poll.destroy();
    // Nothing was queued: end the channel and dash to the cast point. The stop
    // is safe precisely because there is no queue to discard.
    IssueImmediateOrder(h, 'stop');
    Timer.create().start(0.02, false, () => {
      if (GetUnitTypeId(h) === 0) return;
      dbg.issued = IssuePointOrder(h, 'move', targetX, targetY) ? 1 : 2;
    });
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
