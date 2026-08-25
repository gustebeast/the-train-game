import { registerTest, TestReporter } from './testkit';
import { beginNight, endNight, isNight } from './daynight';

/** The clock must not move on its own.
 *
 *  Runs wherever the map happens to be when the harness reaches it, which is
 *  the start lobby -- the exact place the cycle was reported still running.
 *  Two samples several seconds apart: a frozen clock reads the same twice, and
 *  a running one does not, since WC3's default scale covers a full day in a
 *  few minutes.
 *
 *  Reported in thousandths of an hour, because the reporter takes numbers and
 *  a raw float would round away the very drift being measured. */
function runDayNightTest(t: TestReporter): void {
  const first = GetFloatGameState(GAME_STATE_TIME_OF_DAY);
  t.report('timeAtStart', R2I(first * 1000));
  t.after(8, () => {
    const second = GetFloatGameState(GAME_STATE_TIME_OF_DAY);
    t.report('timeAfter8s', R2I(second * 1000));
    const drift = R2I(math.abs(second - first) * 1000);
    t.report('driftThousandths', drift);
    if (drift !== 0) {
      t.fail('clockFrozen', 'time of day moved by ' + I2S(drift) + '/1000 hours in 8s');
    }
    t.done();
  });
}

registerTest('daynight', runDayNightTest);

/** beginNight/endNight, which is what -night drives.
 *
 *  Named 'nighttoggle' because fogtest.ts already owns 'night'.
 *
 *  Asserted against the clock rather than against the screen: the start lobby
 *  the harness lands in is mostly unexplored, so a screenshot is black whether
 *  it is noon or midnight, and brightness proves nothing there. */
function runNightTest(t: TestReporter): void {
  beginNight();
  t.report('nightIsNight', isNight() ? 1 : 0);
  const atNight = R2I(GetFloatGameState(GAME_STATE_TIME_OF_DAY) * 1000);
  t.report('timeAtNight', atNight);
  if (atNight !== 0) t.fail('timeAtNight', 'expected midnight, got ' + I2S(atNight));

  endNight();
  t.report('backToDay', isNight() ? 1 : 0);
  const atDay = R2I(GetFloatGameState(GAME_STATE_TIME_OF_DAY) * 1000);
  t.report('timeAfterEndNight', atDay);
  if (atDay !== 12000) t.fail('timeAfterEndNight', 'expected noon, got ' + I2S(atDay));

  // And the clock must still be frozen afterwards -- a night that leaves the
  // scale running would put the cycle straight back.
  t.after(6, () => {
    const later = R2I(GetFloatGameState(GAME_STATE_TIME_OF_DAY) * 1000);
    t.report('stillFrozenAfterNight', later);
    if (later !== 12000) {
      t.fail('stillFrozenAfterNight', 'clock resumed after a night: ' + I2S(later));
    }
    t.done();
  });
}

registerTest('nighttoggle', runNightTest);
