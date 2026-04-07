import { Timer } from 'w3ts';

/** All active gameplay timers. Destroyed on cleanup between rounds. */
const activeTimers = new Set<Timer>();

/** Create a tracked timer that will be destroyed on cleanup. */
export function createTimer(): Timer {
  const t = Timer.create();
  activeTimers.add(t);
  return t;
}

/** Start a one-shot tracked timer. Automatically unregisters when it fires. */
export function startOneShot(duration: number, cb: () => void): Timer {
  const t = createTimer();
  t.start(duration, false, () => {
    activeTimers.delete(t);
    t.destroy();
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
