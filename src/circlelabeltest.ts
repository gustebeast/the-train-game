import { registerTest, TestReporter } from './testkit';
import { Units } from '@objectdata/units';
import { unitLabelStats } from './unitLabels';
import { loadInterRoundLobby, beginNewRun } from './terrain/load';
import { forEachUnitInWorld } from './util';

function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

function circlesOnMap(): unit[] {
  const id = FourCC(Units.CircleOfPower);
  const found: unit[] = [];
  forEachUnitInWorld(u => { if (GetUnitTypeId(u) === id) found.push(u); });
  return found;
}

/**
 * A circle's label exists exactly as long as the circle does.
 *
 * The labels were removed once before because regenerating the map left them
 * floating over ground whose circles were gone. Three ways a circle can leave,
 * each checked:
 *
 *  - Regeneration, checked in the SAME frame as the load, with no wait. That
 *    proves the synchronous sweep inside the cleanup did it, not the periodic
 *    timer -- which matters because only the synchronous sweep runs before
 *    the new board's circles can take over recycled handles.
 *  - Regeneration again, to show labels do not pile up across loads.
 *  - A circle removed by hand, outside any cleanup, which only the periodic
 *    backstop can catch.
 */
function runCircleLabelTest(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  const first = circlesOnMap().length;
  t.report('circlesInLobby', first);
  if (first === 0) t.fail('circlesInLobby', 'no circles, so nothing is being tested');
  expect(t, 'labelsMatchCircles', unitLabelStats().total, first);

  // Regenerate, and look in the same frame.
  loadInterRoundLobby();
  const second = circlesOnMap().length;
  const now = unitLabelStats();
  expect(t, 'orphansSameFrameAfterRegen', now.orphaned, 0);
  expect(t, 'labelsMatchCirclesAfterRegen', now.total, second);

  loadInterRoundLobby();
  expect(t, 'noPileUpAfterSecondRegen', unitLabelStats().total, circlesOnMap().length);

  // Remove one circle outside any cleanup path.
  const victim = circlesOnMap()[0];
  const before = unitLabelStats().total;
  RemoveUnit(victim);
  t.after(1, () => {
    const after = unitLabelStats();
    expect(t, 'backstopDroppedRemovedCircle', before - after.total, 1);
    expect(t, 'orphansAfterBackstop', after.orphaned, 0);
    t.done();
  });
}

registerTest('circlelabels', runCircleLabelTest);
