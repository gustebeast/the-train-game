import { Timer } from 'w3ts';
import { registerTest, TestReporter } from './testKit';
import { registerReadyZone, createReadyZone } from '../ready';
import { PEASANT_ID } from '../constants';
import { getHumanPlayers, forEachUnitOfPlayer } from '../util';
import { loadStartLobby } from '../terrain/load';

/**
 * How long a ready countdown actually runs.
 *
 * The start-the-round circle waits out the DPS check's minimum, so its
 * countdown is three seconds or however long the check still needs, whichever
 * is longer -- and it asks again at zero, because a reroll mid-countdown
 * restarts the check. Three throwaway zones, timed from the moment the peasant
 * steps on to the moment the callback fires:
 *
 *   plain   -- no wait asked for: the usual three seconds;
 *   wait    -- seven seconds still needed: seven;
 *   late    -- nothing needed at the start, two more by the time it reaches
 *              zero (what a reroll does): three, then two more.
 *
 * The zones sit out in the strips beside the lobby, where nothing else is, and
 * the peasant is teleported on and off; entering a region by teleport fires the
 * same event as walking in.
 */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-1984, -950], [-1984, 0], [-1984, 950],
];

function runReadyTest(t: TestReporter): void {
  // A known board: the strips beside the start lobby are open ground. Run
  // after a test that left a round loaded, the third spot had terrain on it,
  // the peasant was shoved off the circle, and the countdown never began.
  // The peasant is looked for a moment later, not straight away: units a
  // board stands up straight after loading can be replaced within a frame.
  loadStartLobby();
  t.after(0.5, () => runReadyCases(t));
}

function runReadyCases(t: TestReporter): void {
  const humans = getHumanPlayers();
  let peasant: unit | null = null;
  if (humans.length > 0) {
    forEachUnitOfPlayer(humans[0].handle, u => {
      if (peasant == null && GetUnitTypeId(u) === PEASANT_ID) peasant = u;
    });
  }
  if (peasant == null || humans.length !== 1) {
    // Every human must be ready for a countdown to start; this drives one.
    t.fail('setup', 'needs exactly one human with a peasant');
    t.done();
    return;
  }
  const p: unit = peasant;
  const homeX = GetUnitX(p);
  const homeY = GetUnitY(p);
  const clock = Timer.create();
  clock.start(3600, false, () => {});

  let lateCalls = 0;
  /** When the 'wait' case's peasant stepped on. */
  let waitFrom = 0;
  const cases: Array<{ id: string; seconds?: () => number; want: number }> = [
    { id: 'readytest_plain', want: 3 },
    // Shrinking as time passes, as the DPS check's remaining minimum
    // does -- a wait that never shrinks would never let the countdown end.
    { id: 'readytest_wait', seconds: () => Math.max(0, 7 - (clock.elapsed - waitFrom)), want: 7 },
    {
      id: 'readytest_late',
      // 0 when asked at the start, 2 when asked at zero, 0 after that.
      seconds: () => { lateCalls += 1; return lateCalls === 2 ? 2 : 0; },
      want: 5,
    },
  ];

  const runCase = (i: number): void => {
    if (i >= cases.length) {
      SetUnitPosition(p, homeX, homeY);
      clock.destroy();
      t.done();
      return;
    }
    const c = cases[i];
    const [x, y] = SPOTS[i];
    let started = 0;
    registerReadyZone(c.id, 'Test countdown', t.guard(() => {
      const took = clock.elapsed - started;
      t.report(c.id, took);
      if (Math.abs(took - c.want) > 0.6) {
        t.fail(c.id, 'expected about ' + I2S(c.want) + 's');
      }
      // Off the circle before the next one, so it cannot fire again.
      SetUnitPosition(p, homeX, homeY);
      t.after(1, () => runCase(i + 1));
    }), undefined, c.seconds);
    createReadyZone(x, y, c.id);
    started = clock.elapsed;
    waitFrom = started;
    SetUnitPosition(p, x, y);
    // Where it actually landed: a circle it was shoved off cannot count it,
    // and would leave the test waiting forever for a countdown that never
    // starts -- so say so and stop instead.
    const dx = GetUnitX(p) - x;
    const dy = GetUnitY(p) - y;
    t.report(c.id + '_landedDX', dx);
    t.report(c.id + '_landedDY', dy);
    if (Math.abs(dx) > 100 || Math.abs(dy) > 100) {
      t.fail(c.id, 'peasant landed off the circle');
      SetUnitPosition(p, homeX, homeY);
      clock.destroy();
      t.done();
    }
  };
  t.after(0.5, () => runCase(0));
}

registerTest('readywait', runReadyTest);
