import { registerTest, TestReporter } from './testkit';
import { difficultyForRound, loadTerrain } from './terrain/load';
import { GRANITE_RAW } from './terrain/constants';
import { getTrain } from './train';
import { CREEP_CAMPS } from './creepCamps';
import { rollCreepCamp, getCampData, getCampIndex, clearCampRotation } from './creeps';

/** The camp rotation: an even split across levels, and a lap per level.
 *
 *  Rolls without a mercenary, so only level 1 is unlocked -- which is exactly
 *  what makes the lap testable: every roll must come from the level 1 pool,
 *  must not repeat until that pool is exhausted, and must then start again. */
function runCampTest(t: TestReporter): void {
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
  t.report('round1', at(0));
  t.report('round13', at(12));
  t.report('round25', at(24));
  t.report('round40', at(39));
  if (at(0) !== 0) t.fail('round1', 'expected 0');
  if (at(12) !== 50) t.fail('round13', 'expected 50');
  if (at(24) !== 100) t.fail('round25', 'expected 100');
  if (at(39) !== 100) t.fail('round40', 'expected 100 (capped)');

  // Full-difficulty maps must still generate, and two capped rounds must not
  // be the same map: the seed follows the round, not the (now flat) difficulty.
  const graniteAt = (round: number): number => {
    loadTerrain(round);
    let n = 0;
    EnumDestructablesInRect(GetWorldBounds()!, null!, () => {
      if (GetDestructableTypeId(GetEnumDestructable()!) === FourCC(GRANITE_RAW)) n += 1;
    });
    return n;
  };
  const g25 = graniteAt(24);
  const g26 = graniteAt(25);
  t.report('granite_round25', g25);
  t.report('granite_round26', g26);
  t.report('trainAtRound26', getTrain() != null ? 1 : 0);
  if (g25 === 0) t.fail('granite_round25', 'no granite at full difficulty');
  t.done();
});
