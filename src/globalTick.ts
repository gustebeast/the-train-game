import { Timer } from 'w3ts';

/** How often (seconds) the global tick fires. */
const TICK_INTERVAL = 0.5;

/** Callbacks run on every tick, in registration order. */
const callbacks: Array<() => void> = [];

/** Register a callback to run every TICK_INTERVAL seconds for the whole game.
 *  Shared by recurring whole-game services (minimap icon scanning, camera
 *  zoom lock, ...) so they don't each need their own timer. */
export function onGlobalTick(cb: () => void): void {
  callbacks.push(cb);
}

/** Start the whole-game periodic tick. Call once at map init, before or
 *  after registrations — callbacks only fire once the timer ticks. */
export function initGlobalTick(): void {
  // Raw Timer (not timers.ts createTimer) so the round-reset
  // destroyAllTimers() doesn't kill it
  Timer.create().start(TICK_INTERVAL, true, () => {
    for (const cb of callbacks) cb();
  });
}
