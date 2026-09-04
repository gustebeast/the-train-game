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
/** Close enough that the peasant reads as the subject of the shot rather than a
 *  figure in a landscape -- roughly double its on-screen size versus the first
 *  pass at 900. */
const OTS_DISTANCE = 450;
/** Camera pitch, in WC3's angle-of-attack scale where the game's own default is
 *  304 -- steeply top-down. Larger values flatten it toward the horizon, and
 *  going PAST 360 tips it upward: an early attempt at "25 degrees above the
 *  horizon" actually aimed the camera at the sky, leaving the peasant floating
 *  against clouds. Just under 360 gives the shallow looking-slightly-down pitch
 *  a chase camera wants. */
const OTS_ANGLE_OF_ATTACK = 348;
/** Height of the point the camera centres on, above the peasant's feet.
 *
 *  This is what decides where the unit sits in frame, and it works the opposite
 *  way round to the intuition: the target point IS the centre of the screen, so
 *  RAISING it pushes the unit DOWN the frame. 150 left the peasant almost on the
 *  bottom edge. 50 puts its head on the centre line -- lower than the model's
 *  actual head height, because the camera also looks slightly down. */
const OTS_HEIGHT_OFFSET = 50;
/** The camera is re-aimed on the shared 0.5s global tick.
 *
 *  Two different interpolation times do the work, and the difference is the
 *  whole trick:
 *
 *  - POSITION and rotation are panned over roughly a full tick, so the camera
 *    is always still gliding toward where the peasant was last seen. Motion
 *    stays continuous despite the coarse update rate; it just trails slightly.
 *  - DISTANCE is slammed back with no interpolation. Nothing to smooth over
 *    means a scroll-wheel nudge is yanked straight back, which is unpleasant
 *    enough to stop anyone zooming out of the handicap -- the jerkiness IS the
 *    deterrent, so it is deliberate rather than something to tune away. */
const OTS_FOLLOW_TIME = 0.5;
const OTS_SNAP = 0;

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
    // Snap: fights the scroll wheel on purpose.
    SetCameraFieldForPlayer(h, CAMERA_FIELD_TARGET_DISTANCE, OTS_DISTANCE, OTS_SNAP);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ANGLE_OF_ATTACK, OTS_ANGLE_OF_ATTACK, OTS_SNAP);
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ZOFFSET, OTS_HEIGHT_OFFSET, OTS_SNAP);
    // Glide: keeps the follow continuous between ticks.
    SetCameraFieldForPlayer(h, CAMERA_FIELD_ROTATION, target.facing, OTS_FOLLOW_TIME);
    PanCameraToTimedForPlayer(h, target.x, target.y, OTS_FOLLOW_TIME);
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

/** Turn the chase camera on or off.
 *
 *  Also the entry point for the -thirdperson cheat, so the view can be tried
 *  without buying the challenge. While it is on the camera is genuinely locked:
 *  distance, angle and position are re-applied every OTS_INTERVAL, so wheeling
 *  out or scrolling away snaps back within a frame or two rather than letting a
 *  player escape the handicap. */
function setShoulderCam(active: boolean): void {
  if (otsActive === active) return;
  otsActive = active;
  if (active) {
    // A top-down camera never sees the horizon, so the map ships with no sky and
    // the void above the terrain renders black. A chase camera looks straight at
    // it, so give it a sky for as long as it is running and take it away again
    // afterwards -- this is a per-mode fix, not a change to how the game looks.
    SetSkyModel('Environment\Sky\LordaeronSummerSky\LordaeronSummerSky.mdl');
    return;
  }
  SetSkyModel('');
  resetCamera();
}

/** Flip the chase camera. Used by -thirdperson so one command both enters and
 *  leaves the view. */
export function toggleShoulderCam(): boolean {
  setShoulderCam(!otsActive);
  return otsActive;
}

// --- lifecycle ------------------------------------------------------------

/** Apply whatever the armed challenge asks for. Called when a round starts. */
export function applyChallengeEffects(): void {
  setUiHidden(isChallengeArmed(CH_NO_UI));
  setShoulderCam(isChallengeArmed(CH_SHOULDER_CAM));
}

/** Undo everything. Called when leaving gameplay by any route. */
export function clearChallengeEffects(): void {
  setUiHidden(false);
  setShoulderCam(false);
}

export function initChallengeEffects(): void {
  onGlobalTick(() => {
    if (!isInGameplay()) return;
    if (otsActive) updateShoulderCam();
  });
}
