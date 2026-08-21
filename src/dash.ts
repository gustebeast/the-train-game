import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';
import { nextFrame } from './util';

// Dash = a normal move at boosted speed, so WC3's own pathing handles all
// collision (including the moving train, which hand-rolled collision could not
// reproduce).
//
// The trick is turning a CAST at a point into a WALK to that point without
// destroying what the player queued behind it. IssuePointOrder replaces the
// whole queue, and BlzQueue* appends to the end — neither lands in the right
// slot. But an order fires its event when it is ISSUED, not when it runs, so at
// the moment the player shift-clicks the dash the queue ends with the dash and
// nothing after it yet. Appending a move there puts it immediately behind the
// dash; anything the player shift-clicks next queues up after it. Same
// substitution give/take does to a queued channel order.
//
//   move right  ->  dash (cast)  ->  [our move to the cast point]  ->  move right
//                      speed boost covers this leg, so it reads as a dash
//
// A bare dash with nothing queued works by the same path: the appended move is
// simply the only thing behind the cast.
const DASH_SPEED = 522; // WC3's default max move speed (peasant base is ~190)
const DASH_DURATION = 0.6; // seconds of boosted speed
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

function startDash(u: Unit): void {
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
}

export function initDash(): void {
  // Issue time: put a move to the cast point directly behind the dash, before
  // the player has queued anything after it.
  const issued = Trigger.create();
  issued.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  issued.addAction(() => {
    if (GetIssuedOrderId() !== OrderId('flare')) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    const h = u.handle;
    const x = GetOrderPointX();
    const y = GetOrderPointY();
    dbg.tx = x; dbg.ty = y; dbg.issued = 1;
    // A frame later, so the dash order is committed to the queue first —
    // queueing from inside its own order event lands in the wrong place and
    // swallowed whatever the player queued next. give/take defers its
    // substitution the same way.
    nextFrame(() => BlzQueuePointOrderById(h, OrderId('move'), x, y));
  });

  // Cast time: the boost, which covers the move queued above.
  const cast = Trigger.create();
  cast.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  cast.addAction(() => {
    if (GetSpellAbilityId() !== DASH_ABILITY_ID) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    startDash(u);
  });
}
