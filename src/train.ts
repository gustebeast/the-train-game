import { Item, Unit, Trigger, Timer, Rectangle, Region } from 'w3ts';
import { placedTracks, isVictoryTriggered } from './track/state';
import { GridPos } from './terrain/constants';
import { getTrainPlayer } from './teams';
import { gameState, isInGameplay, setInGameplay, registerSyncCallback, syncState } from './state';
import { deleteSave } from './save';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID, findItemByType } from './items';

import { initProduction, setMoveOrderCallback, pauseProduction, resumeProduction } from './production';

const OVERSHOOT = 16;
const REGION_HALF = 2; // 4x4 region → half-size = 2
const STUCK_TIMEOUT = 35;
const CENTER_OFFSET = 16;
const trainHPRegen: number = -1; // HP per second; negative = decay
let arrivalRect: Rectangle;
let arrivalRegion: Region;
let lastMoveTime: number = 0;
let targetIdx: number = 0;
let train: Unit;
let crashDeadline: number = 0;
let gameOver: boolean = false;
let burning: boolean = false;
let burnTimer: Timer | null = null;

export function isBurning(): boolean {
  return burning;
}

export function stopGameplay(): void {
  setInGameplay(false);
}

export function extinguish(): void {
  if (!burning) return;
  burning = false;
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, trainHPRegen);
  resumeProduction();
}

function trackCenter(track: Unit): GridPos {
  return { x: track.x + CENTER_OFFSET, y: track.y + CENTER_OFFSET };
}

/** Compute the overshoot offset direction from current track to next. */
function overshootOffset(cur: GridPos, nxt: GridPos): { ox: number; oy: number } {
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
  targetIdx++;
  const cur = trackCenter(current);
  const nxt = trackCenter(next);
  const { ox, oy } = overshootOffset(cur, nxt);

  // Reposition the arrival region on the next track center
  arrivalRegion.clearRect(arrivalRect);
  arrivalRect.setRect(nxt.x - REGION_HALF, nxt.y - REGION_HALF, nxt.x + REGION_HALF, nxt.y + REGION_HALF);
  arrivalRegion.addRect(arrivalRect);

  lastMoveTime = os.clock();
  next.invulnerable = true;
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
  const elapsed = os.clock() - lastMoveTime;
  if (
    elapsed >= STUCK_TIMEOUT &&
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

/** Shared train unit setup: owner, pathing, HP/mana from state. */
function setupTrainUnit(unit: Unit): void {
  train = unit;
  train.owner = getTrainPlayer();
  SetUnitPathing(train.handle, false);
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  SetUnitState(train.handle, UNIT_STATE_LIFE, gameState.trainMaxHP);
  BlzSetUnitMaxMana(train.handle, gameState.trainMaxMana);
}

/** Set an item's charges on the train, creating or removing as needed. */
function setTrainItem(itemTypeId: number, charges: number, slot: number): void {
  const existing = findItemByType(train, itemTypeId);
  if (charges <= 0) {
    if (existing != null) RemoveItem(existing.handle);
    return;
  }
  if (existing != null) {
    existing.charges = charges;
  } else {
    const newItem = Item.create(itemTypeId, train.x, train.y);
    if (newItem != null) {
      newItem.charges = charges;
      UnitAddItem(train.handle, newItem.handle);
      UnitDropItemSlot(train.handle, newItem.handle, slot);
    }
  }
}

/** Sync the active train's stats to match current gameState. */
export function syncTrainStats(): void {
  if (train == null) return;
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
  BlzSetUnitMaxMana(train.handle, gameState.trainMaxMana);

  // In lobby, display items at max stack to illustrate capacity
  if (!isInGameplay()) {
    setTrainItem(TRACK_PIECE_ID, gameState.trainTrackMaxStack, 0);
    setTrainItem(WOOD_ID, gameState.trainCargoMaxStack, 1);
    setTrainItem(STONE_ID, gameState.trainCargoMaxStack, 2);
  }
}

registerSyncCallback(syncTrainStats);

export function initLobbyTrain(unit: Unit): void {
  setInGameplay(false);
  setupTrainUnit(unit);
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, 0);
  train.moveSpeed = 0;
  syncState();
}

let onVictory: (() => void) | null = null;
let onAwardVictory: (() => void) | null = null;

export function setVictoryCallback(cb: () => void): void {
  onVictory = cb;
}

export function setAwardVictoryCallback(cb: () => void): void {
  onAwardVictory = cb;
}

function enterLobby(): void {
  setInGameplay(false);
  if (onVictory != null) onVictory();
}

let lowHpTrigger: Trigger;

function initTrainUnit(unit: Unit): void {
  setupTrainUnit(unit);
  initProduction(train);

  // Re-register HP trigger for the new unit handle
  if (lowHpTrigger != null) lowHpTrigger.destroy();
  lowHpTrigger = Trigger.create();
  TriggerRegisterUnitStateEvent(lowHpTrigger.handle, train.handle, UNIT_STATE_LIFE, LESS_THAN, 2.0);
  lowHpTrigger.addAction(() => {
    if (burning || !isInGameplay()) return;
    burning = true;
    SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
    BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
    pauseProduction();
    print('The train is on fire and is losing max HP!');
    burnTimer = Timer.create();
    burnTimer.start(1, true, () => {
      gameState.trainMaxHP -= 1;
      BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
      SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
    });
  });
}

let arrivalTrigger: Trigger;

export function initTrain(unit: Unit) {
  // Reset state from previous train
  targetIdx = 0;
  crashDeadline = 0;
  gameOver = false;
  burning = false;
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }

  // Destroy previous arrival infrastructure
  if (arrivalTrigger != null) arrivalTrigger.destroy();
  if (arrivalRegion != null) arrivalRegion.destroy();
  if (arrivalRect != null) arrivalRect.destroy();

  setInGameplay(true);
  initTrainUnit(unit);
  syncState();
  setMoveOrderCallback(() => reissueMoveOrder());

  // Create the arrival region (initially at origin, will be repositioned by moveToNext)
  arrivalRect = Rectangle.create(0, 0, 0, 0);
  arrivalRegion = Region.create();
  arrivalRegion.addRect(arrivalRect);

  // Trigger fires when the train enters the arrival region
  arrivalTrigger = Trigger.create();
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
    if (isVictoryTriggered()) {
      const victoryDelay = (REGION_HALF + OVERSHOOT) / train.moveSpeed;
      Timer.create().start(victoryDelay, false, () => {
        print('Victory!');
        if (onAwardVictory != null) onAwardVictory();
        enterLobby();
      });
      return;
    }
    print('Train about to crash!');
    const crashDelay = (REGION_HALF + OVERSHOOT) / gameState.trainSpeed;
    crashDeadline = os.clock() + crashDelay;
    Timer.create().start(crashDelay, false, () => {
      if (crashDeadline !== 0) {
        print('Game over!');
        crashDeadline = 0;
        gameOver = true;
        deleteSave();
      }
    });
  });

  // Start slow, ramp up to full speed after 30 seconds
  train.moveSpeed = 1;
  Timer.create().start(30, false, () => {
    if (train.moveSpeed === 1) {
      train.moveSpeed = gameState.trainSpeed;
    }
  });

  moveToNext();
}
