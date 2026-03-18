import { Unit, Trigger, Timer, Rectangle, Region } from 'w3ts';
import { Units } from '@objectdata/units';
import { placedTracks } from './track/state';
import { TRACK_SIZE } from './track/constants';
import { getNeutralPassive } from './teams';

import { initProduction, setMoveOrderCallback, pauseProduction, resumeProduction } from './production';

const OVERSHOOT = 16;
const REGION_HALF = 2; // 4x4 region → half-size = 2
const STUCK_TIMEOUT = 35;
export const CENTER_OFFSET = 16;
let trainHPRegen: number = -1; // HP per second; negative = decay
let arrivalRect: Rectangle;
let arrivalRegion: Region;
let lastMoveTime: number = 0;
let targetIdx: number = 0;
let train: Unit;
let trainSpeed: number = 6;
let crashDeadline: number = 0;
let gameOver: boolean = false;
let burning: boolean = false;
let burnTimer: Timer | null = null;

export function isBurning(): boolean {
  return burning;
}

export function extinguish(): void {
  if (!burning) return;
  burning = false;
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }
  BlzSetUnitMaxHP(train.handle, 100);
  SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, trainHPRegen);
  resumeProduction();
}

function trackCenter(track: Unit): { x: number; y: number } {
  return { x: track.x + CENTER_OFFSET, y: track.y + CENTER_OFFSET };
}

/** Compute the overshoot offset direction from current track to next. */
function overshootOffset(cur: { x: number; y: number }, nxt: { x: number; y: number }): { ox: number; oy: number } {
  const dx = nxt.x - cur.x;
  const dy = nxt.y - cur.y;
  const ox = math.abs(dx) >= math.abs(dy) ? OVERSHOOT * (dx > 0 ? 1 : -1) : 0;
  const oy = math.abs(dy) > math.abs(dx) ? OVERSHOOT * (dy > 0 ? 1 : -1) : 0;
  return { ox, oy };
}

/** Move the arrival region to the next track and issue a move order. */
function moveToNext() {
  const current = placedTracks[targetIdx];
  const next = placedTracks[targetIdx + 1];
  if (next == null || current == null) return;
  next.invulnerable = true;
  targetIdx++;
  const cur = trackCenter(current);
  const nxt = trackCenter(next);
  const { ox, oy } = overshootOffset(cur, nxt);

  // Reposition the arrival region on the next track center
  arrivalRegion.clearRect(arrivalRect);
  arrivalRect.setRect(nxt.x - REGION_HALF, nxt.y - REGION_HALF, nxt.x + REGION_HALF, nxt.y + REGION_HALF);
  arrivalRegion.addRect(arrivalRect);

  lastMoveTime = os.clock();
  train.issueOrderAt('move', nxt.x + ox, nxt.y + oy);
}

export function getTrainTarget(): Unit | undefined {
  return placedTracks[targetIdx];
}

/** Called by build.ts when a new track piece is placed. */
export function onTrackPlaced(): void {
  if (crashDeadline == 0) {
    return;
  }
  print('Saved with ' + I2S(R2I((crashDeadline - os.clock()) * 1000)) + 'ms left!');
  crashDeadline = 0;
  moveToNext();
}

/** Re-issue the train's current move order (call after programmatic inventory changes). */
export function reissueMoveOrder(): void {
  // Failsafe: if it's been too long since the last moveToNext, the train
  // likely missed the arrival region — force advance instead of re-issuing.
  if (
    os.clock() - lastMoveTime >= STUCK_TIMEOUT && 
    placedTracks[targetIdx + 1] != null &&
    !gameOver
  ) {
    moveToNext();
    return;
  }

  const target = placedTracks[targetIdx];
  if (target == null) return;
  const center = trackCenter(target);
  const current = placedTracks[targetIdx - 1];
  if (current == null) {
    train.issueOrderAt('move', center.x, center.y);
    return;
  }
  const cur = trackCenter(current);
  const { ox, oy } = overshootOffset(cur, center);
  train.issueOrderAt('move', center.x + ox, center.y + oy);
}

export function getTrain(): Unit {
  return train;
}

export function initTrain() {
  // Spawn the train
  train = Unit.create(getNeutralPassive(), FourCC(Units.WarWagon), CENTER_OFFSET - 26 * TRACK_SIZE, CENTER_OFFSET, 0)!;
  SetUnitPathing(train.handle, false);
  initProduction(train);
  setMoveOrderCallback(() => reissueMoveOrder());

  // Create the arrival region (initially at origin, will be repositioned by moveToNext)
  arrivalRect = Rectangle.create(0, 0, 0, 0);
  arrivalRegion = Region.create();
  arrivalRegion.addRect(arrivalRect);

  // Trigger fires when the train enters the arrival region
  const arrivalTrigger = Trigger.create();
  arrivalTrigger.registerEnterRegion(arrivalRegion.handle, undefined);
  arrivalTrigger.addAction(() => {
    const entering = Unit.fromEvent();
    if (entering == null || entering.handle !== train.handle) {
      return;
    }
    if (placedTracks[targetIdx + 1] != null) {
      moveToNext();
      return;
    }
    print('Train about to crash!');
    const crashDelay = (REGION_HALF + OVERSHOOT) / trainSpeed;
    crashDeadline = os.clock() + crashDelay;
    Timer.create().start(crashDelay, false, () => {
      if (crashDeadline !== 0) {
        print('Game over!');
        crashDeadline = 0;
        gameOver = true;
      }
    });
  });

  // Intercept train HP decay — enter burning state before death
  const lowHpTrigger = Trigger.create();
  TriggerRegisterUnitStateEvent(lowHpTrigger.handle, train.handle, UNIT_STATE_LIFE, LESS_THAN, 2.0);
  lowHpTrigger.addAction(() => {
    if (burning) return;
    burning = true;
    SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
    BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
    pauseProduction();
    print('The train is on fire and is losing max HP!');
    burnTimer = Timer.create();
    burnTimer.start(1, true, () => {
      const currentMax = BlzGetUnitMaxHP(train.handle);
      BlzSetUnitMaxHP(train.handle, currentMax - 1);
      SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
    });
  });

  // Start slow, ramp up to full speed after 30 seconds
  train.moveSpeed = 1;
  Timer.create().start(30, false, () => {
    train.moveSpeed = trainSpeed;
  });

  moveToNext();
}
