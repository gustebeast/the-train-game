import { Timer, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { getDashDebug } from './dash';
import { registerTest, TestReporter } from './testkit';

// Observer for a REAL input sequence driven over VNC (mouse + keyboard):
//   right-click right, shift+E+click back left, shift+right-click right again.
// This test issues no orders itself — it spawns a peasant, selects it, frames
// the camera, and then just records what the player's input made it do, so the
// shift-queue path is exercised the way a human exercises it.
const SAMPLE = 0.02;
const EPS = 0.5;
const WATCH = 11.0; // seconds of observation

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

  // Clear a corridor so movement is not blocked by procedural terrain.
  const clr = Rect(ax - 1000, ay - 1000, ax + 1000, ay + 1000);
  EnumDestructablesInRect(clr, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  RemoveRect(clr);

  const p = Unit.create(Players[0], PEASANT_ID, ax, ay, 0)!;
  SetUnitX(p.handle, ax); SetUnitY(p.handle, ay);
  const h = p.handle;
  t.report('hasDashAbility', GetUnitAbilityLevel(h, DASH_ABILITY_ID));

  // Pre-select for the local player so the VNC driver only has to click the
  // ground and press the hotkey — no unit-picking pixel hunt.
  ClearSelection();
  SelectUnit(h, true);
  PanCameraToTimed(ax, ay, 0);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, 2600, 0);

  let elapsed = 0;
  let lastX = GetUnitX(h);
  let maxRight = 0;      // furthest right before any reversal
  let minAfterMax = 99999; // furthest back left after that
  let tFirstMove = -1;
  let tReverse = -1;      // first leftward movement (the dash)
  let tResumeRight = -1;  // rightward movement again after the dash
  let stallStart = -1;
  let stallAfterDash = 0;

  const sampler = Timer.create();
  sampler.start(SAMPLE, true, t.guard(() => {
    elapsed = elapsed + SAMPLE;
    const x = GetUnitX(h);
    const dx = x - lastX;
    lastX = x;
    const rel = x - ax;
    const moving = dx > EPS || dx < -EPS;

    if (tFirstMove < 0 && dx > EPS) tFirstMove = elapsed;
    if (tFirstMove > 0 && tReverse < 0) {
      if (rel > maxRight) maxRight = rel;
      if (dx < -EPS) tReverse = elapsed;         // started dashing back
    }
    if (tReverse > 0) {
      if (rel < minAfterMax) minAfterMax = rel;
      if (tResumeRight < 0 && dx > EPS) tResumeRight = elapsed;
      // dead time between the dash and the queued move taking over
      if (tResumeRight < 0) {
        if (!moving) {
          if (stallStart < 0) stallStart = elapsed;
          const len = elapsed - stallStart + SAMPLE;
          if (len > stallAfterDash) stallAfterDash = len;
        } else { stallStart = -1; }
      }
    }

    if (elapsed >= WATCH) {
      sampler.destroy();
      const d = getDashDebug();
      t.report('dashFired', d[0] > -99999 ? 1 : 0);
      t.report('dashIssuedMove', d[3]);
      t.report('tFirstMove', tFirstMove);
      t.report('tReverse', tReverse);
      t.report('tResumeRight', tResumeRight);
      t.report('maxRightBeforeDash', maxRight);
      t.report('dashedBackTo', minAfterMax === 99999 ? -9999 : minAfterMax);
      t.report('dashBackDistance', minAfterMax === 99999 ? -1 : maxRight - minAfterMax);
      t.report('stallAfterDash', stallAfterDash);
      t.report('finalRel', GetUnitX(h) - ax);
      t.report('queueCompleted', tResumeRight > 0 ? 1 : 0);
      p.destroy();
      t.done();
    }
  }));
}

registerTest('inputwatch', run);
