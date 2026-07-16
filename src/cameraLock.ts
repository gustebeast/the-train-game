import { onGlobalTick } from './globalTick';
import { getHumanPlayers } from './util';

/** Camera distance locked for all human players. */
const CAMERA_DISTANCE = 1200;

/** Re-apply the fixed camera distance on every global tick. WC3 has no way
 *  to disable mouse-wheel zoom, so any drift snaps back within one tick. */
export function initCameraLock(): void {
  const humanPlayers = getHumanPlayers();
  onGlobalTick(() => {
    for (const { handle } of humanPlayers) {
      SetCameraFieldForPlayer(handle, CAMERA_FIELD_TARGET_DISTANCE, CAMERA_DISTANCE, 0);
    }
  });
}
