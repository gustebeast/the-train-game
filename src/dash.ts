import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';

// Dash = a normal move at boosted speed, so WC3's own pathing handles all
// collision (including the moving train, which hand-rolled collision could not
// reproduce).
//
// The cast is turned into a walk by the OBJECT DATA, not by trigger code: the
// ability's cast range is tiny (see compiletime.ts), so ordering it at a distant
// point makes the engine walk the caster there first. That approach move is the
// engine's own, so it sits in the order queue correctly, completes the way any
// move completes, and lets whatever the player queued behind it run. Appending
// our own move behind the cast -- the previous approach -- could leave an order
// the engine never finished, which stalled the rest of the queue forever.
//
//   move right  ->  dash (cast)  ->  move right
//                   `-- engine walks to the point, then the spell fires
//
// All that is left for code is to start the speed boost at the moment that walk
// BEGINS rather than when the spell finally goes off, so casting far away reads
// as "dash off now, then walk the rest of the way" instead of "stroll over
// there, then twitch".
//
// Finding that moment needs no polling: WC3 fires the order event a second time
// when a queued order becomes the current one. At click time the dash is still
// waiting behind other orders and the unit's current order is something else; at
// execution time the current order IS the dash. That comparison is the whole
// trick.
const DASH_SPEED = 522; // WC3's default max move speed (peasant base is ~190)
const DASH_DURATION = 0.6; // seconds of boosted speed
const DASH_ANIM_INDEX = 22; // 'Roll' — transplanted, scripts/transplant-roll-anim.js

interface DashState {
  timer: Timer;
  baseSpeed: number;
}

/** Peasants currently dashing, keyed by handle. */
const dashing = new Map<unit, DashState>();

// Diagnostics, read through a function: TSTL importers snapshot a mutable
// `export let`, so an exported variable would always read its initial value.
// events = flare order events seen, atQueue/atExec = how many of those arrived
// with the dash still queued vs already current.
const dbg = { tx: -99999, ty: -99999, events: 0, atQueue: 0, atExec: 0, started: 0 };
export function getDashDebug(): number[] {
  return [dbg.tx, dbg.ty, dbg.events, dbg.atQueue, dbg.atExec, dbg.started];
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

function startDash(h: unit): void {
  // Re-dashing: keep the original speed, don't capture the boosted one.
  const existing = dashing.get(h);
  const baseSpeed = existing != null ? existing.baseSpeed : GetUnitMoveSpeed(h);
  if (existing != null) existing.timer.destroy();

  dbg.started = dbg.started + 1;
  SetUnitMoveSpeed(h, DASH_SPEED);
  SetUnitAnimationByIndex(h, DASH_ANIM_INDEX);
  QueueUnitAnimation(h, 'stand');

  const timer = Timer.create();
  dashing.set(h, { timer, baseSpeed });
  timer.start(DASH_DURATION, false, () => endDash(h));
}

export function initDash(): void {
  const flare = OrderId('flare');

  const issued = Trigger.create();
  issued.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  issued.addAction(() => {
    if (GetIssuedOrderId() !== flare) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    const h = u.handle;
    dbg.tx = GetOrderPointX(); dbg.ty = GetOrderPointY();
    dbg.events = dbg.events + 1;
    // Still sitting in the queue behind something else: the event will come
    // round again when the peasant actually starts heading for the point.
    if (GetUnitCurrentOrder(h) !== flare) { dbg.atQueue = dbg.atQueue + 1; return; }
    dbg.atExec = dbg.atExec + 1;
    startDash(h);
  });

  // Arriving ends the boost early: there is nothing left to dash across, and
  // letting it run on would hand the next queued order a peasant still moving at
  // dash speed. It deliberately does NOT start one -- the boost belongs to the
  // walk, and by the time the spell goes off the walk is over.
  const cast = Trigger.create();
  cast.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  cast.addAction(() => {
    if (GetSpellAbilityId() !== DASH_ABILITY_ID) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    endDash(u.handle);
  });
}
