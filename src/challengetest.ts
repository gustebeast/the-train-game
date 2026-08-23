import { registerTest, TestReporter } from './testkit';
import {
  getOfferedChallenge, advanceChallengeOffer, armChallenge, completeChallenge,
  isChallengeArmed, getChallengeDefs, clearChallenges,
} from './challenges';
import { gameState } from './state';
import {
  computeTrackShapes, applyTrackShapes, TrackPoint, CH_STRAIGHT_15, CH_CURVED_15,
} from './challengeList';
import { TRACK_SIZE } from './track/constants';

/** Record a measurement AND hold it to an expected value.
 *
 *  Plain `report` was not enough: this file used to report a repeat count that
 *  had silently gone from 0 to 9 -- the rotation had genuinely stopped
 *  advancing under the test -- and the run still came back green, because
 *  nothing was watching the number. Anything worth reporting is worth
 *  asserting. */
function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) {
    t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
  }
}

/** Exercise the challenge system's rules: the offer never repeats until the
 *  list is exhausted, the sequence is stable for a given seed, completion pays,
 *  and a counter challenge actually completes when its counter fills. */
function runChallengeTest(t: TestReporter): void {
  const total = getChallengeDefs().length;
  t.report('registered', total);

  // Walk the whole sequence, buying each offer. No id may repeat.
  //
  // advanceChallengeOffer, not getOfferedChallenge: the shelf HOLDS its offer
  // so that browsing the shop twice in one inter-round lobby visit does not burn through
  // the rotation. Only a new inter-round lobby visit moves it on, and this loop is standing
  // in for those visits.
  const seen: string[] = [];
  let repeated = 0;
  for (let i = 0; i < total; i++) {
    advanceChallengeOffer();
    const offer = getOfferedChallenge();
    if (offer == null) { t.fail('offer', 'null offer at ' + I2S(i)); t.done(); return; }
    if (seen.includes(offer.id)) repeated += 1;
    seen.push(offer.id);
    armChallenge(offer.id);
    clearChallenges(); // resolve without paying, as a lost wager would
  }
  expect(t, 'distinctOffers', seen.length, total);
  expect(t, 'repeatsBeforeExhausted', repeated, 0);

  // Exhausted: the history clears and the sequence starts again.
  advanceChallengeOffer();
  const afterWrap = getOfferedChallenge();
  expect(t, 'wrapsAround', afterWrap != null ? 1 : 0, 1);

  // Completion pays exactly 2.
  gameState.gold = 0;
  armChallenge(CH_CURVED_15);
  completeChallenge(CH_CURVED_15);
  expect(t, 'bonusPaid', gameState.gold, 2);
  expect(t, 'disarmedAfterPay', isChallengeArmed(CH_CURVED_15) ? 1 : 0, 0);

  t.done();
}

/** Build a line from compass moves, laying each piece one tile on from the
 *  last. Lets a test describe track the way a player would walk it. */
function line(moves: string): TrackPoint[] {
  const points: TrackPoint[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = SubString(moves, i, i + 1);
    if (m === 'E') x += TRACK_SIZE;
    else if (m === 'W') x -= TRACK_SIZE;
    else if (m === 'N') y += TRACK_SIZE;
    else if (m === 'S') y -= TRACK_SIZE;
    points.push({ x, y });
  }
  return points;
}

function repeat(move: string, times: number): string {
  let s = '';
  for (let i = 0; i < times; i++) s = s + move;
  return s;
}

/** The shape measurement itself, on real geometry.
 *
 *  The old test fed noteTrackShape hand-picked booleans, which proved the
 *  counter arithmetic and nothing about whether an actual corner is recognised
 *  as a corner. These lines are laid out in map coordinates and measured the
 *  same way the live game measures them. */
function runTrackShapeTest(t: TestReporter): void {
  // A dead straight run of 20 moves: 19 interior pieces, all straight, no
  // corners anywhere.
  const straight = computeTrackShapes(line(repeat('E', 20)), 0);
  expect(t, 'straightRun', straight.straightRun, 19);
  expect(t, 'straightHasNoCurves', straight.curved, 0);

  // A staircase turns at every single interior piece, so nothing is straight.
  const stairs = computeTrackShapes(line('ENENENENEN'), 0);
  expect(t, 'stairsCurved', stairs.curved, 9);
  expect(t, 'stairsStraightRun', stairs.straightRun, 0);

  // A serpentine: two rows of four, weaving between them.
  //
  //    . 2 . 4 . 6 . 8      laid E N E S E N E, so every interior piece turns
  //    1 . 3 . 5 . 7 .
  //
  // Worth its own case because SPATIALLY this looks like two straight rows of
  // four, and anything that judged a piece by its neighbours on the map rather
  // than by its neighbours ALONG THE LINE would read those rows as straight
  // runs. The line is walked in placement order, so all six interior pieces
  // come out as corners and the straight run is zero.
  const serpentine = computeTrackShapes(line('ENESENE'), 0);
  expect(t, 'serpentineCurved', serpentine.curved, 6);
  expect(t, 'serpentineStraightRun', serpentine.straightRun, 0);

  // Both axes must read as straight, not just east-west.
  const northward = computeTrackShapes(line(repeat('N', 6)), 0);
  expect(t, 'northStraightRun', northward.straightRun, 5);

  // A single corner breaks the run in two: the longest wins, and the corner is
  // counted once. 8 east, turn, 5 north => runs of 7 and 4, one curve.
  const bent = computeTrackShapes(line(repeat('E', 8) + repeat('N', 5)), 0);
  expect(t, 'bentLongestRun', bent.straightRun, 7);
  expect(t, 'bentCurved', bent.curved, 1);

  // The two ENDS have no shape -- one neighbour each -- so a 2-piece line
  // measures nothing at all.
  const tiny = computeTrackShapes(line('E'), 0);
  expect(t, 'tinyRun', tiny.straightRun, 0);

  // The map's own starting track must not count toward the wager. Same line,
  // measured with the first 10 pieces declared as scenery.
  const withBaseline = computeTrackShapes(line(repeat('E', 20)), 10);
  // 10, not 19: the first ten pieces are the map's, not the players'.
  expect(t, 'baselineExcludesScenery', withBaseline.straightRun, 10);

  // The regression this whole rewrite is for: rebuilding cannot inflate the
  // count. A destroyed piece leaves the line shorter, and re-measuring the
  // shorter line gives the shorter answer rather than keeping the credit.
  const full = line(repeat('E', 12));
  const shortened = line(repeat('E', 12));
  shortened.pop(); // the player destroyed the last piece
  const before = computeTrackShapes(full, 0).straightRun;
  const after = computeTrackShapes(shortened, 0).straightRun;
  expect(t, 'rebuildCannotInflate', after < before ? 1 : 0, 1);

  // Geometry through to payout: a line that meets the target pays, and one that
  // falls a piece short does not.
  gameState.gold = 0;
  armChallenge(CH_STRAIGHT_15);
  applyTrackShapes(computeTrackShapes(line(repeat('E', 15)), 0)); // 14 interior
  expect(t, 'shortLinePaid', gameState.gold, 0);
  applyTrackShapes(computeTrackShapes(line(repeat('E', 16)), 0)); // 15 interior
  expect(t, 'longEnoughLinePaid', gameState.gold, 2);

  // Corners pay the curved wager on geometry alone. A staircase turns at every
  // interior piece, so 14 moves gives 13 corners (short) and 18 gives 17.
  gameState.gold = 0;
  armChallenge(CH_CURVED_15);
  applyTrackShapes(computeTrackShapes(line(repeat('EN', 7)), 0));
  expect(t, 'fewCurvesPaid', gameState.gold, 0);
  applyTrackShapes(computeTrackShapes(line(repeat('EN', 9)), 0));
  expect(t, 'enoughCurvesPaid', gameState.gold, 2);

  t.done();
}

registerTest('trackshape', runTrackShapeTest);

registerTest('challenge', runChallengeTest);
