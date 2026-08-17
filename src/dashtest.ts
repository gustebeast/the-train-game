import { Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
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

  const sx = GetUnitX(peasant.handle);
  const sy = GetUnitY(peasant.handle);
  const targetX = startX + bestDx * 600;
  const targetY = startY + bestDy * 600;

  // Cast the actual ability rather than poking dash.ts internals.
  const accepted = IssuePointOrderById(peasant.handle, OrderId('flare'), targetX, targetY);
  t.report('orderAccepted', accepted ? 1 : 0);

  // Mid-roll (~0.25s, inside ROLL_DURATION 0.5): unit should be paused and
  // already moving.
  t.after(0.25, () => {
    t.report('pausedMidRoll', IsUnitPaused(peasant.handle) ? 1 : 0);
    const mdx = GetUnitX(peasant.handle) - sx;
    const mdy = GetUnitY(peasant.handle) - sy;
    t.report('movedByMidRoll', SquareRoot(mdx * mdx + mdy * mdy));
  });

  // After roll + residual velocity bleed-off (~0.9s): total travel & heading.
  t.after(0.9, () => {
    const dx = GetUnitX(peasant.handle) - sx;
    const dy = GetUnitY(peasant.handle) - sy;
    const dist = SquareRoot(dx * dx + dy * dy);
    // Decompose along / perpendicular to the intended heading.
    const along = dx * bestDx + dy * bestDy;
    const perp = dx * bestDy - dy * bestDx;
    t.report('distTravelled', dist);
    t.report('alongHeading', along); // want a big positive number (~300-430)
    t.report('perpHeading', perp); // want near 0
    t.report('pausedAfterRoll', IsUnitPaused(peasant.handle) ? 1 : 0); // want 0
    const ok = along > 150 && perp < 80 && perp > -80 ? 1 : 0;
    t.report('movedTowardTarget', ok);
    peasant.destroy();
    t.done();
  });
}

registerTest('dash', runDashTest);
