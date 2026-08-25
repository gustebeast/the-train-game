import { registerTest, TestReporter } from './testkit';
import { CREEP_CAMPS } from './creep_camps';
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
