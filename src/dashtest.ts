import { Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { startRoll } from './dash';
import { getWorldBounds } from './util';
import { registerTest, TestReporter } from './testkit';

// Throwaway in-game validation for the Dash/roll ability (src/dash.ts).
// NOT committed for regression — initial functionality validation only.
// Exercises the whole chain: flare cast -> SPELL_CHANNEL trigger -> startRoll
// -> physics tick -> SetUnitX/Y, and measures the resulting motion.

/** Mirror of dash.ts's walkable(): IsTerrainPathable is inverted. */
function walkable(x: number, y: number): boolean {
  return !IsTerrainPathable(x, y, PATHING_TYPE_WALKABILITY);
}

function runDashTest(t: TestReporter): void {
  const bounds = getWorldBounds();
  // Same empty far-corner zone the damage test uses, pulled a bit further in
  // so there's room to roll in whichever direction is clearest.
  const startX = GetRectMaxX(bounds) - 700;
  const startY = GetRectMaxY(bounds) - 700;

  const peasant = Unit.create(Players[0], PEASANT_ID, startX, startY, 0)!;
  SetUnitX(peasant.handle, startX);
  SetUnitY(peasant.handle, startY);

  t.report('hasDashAbility', GetUnitAbilityLevel(peasant.handle, DASH_ABILITY_ID) > 0 ? 1 : 0);
  t.report('startWalkable', walkable(startX, startY) ? 1 : 0);

  // Pick the cardinal direction with the most walkable cells ahead, so a
  // small travel result means a dash bug, not terrain blocking the roll.
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  let bestDx = 0;
  let bestDy = 0;
  let bestClear = -1;
  for (const d of dirs) {
    let clear = 0;
    for (let step = 32; step <= 480; step += 32) {
      if (walkable(startX + d.dx * step, startY + d.dy * step)) clear += 1;
    }
    if (clear > bestClear) {
      bestClear = clear;
      bestDx = d.dx;
      bestDy = d.dy;
    }
  }
  t.report('chosenDx', bestDx);
  t.report('chosenDy', bestDy);
  t.report('clearCellsAhead', bestClear); // out of 15

  const targetX = startX + bestDx * 600;
  const targetY = startY + bestDy * 600;

  // Spy: does casting Afla ever produce a channel event on the peasant?
  let channelFired = 0;
  const spy = Trigger.create();
  TriggerRegisterUnitEvent(spy.handle, peasant.handle, EVENT_UNIT_SPELL_CHANNEL);
  spy.addAction(t.guard(() => { channelFired = 1; }));

  // (1) ABILITY-CAST path. Give the freshly created unit a generous settle
  // (1.5s) before ordering, so a rejection means the ability genuinely can't
  // be cast — not just "too soon after create". A real in-game peasant has
  // existed far longer, so this is the fair comparison.
  t.after(1.5, () => {
    const oid = OrderId('flare');
    t.report('orderIdFlare', oid);
    const accepted = IssuePointOrderById(peasant.handle, oid, targetX, targetY);
    t.report('orderAccepted', accepted ? 1 : 0);
    t.report('curOrderAfter', GetUnitCurrentOrder(peasant.handle));

    t.after(0.4, () => {
      t.report('channelFired', channelFired); // 1 == the cast really triggered dash

      // (2) PHYSICS path. Drive the roll directly (bypassing the cast) to
      // validate movement/pause regardless of whether the cast fired.
      IssueImmediateOrder(peasant.handle, 'stop');
      const sx = GetUnitX(peasant.handle);
      const sy = GetUnitY(peasant.handle);
      startRoll(peasant, targetX, targetY);

      t.after(0.25, () => {
        t.report('pausedMidRoll', IsUnitPaused(peasant.handle) ? 1 : 0);
        const mdx = GetUnitX(peasant.handle) - sx;
        const mdy = GetUnitY(peasant.handle) - sy;
        t.report('movedByMidRoll', SquareRoot(mdx * mdx + mdy * mdy));
      });

      t.after(0.9, () => {
        const dx = GetUnitX(peasant.handle) - sx;
        const dy = GetUnitY(peasant.handle) - sy;
        const dist = SquareRoot(dx * dx + dy * dy);
        const along = dx * bestDx + dy * bestDy;
        const perp = dx * bestDy - dy * bestDx;
        t.report('distTravelled', dist);
        t.report('alongHeading', along);
        t.report('perpHeading', perp);
        t.report('pausedAfterRoll', IsUnitPaused(peasant.handle) ? 1 : 0);
        const ok = along > 150 && perp < 80 && perp > -80 ? 1 : 0;
        t.report('movedTowardTarget', ok);
        peasant.destroy();
        t.done();
      });
    });
  });
}

registerTest('dash', runDashTest);
