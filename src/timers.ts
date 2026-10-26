import { Timer } from 'w3ts';

/** Timers that belong to the current board. destroyAllTimers sweeps them when
 *  the board is torn down, so a round's pending work cannot fire into the next
 *  board.
 *
 *  Only for timers whose life ends with the board. A module that already
 *  cancels its own timers on every exit (daynight.ts) keeps them untracked:
 *  tracking them too means the sweep can destroy one the module still holds,
 *  and the module's own cancel then destroys it a second time. */
const activeTimers = new Set<Timer>();

/** Create a tracked timer that will be destroyed on cleanup. */
export function createTimer(): Timer {
  const t = Timer.create();
  activeTimers.add(t);
  return t;
}

/** Destroy a tracked timer before the sweep does, and stop tracking it. */
export function destroyTimer(t: Timer): void {
  activeTimers.delete(t);
  t.destroy();
}

/** Start a one-shot tracked timer. Automatically unregisters when it fires. */
export function startOneShot(duration: number, cb: () => void): Timer {
  const t = createTimer();
  t.start(duration, false, () => {
    destroyTimer(t);
    cb();
  });
  return t;
}

/** Destroy all active gameplay timers. Called during terrain cleanup. */
export function destroyAllTimers(): void {
  for (const t of activeTimers) {
    t.destroy();
  }
  activeTimers.clear();
}
