import { registerTest, TestReporter } from './testKit';
import { beginNewRun, difficultyForRound, loadTerrain } from '../terrain/load';
import { GRANITE_RAW } from '../sharedData';
import { getTrain } from '../train';
import { getWorldBounds } from '../util';
import { CREEP_CAMPS } from '../creepCamps';
import { getMercCampLevel } from '../mercenary';
import { rollCreepCamp, getCampData, getCampIndex, clearCampRotation } from '../creeps';

/** The camp rotation: an even split across levels, and a lap per level.
 *
 *  Rolls without a mercenary, so only level 1 is unlocked -- which is exactly
 *  what makes the lap testable: every roll must come from the level 1 pool,
 *  must not repeat until that pool is exhausted, and must then start again. */
function runCampTest(t: TestReporter): void {
  // From a fresh run: a batch's earlier tests can leave a mercenary hired,
  // which unlocks level 2 and puts its camps in the roll (seen as wrongLevel
  // whenever this ran after them).
  beginNewRun();
  t.expect('onlyLevel1Unlocked', getMercCampLevel(), 1);
  let atLevel = 0;
  for (const c of CREEP_CAMPS) if (c.level === 1) atLevel += 1;
  t.report('level1Camps', atLevel);
  t.report('totalCamps', CREEP_CAMPS.length);

  clearCampRotation();
  const seen: number[] = [];
  let repeatsInLap = 0;
  let wrongLevel = 0;
  for (let i = 0; i < atLevel; i++) {
    rollCreepCamp();
    const camp = getCampData();
    const idx = getCampIndex();
    if (camp == null || idx == null) { t.fail('roll', 'no camp at ' + I2S(i)); t.done(); return; }
    if (camp.level !== 1) wrongLevel += 1;
    if (seen.includes(idx)) repeatsInLap += 1;
    seen.push(idx);
  }
  // A full lap must visit every camp at the level exactly once.
  t.report('distinctInLap', seen.length - repeatsInLap);
  if (repeatsInLap !== 0) {
    t.fail('repeatsInLap', I2S(repeatsInLap) + ' camps repeated before the lap ended');
  }
  if (wrongLevel !== 0) {
    t.fail('wrongLevel', I2S(wrongLevel) + ' rolls came from a locked level');
  }

  // One past the end: the lap wipes and rolling still works.
  rollCreepCamp();
  const after = getCampData();
  t.report('rollsAfterLap', after != null ? 1 : 0);
  if (after == null) t.fail('rollsAfterLap', 'rotation stalled once the lap ended');
  else if (after.level !== 1) t.fail('rollsAfterLap', 'new lap left level 1');

  t.done();
}

registerTest('camps', runCampTest);

/** Map difficulty by round: 0 on the first round (gameState.round 0), 100 on
 *  round 25 (gameState.round 24), and held at 100 after. */
registerTest('difficulty', t => {
  const at = (round: number): number => R2I(difficultyForRound(round) + 0.5);
  t.expect('round1', at(0), 0);
  t.expect('round13', at(12), 50);
  t.expect('round25', at(24), 100);
  t.expect('round40', at(39), 100);

  // Full-difficulty maps must still generate, with a train and granite.
  const graniteAt = (round: number): number => {
    loadTerrain(round);
    let n = 0;
    EnumDestructablesInRect(getWorldBounds(), undefined, () => {
      if (GetDestructableTypeId(GetEnumDestructable()!) === FourCC(GRANITE_RAW)) n += 1;
    });
    return n;
  };
  const g25 = graniteAt(24);
  const g26 = graniteAt(25);
  t.report('granite_round25', g25);
  t.report('granite_round26', g26);
  t.expectTrue('trainAtRound26', getTrain() != null);
  if (g25 === 0) t.fail('granite_round25', 'no granite at full difficulty');
  t.done();
});
