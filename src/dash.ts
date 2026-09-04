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
// Timed from the moment the boost starts, because the engine would otherwise
// start it when the spell FIRES -- and this spell fires on arrival. Dash
// somewhere distant and the whole boost ran before any cooldown began, so a
// second dash could be cast the instant the first one set off.
//
// It is a timer and nothing else -- the engine is never told. Putting the
// ability on cooldown while its own order is executing makes WC3 cancel the
// cast, which reads in game as the dash issuing a stop; and setting it after
// the cast puts a command-card cooldown on screen at the moment the peasant
// arrives, which is not what the rule means. The ability's own cooldown is 0
// (compiletime.ts), so nothing in game ever shows one.
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

/** Seconds of cooldown still owed, 0 if the dash is ready. */
function cooldownLeft(h: unit): number {
  const timer = cooldowns.get(h);
  if (timer == null) return 0;
  const left = timer.remaining;
  return left > 0 ? left : 0;
}

/** Begin the cooldown. The engine is never told about it at all.
 *
 *  Telling it mid-cast breaks the dash outright: the boost starts at the moment
 *  the ability's own order begins executing, and putting that ability on
 *  cooldown mid-order makes WC3 cancel the cast -- the peasant stops dead,
 *  never reaches the point, and the order never completes.
 *
 *  Telling it after the cast is no better: the cast lands when the peasant
 *  ARRIVES, so a command-card cooldown would appear at the end of the dash, out
 *  of step with the rule it represents.
 *
 *  So this timer is the whole cooldown. Nothing about it is visible: the dash
 *  stays castable throughout and simply gives no boost until the timer runs
 *  out. */
function startCooldown(h: unit): void {
  const previous = cooldowns.get(h);
  if (previous != null) previous.destroy();
  const timer = Timer.create();
  cooldowns.set(h, timer);
  timer.start(DASH_COOLDOWN, false, () => {
    const t = cooldowns.get(h);
    if (t != null) { t.destroy(); cooldowns.delete(h); }
  });
}

// Diagnostics, read through a function: TSTL importers snapshot a mutable
// `export let`, so an exported variable would always read its initial value.
// events = flare order events seen, atQueue/atExec = how many of those arrived
// with the dash still queued vs already current.
const dbg = { tx: -99999, ty: -99999, events: 0, atQueue: 0, atExec: 0, started: 0 };
export function getDashDebug(): number[] {
  return [dbg.tx, dbg.ty, dbg.events, dbg.atQueue, dbg.atExec, dbg.started];
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
  // On cooldown: let the order run as an ordinary walk rather than refusing it.
  // Blocking the order is what cancels the cast and strands the queue, so the
  // cooldown withholds the BOOST instead -- which is the thing being limited.
  if (cooldownLeft(h) > 0) return;

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
  });
}
