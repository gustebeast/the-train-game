import { registerTest, TestReporter } from './testkit';
import { armChallenge, clearChallenges } from './challenges';
import { CH_NIGHT_BLACKOUT } from './challengeList';
import {
  beginNight, endNight, isNight, startDayNightForRound, cancelNightForVictory,
} from './daynight';
import { Players } from 'w3ts/globals';
import { getWorldBounds } from './util';

/** Does the Blackout challenge give the map back at dawn?
 *
 *  The worry worth testing: a fog modifier that masks the world might also wipe
 *  what each player has EXPLORED, so dawn would leave the map black rather than
 *  restored. WC3 exposes the three fog states per point, so this can be
 *  measured rather than eyeballed.
 *
 *  The probe point is explored first (a temporary VISIBLE modifier, started then
 *  stopped) so it sits in the interesting state: explored but not currently
 *  visible. Masked there after dawn would mean exploration was lost. */
function runFogTest(t: TestReporter): void {
  const p = Players[0].handle;
  const world = getWorldBounds();
  // Far from the spawn so no unit keeps it lit.
  const x = GetRectMaxX(world) - 512;
  const y = GetRectMinY(world) + 512;

  const reveal = CreateFogModifierRect(p, FOG_OF_WAR_VISIBLE, world, false, false);
  if (reveal != null) FogModifierStart(reveal);

  t.after(1, () => {
    if (reveal != null) {
      FogModifierStop(reveal);
      DestroyFogModifier(reveal);
    }
    t.after(1, () => {
      // Explored, no longer visible: fogged, not masked.
      t.report('maskedAfterExplore', IsMaskedToPlayer(x, y, p) ? 1 : 0);
      t.report('foggedAfterExplore', IsFoggedToPlayer(x, y, p) ? 1 : 0);

      armChallenge(CH_NIGHT_BLACKOUT);
      beginNight();
      t.after(2, () => {
        t.report('isNight', isNight() ? 1 : 0);
        t.report('maskedDuringNight', IsMaskedToPlayer(x, y, p) ? 1 : 0);

        endNight();
        // The dawn restore flashes visibility and clears it a frame later, so
        // give it time to settle before reading the fog back.
        t.after(3, () => {
          t.report('isNightAfterDawn', isNight() ? 1 : 0);
          // The point of the whole test: exploration survived the blackout.
          t.report('maskedAfterDawn', IsMaskedToPlayer(x, y, p) ? 1 : 0);
          t.report('foggedAfterDawn', IsFoggedToPlayer(x, y, p) ? 1 : 0);
          clearChallenges();
          t.done();
        });
      });
    });
  });
}

registerTest('fog', runFogTest);

/** The day/night rules that are not about fog: a round starts in day, night can
 *  be entered, and a victory both cancels a pending night and ends one already
 *  running so the victory lap is never run in the dark. */
function runNightRulesTest(t: TestReporter): void {
  startDayNightForRound();
  t.report('startsInDay', isNight() ? 0 : 1);

  beginNight();
  t.report('nightBegan', isNight() ? 1 : 0);

  // Victory during night must return to day immediately.
  cancelNightForVictory();
  t.report('dayAfterVictory', isNight() ? 0 : 1);

  // And a victory before nightfall must leave the round in day for good.
  startDayNightForRound();
  cancelNightForVictory();
  t.after(2, () => {
    t.report('stillDayAfterCancel', isNight() ? 0 : 1);
    t.done();
  });
}

registerTest('night', runNightRulesTest);
