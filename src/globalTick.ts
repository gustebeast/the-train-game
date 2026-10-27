import { Timer } from 'w3ts';

/** How often (seconds) the global tick fires. */
export const TICK_INTERVAL = 0.5;

/** A game-time clock: one timer started at init and never fired, read for
 *  its elapsed time. Game time, not os.clock: the wall clock differs between
 *  the machines in a multiplayer game -- so anything decided by it can go one
 *  way on one client and another on the next, which desyncs -- and keeps
 *  running while the game is paused. */
let clock: Timer | null = null;

/** Seconds of game time since map init. */
export function gameSeconds(): number {
  return clock != null ? clock.elapsed : 0;
}

/** Callbacks run on every tick, in registration order. */
const callbacks: Array<() => void> = [];

/** Register a callback to run every TICK_INTERVAL seconds for the whole game.
 *  Polling: reach for an event first. A listener here needs a `// periodic:`
 *  reason, or the build refuses it (scripts/check-rules.js). */
export function onGlobalTick(cb: () => void): void {
  callbacks.push(cb);
}

/** Start the whole-game periodic tick. Call once at map init, before or
 *  after registrations — callbacks only fire once the timer ticks. */
export function initGlobalTick(): void {
  // About three years: it is read, never waited for.
  // untracked: the game clock lasts the whole game.
  clock = Timer.create();
  clock.start(100000000, false, () => {});
  // untracked: the tick lasts the whole game.
  // periodic: the shared tick; every listener carries its own reason.
  Timer.create().start(TICK_INTERVAL, true, () => {
    for (const cb of callbacks) cb();
  });
}
