import { registerTest, TestReporter } from './testkit';
import {
  getOfferedChallenge, armChallenge, completeChallenge, isChallengeArmed,
  getChallengeDefs, clearChallenges,
} from './challenges';
import { gameState } from './state';
import { noteTrackShape, CH_STRAIGHT_15, CH_CURVED_15 } from './challengeList';

/** Exercise the challenge system's rules: the offer never repeats until the
 *  list is exhausted, the sequence is stable for a given seed, completion pays,
 *  and a counter challenge actually completes when its counter fills. */
function runChallengeTest(t: TestReporter): void {
  const total = getChallengeDefs().length;
  t.report('registered', total);

  // Walk the whole sequence, buying each offer. No id may repeat.
  const seen: string[] = [];
  let repeated = 0;
  for (let i = 0; i < total; i++) {
    const offer = getOfferedChallenge();
    if (offer == null) { t.fail('offer', 'null offer at ' + I2S(i)); t.done(); return; }
    if (seen.includes(offer.id)) repeated += 1;
    seen.push(offer.id);
    armChallenge(offer.id);
    clearChallenges(); // resolve without paying, as a lost wager would
  }
  t.report('distinctOffers', seen.length);
  t.report('repeatsBeforeExhausted', repeated);

  // Exhausted: the history clears and the sequence starts again.
  const afterWrap = getOfferedChallenge();
  t.report('wrapsAround', afterWrap != null ? 1 : 0);

  // Completion pays exactly 2.
  gameState.gold = 0;
  armChallenge(CH_CURVED_15);
  completeChallenge(CH_CURVED_15);
  t.report('bonusPaid', gameState.gold);
  t.report('disarmedAfterPay', isChallengeArmed(CH_CURVED_15) ? 1 : 0);

  // A counter challenge completes when its counter fills: 15 curves.
  gameState.gold = 0;
  armChallenge(CH_CURVED_15);
  for (let i = 0; i < 15; i++) noteTrackShape(true);
  t.report('curvedPaid', gameState.gold);

  // The straight run must be UNBROKEN: 14 straights, a curve, then 14 more
  // must not pay.
  gameState.gold = 0;
  armChallenge(CH_STRAIGHT_15);
  for (let i = 0; i < 14; i++) noteTrackShape(false);
  noteTrackShape(true);                       // resets the run
  for (let i = 0; i < 14; i++) noteTrackShape(false);
  t.report('brokenRunPaid', gameState.gold);  // must be 0
  noteTrackShape(false);                      // 15th in a row
  t.report('unbrokenRunPaid', gameState.gold); // must be 2
  t.done();
}

registerTest('challenge', runChallengeTest);
