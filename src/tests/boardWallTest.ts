import { Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { Players } from 'w3ts/globals';
import { registerTest, TestReporter } from './testKit';
import { beginNewRun } from '../terrain/load';
import { getNeutralPassive } from '../teams';

/**
 * The board's edge holds: nothing walks or flies off it, and a hero standing at
 * it cannot see what is beyond.
 *
 * The wall is built by script on every board load (spawn.ts wallBoard), since
 * loading a board removes every destructable on the map, the editor's
 * included.
 */
function runBoardWall(t: TestReporter): void {
  beginNewRun();
  t.after(1, () => {
    const me = Players[0];
    const walker = Unit.create(me, FourCC(Units.Footman), 0, 1216, 90)!;
    const flyer = Unit.create(me, FourCC(Units.GryphonRider), 256, 1216, 90)!;
    const sideWalker = Unit.create(me, FourCC(Units.Footman), 2560, 0, 0)!;
    const looker = Unit.create(me, FourCC(Units.Archmage), -256, 1216, 90)!;
    const beyond = Unit.create(getNeutralPassive(), FourCC(Units.Footman), -256, 1856, 270)!;
    walker.issueOrderAt('move', 0, 2400);
    flyer.issueOrderAt('move', 256, 2400);
    sideWalker.issueOrderAt('move', 2900, 0);
    t.after(6, () => {
      t.report('walkerY', walker.y);
      t.report('flyerY', flyer.y);
      t.report('sideWalkerX', sideWalker.x);
      if (walker.y > 1344) t.fail('walkerOff', 'walked off the top');
      if (flyer.y > 1344) t.fail('flyerOff', 'flew off the top');
      if (sideWalker.x > 2624) t.fail('sideWalkerOff', 'walked off the side');
      t.expectFalse('beyondSeen', IsUnitVisible(beyond.handle, me.handle));
      for (const u of [walker, flyer, sideWalker, looker, beyond]) u.destroy();
      t.done();
    });
  });
}

registerTest('boardwall', runBoardWall);
