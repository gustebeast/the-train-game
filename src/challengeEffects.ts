import { Timer, Unit } from 'w3ts';
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
const OTS_DISTANCE = 900;
/** Camera pitch, in WC3's angle-of-attack scale where the game's own default is
 *  304 -- steeply top-down. Larger values flatten it toward the horizon, and
 *  going PAST 360 tips it upward: an early attempt at "25 degrees above the
 *  horizon" actually aimed the camera at the sky, leaving the peasant floating
 *  against clouds. Just under 360 gives the shallow looking-slightly-down pitch
 *  a chase camera wants. */
const OTS_ANGLE_OF_ATTACK = 348;
const OTS_HEIGHT_OFFSET = 150;
/** The chase camera runs on its own fast timer rather than the 0.5s global
 *  tick. Half a second between updates is far too coarse for a camera that is
 *  meant to sit behind a moving unit: the follow lurches, and a player who
 *  scrolls or wheels away keeps the stolen view until the next tick. */
const OTS_INTERVAL = 0.03;
/** Interpolation time handed to the camera calls. Roughly a few frames: long
 *  enough to smooth the motion, short enough that it never trails the unit. */
const OTS_SMOOTHING = 0.10;

let otsActive = false;
let otsTimer: Timer | null = null;

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

/** Turn the chase camera on or off.
 *
 *  Also the entry point for the -thirdperson cheat, so the view can be tried
 *  without buying the challenge. While it is on the camera is genuinely locked:
 *  distance, angle and position are re-applied every OTS_INTERVAL, so wheeling
 *  out or scrolling away snaps back within a frame or two rather than letting a
 *  player escape the handicap. */
export function setShoulderCam(active: boolean): void {
  if (otsActive === active) return;
  otsActive = active;
  if (active) {
    // A top-down camera never sees the horizon, so the map ships with no sky and
    // the void above the terrain renders black. A chase camera looks straight at
    // it, so give it a sky for as long as it is running and take it away again
    // afterwards -- this is a per-mode fix, not a change to how the game looks.
    SetSkyModel('Environment\Sky\LordaeronSummerSky\LordaeronSummerSky.mdl');
    if (otsTimer == null) {
      // A raw Timer, not timers.ts createTimer: the camera must survive the
      // round-transition destroyAllTimers() that clears gameplay timers.
      otsTimer = Timer.create();
      otsTimer.start(OTS_INTERVAL, true, () => {
        if (otsActive && isInGameplay()) updateShoulderCam();
      });
    }
    return;
  }
  if (otsTimer != null) {
    otsTimer.pause();
    otsTimer.destroy();
    otsTimer = null;
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
  // Nothing periodic to register here any more: the chase camera runs its own
  // fast timer, started only while it is active.
}
