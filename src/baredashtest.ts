import { Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { getDashDebug } from './dash';
import { registerTest, TestReporter } from './testkit';

// A bare dash (nothing queued) on an idle peasant. Reports the point the
// ability actually delivered, so a target-type problem is obvious: targetX/Y
// near 0 means the cast carried no point and the dash aims at the map corner.
function run(t: TestReporter): void {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, Players[0].handle, undefined);
  let ax = 0; let ay = 0; let found = false;
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (!found && u != null && GetUnitTypeId(u) === PEASANT_ID) { ax = GetUnitX(u); ay = GetUnitY(u); found = true; }
  });
  DestroyGroup(g);
  if (!found) { t.fail('anchor', 'no peasant'); t.done(); return; }

  // Aim down a provably clear corridor: the procedural terrain around the
  // anchor is often unwalkable, and a move order to an unreachable point is
  // rejected — which looks exactly like the dash failing.
  const walkable = (x: number, y: number) => !IsTerrainPathable(x, y, PATHING_TYPE_WALKABILITY);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let ux = 1; let uy = 0; let best = -1;
  for (const d of dirs) {
    let clear = 0;
    for (let step = 64; step <= 600; step += 64) {
      if (walkable(ax + d[0] * step, ay + d[1] * step)) clear = clear + 1;
    }
    if (clear > best) { best = clear; ux = d[0]; uy = d[1]; }
  }
  t.report('corridorClear', best); // out of 9
  const clr = Rect(ax - 700, ay - 700, ax + 700, ay + 700);
  EnumDestructablesInRect(clr, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  RemoveRect(clr);

  const p = Unit.create(Players[0], PEASANT_ID, ax, ay, 0)!;
  SetUnitX(p.handle, ax); SetUnitY(p.handle, ay);
  t.report('hasAbility', GetUnitAbilityLevel(p.handle, DASH_ABILITY_ID));

  t.after(1.0, () => {
    const sx = GetUnitX(p.handle); const sy = GetUnitY(p.handle);
    const aimX = sx + ux * 400; const aimY = sy + uy * 400;
    t.report('aimedAtX', aimX);
    IssuePointOrderById(p.handle, OrderId('flare'), aimX, aimY);

    t.after(1.3, () => {
      t.report('speedDuringDash', GetUnitMoveSpeed(p.handle));
      // What point did the ability hand to the trigger?
      const d = getDashDebug();
      t.report('spellTargetX', d[0]);
      t.report('spellTargetY', d[1]);
      t.report('ordAtCheck', d[2]);          // order seen when deciding to move
      t.report('moveIssued', d[3]);          // 0=skipped 1=accepted 2=rejected
      t.report('targetLooksValid', (d[0] - sx) * ux + (d[1] - sy) * uy > 100 ? 1 : 0);
    });
    t.after(2.0, () => {
      const travelled = (GetUnitX(p.handle) - sx) * ux + (GetUnitY(p.handle) - sy) * uy;
      t.report('movedTowardAim', travelled);
      t.report('bareDashWorks', travelled > 120 ? 1 : 0);
      p.destroy();
      t.done();
    });
  });
}

registerTest('baredash', run);
