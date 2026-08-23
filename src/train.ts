import { Unit, Timer, Trigger, Rectangle, Region } from 'w3ts';
import { createTimer, startOneShot } from './timers';
import { placedTracks, isVictoryTriggered } from './track/state';
import { GridPos } from './terrain/constants';
import { getTrainPlayer } from './teams';
import { gameState, isInGameplay, setInGameplay, registerSyncCallback, syncState } from './state';
// import { deleteSave } from './save';
import { setStorageItem } from './items';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID } from './constants';

import { initProduction, setMoveOrderCallback, pauseProduction, resumeProduction } from './production';

const OVERSHOOT = 16;
const REGION_HALF = 2; // 4x4 region → half-size = 2
const STUCK_TIMEOUT = 35;
const CENTER_OFFSET = 16;
const TRAIN_HP_REGEN = -1; // HP per second; negative = decay
let arrivalRect: Rectangle;
let arrivalRegion: Region;
let lastMoveTime: number = 0;
let targetIdx: number = 0;
let train: Unit;
let trackWagon: Unit;
let crashDeadline: number = 0;
let gameOver: boolean = false;
let burning: boolean = false;
let burnTimer: Timer | null = null;
let burnEffects: effect[] = [];
/** Max HP the fire leaves behind. At this point the train is wrecked: the decay
 *  stops (so max HP never reaches 0 and kills it outright) and the burn becomes
 *  permanent. */
const TRAIN_WRECKED_MAX_HP = 1;
let wrecked: boolean = false;

/** Attach the full burning look to the engine. The automatic damage fire is
 *  disabled (the train is no longer classified Mechanical, see compiletime.ts)
 *  so fire only ever appears here, at the 1HP burning state. */
function igniteBurnVisuals(): void {
  if (burnEffects.length > 0) return;
  for (const point of ['sprite first', 'sprite second', 'sprite third']) {
    const e = AddSpecialEffectTarget('Environment\\LargeBuildingFire\\LargeBuildingFire1.mdl', train.handle, point);
    if (e != null) burnEffects.push(e);
  }
}

/** Remove the burning look. Scale to 0 first so the fire vanishes instantly
 *  instead of playing its lingering death animation. */
function clearBurnVisuals(): void {
  for (const e of burnEffects) {
    BlzSetSpecialEffectScale(e, 0);
    DestroyEffect(e);
  }
  burnEffects = [];
}

export function isBurning(): boolean {
  return burning;
}

/** True once the fire has eaten all the train's max HP. The train stays alight
 *  for the rest of the round and can never produce tracks again. */
export function isWrecked(): boolean {
  return wrecked;
}

/** The fire has consumed every point of max HP. Stop the decay and leave the
 *  train burning for good.
 *
 *  Deliberately NOT an instant game over: the players lose track production,
 *  not the run. If they already have enough tracks banked to reach the exit
 *  they can still finish, which is the comeback this state exists to allow. */
function wreckTrain(): void {
  if (wrecked) return;
  wrecked = true;
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }
  print('The train is wrecked! It can no longer produce tracks.');
}

export function stopGameplay(): void {
  setInGameplay(false);
}

export function extinguish(): void {
  if (!burning) return;
  // A wrecked train cannot be put out. Its max HP is spent, so there is nothing
  // for water to restore and production stays dead for the rest of the round.
  if (wrecked) return;
  burning = false;
  clearBurnVisuals();
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, TRAIN_HP_REGEN);
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

// The engine's current move-order point and the previous one. The wagon is
// always ordered to the engine's previous point, so it retraces the engine's
// exact path (including overshoots) one order behind.
let enginePoint: GridPos | null = null;
let wagonPoint: GridPos | null = null;

/** Re-issue both cars' current move orders from the stored points. */
function issueCarOrders(): void {
  if (enginePoint != null) train.issueOrderAt('move', enginePoint.x, enginePoint.y);
  if (wagonPoint != null && trackWagon != null) {
    trackWagon.issueOrderAt('move', wagonPoint.x, wagonPoint.y);
  }
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
  wagonPoint = enginePoint;
  enginePoint = { x: nxt.x + ox, y: nxt.y + oy };
  issueCarOrders();
}

/** How many laid tracks remain ahead of the train. 0 means the next arrival
 *  crashes it. Used by the "Living Dangerously" challenge to tell how close to
 *  the end of the line the train is running. */
export function getTracksRemaining(): number {
  const remaining = placedTracks.length - 1 - targetIdx;
  return remaining > 0 ? remaining : 0;
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
  // Inventory changes also happen in the inter-round lobby (capacity display items) —
  // never issue move orders there; the stored points are from the last round
  if (!isInGameplay()) return;

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

  // Item adds cancel both cars' move orders — re-issue the stored points
  issueCarOrders();
}

export function getTrain(): Unit {
  return train;
}

export function getTrackWagon(): Unit {
  return trackWagon;
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

/** Shared track wagon setup: owner, pathing off (so it clips through the
 *  engine instead of colliding with it), invulnerable. */
function setupWagonUnit(unit: Unit): void {
  trackWagon = unit;
  trackWagon.owner = getTrainPlayer();
  SetUnitPathing(trackWagon.handle, false);
  trackWagon.invulnerable = true;
}

/** Sync the active train's stats to match current gameState. */
export function syncTrainStats(): void {
  if (train == null) return;
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
  BlzSetUnitMaxMana(train.handle, gameState.trainMaxMana);

  // In inter-round lobby, display items at max stack to illustrate capacity
  if (!isInGameplay()) {
    setStorageItem(train, WOOD_ID, gameState.trainCargoMaxStack, 1);
    setStorageItem(train, STONE_ID, gameState.trainCargoMaxStack, 2);
    if (trackWagon != null) {
      setStorageItem(trackWagon, TRACK_PIECE_ID, gameState.trainTrackMaxStack, 0);
    }
  }
}

registerSyncCallback(syncTrainStats);

export function initInterRoundLobbyTrain(unit: Unit, wagon: Unit): void {
  setInGameplay(false);
  setupTrainUnit(unit);
  setupWagonUnit(wagon);
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, 0);
  train.moveSpeed = 0;
  trackWagon.moveSpeed = 0;
  syncState();
}

let onVictory: (() => void) | null = null;
let onAwardVictory: (() => void) | null = null;
let onDefeat: (() => void) | null = null;

export function setVictoryCallback(cb: () => void): void {
  onVictory = cb;
}

export function setDefeatCallback(cb: () => void): void {
  onDefeat = cb;
}

/** End the run in defeat: stop gameplay and hand off to the defeat lobby.
 *
 *  The mirror of the victory path. Previously running out of track only printed
 *  a message and left the round running with nothing left to do. Safe to call
 *  more than once and from anywhere (the crash timer, a cheat command). */
export function triggerDefeat(): void {
  if (gameOver || !isInGameplay()) return;
  gameOver = true;
  crashDeadline = 0;
  // Stop the fire before leaving, or its timer keeps eating max HP while the
  // players stand in the defeat lobby.
  burning = false;
  wrecked = false;
  clearBurnVisuals();
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }
  setInGameplay(false);
  print('Defeat! The train ran out of track.');
  if (onDefeat != null) onDefeat();
}

export function setAwardVictoryCallback(cb: () => void): void {
  onAwardVictory = cb;
}

function enterInterRoundLobby(): void {
  setInGameplay(false);
  if (onVictory != null) onVictory();
}

let lowHpTrigger: Trigger;

function initTrainUnit(unit: Unit): void {
  setupTrainUnit(unit);
  initProduction(train, trackWagon);

  // Re-register HP trigger for the new unit handle
  if (lowHpTrigger != null) lowHpTrigger.destroy();
  lowHpTrigger = Trigger.create();
  TriggerRegisterUnitStateEvent(lowHpTrigger.handle, train.handle, UNIT_STATE_LIFE, LESS_THAN, 2.0);
  lowHpTrigger.addAction(() => {
    if (burning || !isInGameplay()) return;
    burning = true;
    igniteBurnVisuals();
    SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
    BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
    pauseProduction();
    print('The train is on fire and is losing max HP!');
    burnTimer = createTimer();
    burnTimer.start(1, true, () => {
      if (gameState.trainMaxHP <= TRAIN_WRECKED_MAX_HP) {
        wreckTrain();
        return;
      }
      gameState.trainMaxHP -= 1;
      BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
      SetUnitState(train.handle, UNIT_STATE_LIFE, 1);
      if (gameState.trainMaxHP <= TRAIN_WRECKED_MAX_HP) wreckTrain();
    });
  });
}

let arrivalTrigger: Trigger;

export function initTrain(unit: Unit, wagon: Unit) {
  // Reset state from previous train. The engine spawns on the second track
  // (index 1) with the wagon behind it on the first (index 0); the runway
  // track (index 2) gives it an initial move target.
  targetIdx = 1;
  crashDeadline = 0;
  gameOver = false;
  burning = false;
  wrecked = false;
  clearBurnVisuals();
  if (burnTimer != null) {
    burnTimer.destroy();
    burnTimer = null;
  }

  // Destroy previous arrival infrastructure
  if (arrivalTrigger != null) arrivalTrigger.destroy();
  if (arrivalRegion != null) arrivalRegion.destroy();
  if (arrivalRect != null) arrivalRect.destroy();

  setInGameplay(true);
  setupWagonUnit(wagon);
  initTrainUnit(unit);
  // Seed the order history: the engine's spawn point acts as its "previous
  // order", so the wagon's first order sends it to the engine's start tile.
  enginePoint = { x: unit.x, y: unit.y };
  wagonPoint = null;
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
      startOneShot(victoryDelay, () => {
        print('Victory!');
        if (onAwardVictory != null) onAwardVictory();
        enterInterRoundLobby();
      });
      return;
    }
    print('Train about to crash!');
    const crashDelay = (REGION_HALF + OVERSHOOT) / gameState.trainSpeed;
    crashDeadline = os.clock() + crashDelay;
    startOneShot(crashDelay, () => {
      if (crashDeadline !== 0) {
        triggerDefeat();
        // deleteSave(); // Disabled for testing
      }
    });
  });

  // Start slow, ramp up to full speed after 30 seconds
  train.moveSpeed = 1;
  trackWagon.moveSpeed = 1;
  startOneShot(30, () => {
    if (train.moveSpeed === 1) {
      train.moveSpeed = gameState.trainSpeed;
      trackWagon.moveSpeed = gameState.trainSpeed;
    }
  });

  moveToNext();
}
