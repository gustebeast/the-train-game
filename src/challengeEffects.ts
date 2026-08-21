import { Unit } from 'w3ts';
import { onGlobalTick } from './globalTick';
import { isInGameplay } from './state';
import { isChallengeArmed } from './challenges';
import { CH_NO_UI, CH_SHOULDER_CAM } from './challengeList';
import { getHumanPlayers } from './util';
import { PEASANT_ID } from './constants';

/**
 * Handicaps that change how the round is presented rather than what happens in
 * it: the hidden interface and the over-the-shoulder camera.
 *
 * Both are applied when a round starts and undone when it ends, and both are
 * per-round only, so nothing here is saved.
 */

// --- hidden UI ------------------------------------------------------------

let uiHidden = false;

/** Hide the whole default console -- minimap, command card, portrait, resource
 *  bar -- in one call.
 *
 *  Hotkeys keep working, which is the point of the challenge: the abilities are
 *  all still castable, you just have to remember where they were. */
function setUiHidden(hidden: boolean): void {
  if (uiHidden === hidden) return;
  uiHidden = hidden;
  BlzHideOriginFrames(hidden);
  // The minimap is not part of the origin-frame set on every patch, so hide it
  // explicitly rather than trusting the one call to cover it.
  const minimap = BlzGetFrameByName('MiniMapFrame', 0);
  if (minimap != null) BlzFrameSetVisible(minimap, !hidden);
}

// --- over-the-shoulder camera ---------------------------------------------

/** Chase-camera geometry. Low and close, looking slightly down at the unit. */
const OTS_DISTANCE = 700;
const OTS_ANGLE_OF_ATTACK = 12;   // degrees above the horizon
const OTS_HEIGHT_OFFSET = 120;
/** How fast the camera slides to a new pose. Smaller is snappier; too small and
 *  it judders every tick, too large and it lags behind a dashing peasant. */
const OTS_SMOOTHING = 0.35;

let otsActive = false;

/** The unit the camera should sit behind for a player: their first peasant. */
function chaseTargetFor(playerHandle: player): Unit | null {
  let found: Unit | null = null;
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, playerHandle, null!);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (found != null || u == null) return;
    if (GetUnitTypeId(u) !== PEASANT_ID) return;
    if (GetUnitState(u, UNIT_STATE_LIFE) <= 0) return;
    found = Unit.fromHandle(u) ?? null;
  });
  DestroyGroup(g);
  return found;
}

/** Re-aim each player's camera behind their peasant.
 *
 *  Driven from the tick rather than a camera "target controller" because the
 *  rotation has to follow the unit's FACING, not just its position -- that is
 *  what makes it read as over-the-shoulder rather than a top-down camera that
 *  happens to be low. */
function updateShoulderCam(): void {
  for (const p of getHumanPlayers()) {
    const target = chaseTargetFor(p.handle);
    if (target == null) continue;
    const h = p.handle;
    SetCameraFieldForPlayer(h, CAMERA_FIELD_TARGET_DISTANCE, OTS_DISTANCE, OTS_SMOOTHING);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ANGLE_OF_ATTACK, OTS_ANGLE_OF_ATTACK, OTS_SMOOTHING);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ZOFFSET, OTS_HEIGHT_OFFSET, OTS_SMOOTHING);
    // Sit behind the unit: the camera looks along the way the unit faces.
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ROTATION, target.facing, OTS_SMOOTHING);
    PanCameraToTimedForPlayer(h, target.x, target.y, OTS_SMOOTHING);
  }
}

function resetCamera(): void {
  for (const p of getHumanPlayers()) {
    const h = p.handle;
    ResetToGameCameraForPlayer(h, 0);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ANGLE_OF_ATTACK, 304, 0); // WC3 default
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ZOFFSET, 0, 0);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ROTATION, 90, 0);
  }
}

/** True while the shoulder cam owns the camera, so the normal distance lock
 *  stands down rather than fighting it every tick. */
export function isShoulderCamActive(): boolean {
  return otsActive;
}

// --- lifecycle ------------------------------------------------------------

/** Apply whatever the armed challenge asks for. Called when a round starts. */
export function applyChallengeEffects(): void {
  setUiHidden(isChallengeArmed(CH_NO_UI));
  otsActive = isChallengeArmed(CH_SHOULDER_CAM);
  if (!otsActive) resetCamera();
}

/** Undo everything. Called when leaving gameplay by any route. */
export function clearChallengeEffects(): void {
  setUiHidden(false);
  if (otsActive) {
    otsActive = false;
    resetCamera();
  }
}

export function initChallengeEffects(): void {
  onGlobalTick(() => {
    if (!isInGameplay()) return;
    if (otsActive) updateShoulderCam();
  });
}
