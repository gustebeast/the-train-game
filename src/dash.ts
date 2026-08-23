import { Timer, Trigger, Unit } from 'w3ts';
import { DASH_ABILITY_ID, PEASANT_ID } from './constants';
import { noteDash } from './challengeList';

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
// Started by hand at the moment the boost does, because the engine would
// otherwise start it when the spell fires -- and the spell fires on ARRIVAL.
// Dash somewhere distant and the whole boost would run before any cooldown
// began, so a second dash could be cast the instant the first one started
// moving. The ability's own cooldown is 0 (compiletime.ts) so the arrival
// no-op cannot restart what is already ticking.
const DASH_COOLDOWN = 4.0;
// The roll is the peasant's ALTERNATE WALK (scripts/roll-anim-to-alternate-walk.js),
// so switching it on is a single property the engine reads while the unit
// moves. Forcing the sequence directly instead -- SetUnitAnimationByIndex --
// does not survive: a moving unit has its walk animation re-asserted by the
// engine, which is why the dash used to show a speed change and no roll.

interface DashState {
  timer: Timer;
  baseSpeed: number;
}

/** Peasants currently dashing, keyed by handle. */
const dashing = new Map<unit, DashState>();

/** Cooldown timers, keyed by handle. These outlive the dash itself: the boost
 *  lasts under a second and the cooldown several, so they cannot share a timer
 *  with DashState. Their only job is to remember how much cooldown is left. */
const cooldowns = new Map<unit, Timer>();

/** Put the dash on cooldown from RIGHT NOW. */
function startCooldown(h: unit): void {
  const previous = cooldowns.get(h);
  if (previous != null) previous.destroy();
  BlzStartUnitAbilityCooldown(h, DASH_ABILITY_ID, DASH_COOLDOWN);
  const timer = Timer.create();
  cooldowns.set(h, timer);
  timer.start(DASH_COOLDOWN, false, () => {
    const t = cooldowns.get(h);
    if (t != null) { t.destroy(); cooldowns.delete(h); }
  });
}

/** Re-assert whatever cooldown is still owed. Casting an ability whose own
 *  cooldown is 0 is the engine setting a 0-second cooldown, which would wipe
 *  the one already running -- and the dash's cast lands on ARRIVAL, right in
 *  the middle of it. Reapplying the remainder is a no-op if the engine left it
 *  alone, and repairs it if it did not. */
function restoreCooldown(h: unit): void {
  const timer = cooldowns.get(h);
  if (timer == null) return;
  const left = timer.remaining;
  if (left > 0.05) BlzStartUnitAbilityCooldown(h, DASH_ABILITY_ID, left);
}

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
  AddUnitAnimationProperties(h, 'alternate', false);
}

function startDash(h: unit): void {
  // Re-dashing: keep the original speed, don't capture the boosted one.
  const existing = dashing.get(h);
  const baseSpeed = existing != null ? existing.baseSpeed : GetUnitMoveSpeed(h);
  if (existing != null) existing.timer.destroy();

  dbg.started = dbg.started + 1;
  startCooldown(h);
  SetUnitMoveSpeed(h, DASH_SPEED);
  AddUnitAnimationProperties(h, 'alternate', true);

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
    noteDash();
    endDash(u.handle);
    restoreCooldown(u.handle);
  });
}
