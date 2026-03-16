import { Unit, Timer } from 'w3ts';
import { Units } from '@objectdata/units';
import { placedTracks } from './track/state';
import { TRACK_SIZE } from './track/constants';
import { getNeutralPassive } from './teams';
import { log } from './debug';
import { initProduction, setMoveOrderCallback } from './production';

const OVERSHOOT = 16;
const ARRIVAL_DIST = 4;
const STUCK_DIST = 16 * 16; // max distance² to still count "stopped" as "close enough"
export const CENTER_OFFSET = 16;
let train: Unit;
let targetIdx = 0;
let prevDist1 = 0; // distance² one tick ago
let prevDist2 = 0; // distance² two ticks ago

function trackCenter(track: Unit): { x: number; y: number } {
  return { x: track.x + CENTER_OFFSET, y: track.y + CENTER_OFFSET };
}

function moveToNext() {
  const current = placedTracks[targetIdx];
  const next = placedTracks[targetIdx + 1];
  if (next == null || current == null) {
    log('moveToNext: no target — idx=' + targetIdx + ' current=' + (current != null) + ' next=' + (next != null));
    return;
  }
  next.invulnerable = true;
  targetIdx++;
  const cur = trackCenter(current);
  const nxt = trackCenter(next);
  const dx = nxt.x - cur.x;
  const dy = nxt.y - cur.y;
  // Snap to the dominant cardinal direction
  const ox = math.abs(dx) >= math.abs(dy) ? OVERSHOOT * (dx > 0 ? 1 : -1) : 0;
  const oy = math.abs(dy) > math.abs(dx) ? OVERSHOOT * (dy > 0 ? 1 : -1) : 0;
  log('moveToNext: idx=' + targetIdx + ' from=(' + I2S(R2I(cur.x)) + ',' + I2S(R2I(cur.y)) + ') to=(' + I2S(R2I(nxt.x)) + ',' + I2S(R2I(nxt.y)) + ') overshoot=(' + I2S(R2I(ox)) + ',' + I2S(R2I(oy)) + ')');
  train.issueOrderAt('move', nxt.x + ox, nxt.y + oy);
}

export function getTrainTarget(): Unit | undefined {
  return placedTracks[targetIdx];
}

/** Re-issue the train's current move order (call after programmatic inventory changes). */
export function reissueMoveOrder(): void {
  const target = placedTracks[targetIdx];
  if (target == null) return;
  const center = trackCenter(target);
  const current = placedTracks[targetIdx - 1];
  if (current == null) {
    train.issueOrderAt('move', center.x, center.y);
    return;
  }
  const cur = trackCenter(current);
  const dx = center.x - cur.x;
  const dy = center.y - cur.y;
  const ox = math.abs(dx) >= math.abs(dy) ? OVERSHOOT * (dx > 0 ? 1 : -1) : 0;
  const oy = math.abs(dy) > math.abs(dx) ? OVERSHOOT * (dy > 0 ? 1 : -1) : 0;
  train.issueOrderAt('move', center.x + ox, center.y + oy);
}

export function initTrain() {
  // Spawn the train
  train = Unit.create(getNeutralPassive(), FourCC(Units.WarWagon), CENTER_OFFSET - 26 * TRACK_SIZE, CENTER_OFFSET, 0)!;
  SetUnitPathing(train.handle, false);
  initProduction(train);
  setMoveOrderCallback(() => reissueMoveOrder());

  const timer = Timer.create().start(0.1, true, () => {
    const target = placedTracks[targetIdx];
    if (target == null) {
      return;
    }
    const center = trackCenter(target);
    const dx = train.x - center.x;
    const dy = train.y - center.y;
    const newDistance = dx * dx + dy * dy;
    const isNear = newDistance < ARRIVAL_DIST * ARRIVAL_DIST;
    const isStopped = newDistance === prevDist1 && prevDist1 === prevDist2;
    const isStuck = isStopped && newDistance > STUCK_DIST;
    if (isStopped && !isStuck && placedTracks[targetIdx + 1] == null) {
      log('Train stopped — no more tracks at idx=' + targetIdx);
      print('Game over!');
      timer.destroy();
    }
    if (isStuck) {
      // log('Train stuck: dist2=' + I2S(R2I(newDistance)) + ' pos=(' + I2S(R2I(train.x)) + ',' + I2S(R2I(train.y)) + ') idx=' + targetIdx + ' — reissuing move');
      const center = trackCenter(target);
      // train.issueOrderAt('move', center.x, center.y);
    } else if (isNear || isStopped) {
      const reason = isNear ? 'arrived' : 'stopped';
      log('Train tick: ' + reason + ' dist2=' + I2S(R2I(newDistance)) + ' prev1=' + I2S(R2I(prevDist1)) + ' pos=(' + I2S(R2I(train.x)) + ',' + I2S(R2I(train.y)) + ') idx=' + targetIdx);
      moveToNext();
    }
    prevDist2 = prevDist1;
    prevDist1 = newDistance;
  });

  moveToNext();
}
