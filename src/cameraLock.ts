import { onGlobalTick } from './globalTick';
import { getHumanPlayers } from './util';
import { isShoulderCamActive } from './challengeEffects';

/** Camera distance locked for all human players. */
const CAMERA_DISTANCE = 1200;

/** Re-apply the fixed camera distance on every global tick. WC3 has no way
 *  to disable mouse-wheel zoom, so any drift snaps back within one tick. */
export function initCameraLock(): void {
  const humanPlayers = getHumanPlayers();
  onGlobalTick(() => {
    // The Over the Shoulder challenge drives the camera itself; two systems
    // setting target distance every tick would fight and judder.
    if (isShoulderCamActive()) return;
    for (const { handle } of humanPlayers) {
      SetCameraFieldForPlayer(handle, CAMERA_FIELD_TARGET_DISTANCE, CAMERA_DISTANCE, 0);
    }
  });
}
