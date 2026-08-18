import { Timer, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { registerTest, TestReporter } from './testkit';

// Times the player's exact sequence, with all three orders issued UP FRONT
// while the peasant is still walking the first leg:
//     move east (long)  ->  dash back west  ->  move east again
// Samples order + position every 20ms and reports a timeline (seconds from the
// moment the orders are issued) so the dead time is visible as a gap:
//   tDashOrder     - dash's own order becomes current
//   tDashMoveEnd   - unit stops moving after the dash
//   tNextOrder     - the queued move becomes current
//   tNextMoveStart - unit actually starts moving again
//   gapAfterDash   - tNextMoveStart - tDashMoveEnd  <-- the delay in question
const SAMPLE = 0.02;
const EPS = 0.5;

function runDashDelayTest(t: TestReporter): void {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, Players[0].handle, undefined);
  let ax = 0; let ay = 0; let found = false;
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (!found && u != null && GetUnitTypeId(u) === PEASANT_ID) { ax = GetUnitX(u); ay = GetUnitY(u); found = true; }
  });
  DestroyGroup(g);
  if (!found) { t.fail('anchor', 'no peasant'); t.done(); return; }

  // Procedural terrain: pick the cardinal direction with a clear corridor, and
  // clear destructables from it, so the move orders can actually be carried out.
  const walkable = (x: number, y: number) => !IsTerrainPathable(x, y, PATHING_TYPE_WALKABILITY);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let ux = 1; let uy = 0; let best = -1;
  for (const d of dirs) {
    let clear = 0;
    for (let step = 64; step <= 900; step += 64) {
      if (walkable(ax + d[0] * step, ay + d[1] * step)) clear = clear + 1;
    }
    if (clear > best) { best = clear; ux = d[0]; uy = d[1]; }
  }
  t.report('corridorClear', best); // out of 14
  const clr = Rect(ax - 1000, ay - 1000, ax + 1000, ay + 1000);
  EnumDestructablesInRect(clr, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  RemoveRect(clr);

  const p = Unit.create(Players[0], PEASANT_ID, ax, ay, 0)!;
  SetUnitX(p.handle, ax); SetUnitY(p.handle, ay);
  const h = p.handle;
  // Frame the test area so the run is watchable in the VM.
  // Frame the whole run: centre on the mid-point of the corridor, zoomed out.
  PanCameraToTimed(ax + ux * 300, ay + uy * 300, 0);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, 3400, 0);
  const FLARE = OrderId('flare');
  const MOVE = OrderId('move');

  t.report('hasDashAbility', GetUnitAbilityLevel(p.handle, DASH_ABILITY_ID));
  t.report('flareOrderId', OrderId('flare'));
  t.report('channelOrderId', OrderId('channel'));
  const baseSpeed = GetUnitMoveSpeed(p.handle);

  t.after(1.0, () => {
    // All three issued now, long first leg so the queue is full well before the
    // peasant finishes it — exactly how a player shift-clicks the sequence.
    const at = (d: number) => [ax + ux * d, ay + uy * d];
    const leg1 = at(500); const dashBack = at(-200); const leg2 = at(800);
    IssuePointOrderById(h, MOVE, leg1[0], leg1[1]);
    BlzQueuePointOrderById(h, FLARE, dashBack[0], dashBack[1]);
    BlzQueuePointOrderById(h, MOVE, leg2[0], leg2[1]);

    let elapsed = 0;
    let tDashOrder = -1;
    let tDashMoveEnd = -1;
    let tNextOrder = -1;
    let tNextMoveStart = -1;
    let lastX = GetUnitX(h); let lastY = GetUnitY(h);
    let sawDash = false;
    let stallStart = -1;
    let longestStall = 0;
    let sawBoost = 0;

    const sampler = Timer.create();
    sampler.start(SAMPLE, true, t.guard(() => {
      elapsed = elapsed + SAMPLE;
      const ord = GetUnitCurrentOrder(h);
      const x = GetUnitX(h); const y = GetUnitY(h);
      const dx = x - lastX; const dy = y - lastY;
      const moving = dx * dx + dy * dy > EPS * EPS;
      lastX = x; lastY = y;

      const boosted = GetUnitMoveSpeed(h) > baseSpeed + 1;
      if (boosted) sawBoost = 1;
      // Detect the dash strictly by its own order, so the stall window starts in
      // the right place.
      if (!sawDash && ord === FLARE) { sawDash = true; tDashOrder = elapsed; }

      if (sawDash) {
        // First stationary sample after the dash order = dash movement finished.
        if (tDashMoveEnd < 0 && !moving) tDashMoveEnd = elapsed;
        if (tNextOrder < 0 && ord === MOVE) tNextOrder = elapsed;
        if (tDashMoveEnd > 0 && tNextMoveStart < 0 && moving) tNextMoveStart = elapsed;
        // Robust fallback: the longest continuous stationary stretch after the
        // dash begins is what the player experiences as the pause.
        if (!moving) {
          if (stallStart < 0) stallStart = elapsed;
          const len = elapsed - stallStart + SAMPLE;
          if (len > longestStall) longestStall = len;
        } else {
          stallStart = -1;
        }
      }

      const travelled = (x - ax) * ux + (y - ay) * uy;
      const arrived = travelled > 760;
      if (arrived || elapsed > 9.0 || (tNextMoveStart > 0 && elapsed > tNextMoveStart + 0.4)) {
        sampler.destroy();
        t.report('tDashOrder', tDashOrder);
        t.report('tDashMoveEnd', tDashMoveEnd);
        t.report('tNextOrder', tNextOrder);
        t.report('tNextMoveStart', tNextMoveStart);
        t.report('sawSpeedBoost', sawBoost);
        t.report('stallAfterDash', longestStall);
        t.report('gapAfterDash', tNextMoveStart > 0 && tDashMoveEnd > 0 ? tNextMoveStart - tDashMoveEnd : -1);
        t.report('orderToMoveGap', tNextMoveStart > 0 && tNextOrder > 0 ? tNextMoveStart - tNextOrder : -1);
        t.report('finalDist', (GetUnitX(h) - ax) * ux + (GetUnitY(h) - ay) * uy);
        p.destroy();
        t.done();
      }
    }));
  });
}

registerTest('dashdelay', runDashDelayTest);
