import { Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { Players } from 'w3ts/globals';
import { registerTest, TestReporter } from './testKit';
import { beginNewRun, loadTerrain } from '../terrain/load';
import { getNeutralAggressive } from '../teams';
import { gameState } from '../state';

/**
 * The board's edge holds: nothing walks or flies off it, and a hero standing at
 * it cannot see what is beyond.
 *
 * The wall is built by script on every board load (spawn.ts wallBoard), since
 * loading a board removes every destructable on the map, the editor's
 * included. On a round's board, which is what it is for: the lobbies keep
 * water along their edges, and a unit made there is put down wherever there
 * is room -- beyond the wall, as the first version of this test found.
 */

/** The board's top edge, and how far in a unit is made. */
const EDGE = 1344;
const INSIDE = 1216;

/** A unit of player 0's at (x, INSIDE) that actually landed there, trying
 *  along the edge until one does; null if the whole edge is taken. */
function placeInside(type: string, fromX: number): Unit | null {
  for (let x = fromX; x <= 2400; x += 128) {
    const u = Unit.create(Players[0], FourCC(type), x, INSIDE, 90);
    if (u == null) continue;
    if (Math.abs(u.y - INSIDE) < 48 && Math.abs(u.x - x) < 48) return u;
    u.destroy();
  }
  return null;
}

function runBoardWall(t: TestReporter): void {
  beginNewRun();
  loadTerrain(gameState.round);
  t.after(1, () => {
    // A round's edge is trees: chop a gap the way players would, short of the
    // wall itself (its cells reach down to the board's edge).
    const gap = Rect(-512, INSIDE - 256, 512, EDGE - 16)!;
    EnumDestructablesInRect(gap, undefined, () => RemoveDestructable(GetEnumDestructable()!));
    RemoveRect(gap);
    const walker = placeInside(Units.Footman, -384);
    const flyer = placeInside(Units.GryphonRider, walker != null ? walker.x + 256 : -2400);
    const looker = placeInside(Units.Archmage, flyer != null ? flyer.x + 256 : -2400);
    if (walker == null || flyer == null || looker == null) {
      t.fail('placement', 'no open spot along the top edge');
      t.done();
      return;
    }
    // Neutral aggressive: humans share vision with neutral passive, so one of
    // its units would be visible from anywhere.
    const beyond = Unit.create(getNeutralAggressive(), FourCC(Units.Footman), looker.x, EDGE + 500, 270)!;
    PauseUnit(beyond.handle, true);
    t.report('beyondY', beyond.y);
    walker.issueOrderAt('move', walker.x, 2400);
    flyer.issueOrderAt('move', flyer.x, 2400);
    t.after(6, () => {
      t.report('walkerY', walker.y);
      t.report('flyerY', flyer.y);
      if (walker.y > EDGE) t.fail('walkerOff', 'walked off the top');
      if (flyer.y > EDGE) t.fail('flyerOff', 'flew off the top');
      // Flyers see over sight blockers, so the gryphon goes before the look:
      // the question is whether a hero on the ground can see past the wall.
      flyer.destroy();
      t.after(1, () => {
        t.expectFalse('beyondSeen', IsUnitVisible(beyond.handle, Players[0].handle));
        for (const u of [walker, looker, beyond]) u.destroy();
        t.done();
      });
    });
  });
}

registerTest('boardwall', runBoardWall);
