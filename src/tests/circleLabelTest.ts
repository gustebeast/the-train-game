import { registerTest, startRunInLobby, TestReporter } from './testKit';
import { Units } from '@objectdata/units';
import { getUnitLabelStats } from '../unitLabels';
import { loadInterRoundLobby } from '../terrain/load';
import { forEachUnitInWorld } from '../util';

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
 *  - Regeneration, checked in the SAME frame as the load, with no wait: the
 *    labels must be gone by the time the removal call returns, before the new
 *    board's circles can take over recycled handles.
 *  - Regeneration again, to show labels do not pile up across loads.
 *  - A circle removed by hand, outside any cleanup, and one that dies. Both
 *    are caught by events -- the RemoveUnit hook and the death trigger --
 *    since nothing polls.
 */
function runCircleLabelTest(t: TestReporter): void {
  startRunInLobby();
  const first = circlesOnMap().length;
  t.report('circlesInLobby', first);
  if (first === 0) t.fail('circlesInLobby', 'no circles, so nothing is being tested');
  t.expect('labelsMatchCircles', getUnitLabelStats().total, first);

  // Regenerate, and look in the same frame.
  loadInterRoundLobby();
  const second = circlesOnMap().length;
  const now = getUnitLabelStats();
  t.expect('orphansSameFrameAfterRegen', now.orphaned, 0);
  t.expect('labelsMatchCirclesAfterRegen', now.total, second);

  loadInterRoundLobby();
  t.expect('noPileUpAfterSecondRegen', getUnitLabelStats().total, circlesOnMap().length);

  // Remove one circle outside any cleanup path, and look in the same frame:
  // the RemoveUnit hook has to have dropped its label already.
  const victim = circlesOnMap()[0];
  const before = getUnitLabelStats().total;
  RemoveUnit(victim);
  t.expect('removalDroppedLabelSameFrame', before - getUnitLabelStats().total, 1);

  // And a circle that dies rather than being removed.
  const dying = circlesOnMap()[0];
  const beforeDeath = getUnitLabelStats().total;
  SetUnitInvulnerable(dying, false);
  KillUnit(dying);
  t.after(0.5, () => {
    const after = getUnitLabelStats();
    t.expect('deathDroppedLabel', beforeDeath - after.total, 1);
    t.expect('orphansAtEnd', after.orphaned, 0);
    t.done();
  });
}

registerTest('circlelabels', runCircleLabelTest);
