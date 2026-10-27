import { Trigger, Unit } from 'w3ts';
import { getMaxStack, setStorageItem, setTrainInventoryCallback, chargesOf, spendCharge } from './items';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID } from './constants';
import { gameState } from './state';

/** Re-issues the train's move order: production's inventory changes issue
 *  implicit orders that cancel it. */
let moveOrderCallback: (() => void) | null = null;

/** Register a callback to re-issue the train's move order after inventory changes. */
export function setMoveOrderCallback(cb: () => void): void {
  moveOrderCallback = cb;
}

let train: Unit;
let trackWagon: Unit;
const PRODUCTION_RATE = 12; // mana regen per second when producing
let producing = false;
let paused = false;

export function pauseProduction(): void {
  paused = true;
  stopProduction();
}

export function resumeProduction(): void {
  paused = false;
  updateProduction();
}

/** Check if the train has resources to produce and the wagon isn't at max tracks. */
function canProduce(): boolean {
  if (chargesOf(train, WOOD_ID) <= 0 || chargesOf(train, STONE_ID) <= 0) return false;
  return chargesOf(trackWagon, TRACK_PIECE_ID) < getMaxStack(trackWagon);
}

/** Called when the train's mana fills (gameState.trainMaxMana): one track made. */
function onManaFull(): void {
  // Both checked before either is spent, so wood is never used up without stone
  if (chargesOf(train, WOOD_ID) <= 0 || chargesOf(train, STONE_ID) <= 0) {
    // Resources removed mid-regen — reset
    stopProduction();
    return;
  }
  spendCharge(train, WOOD_ID);
  spendCharge(train, STONE_ID);

  // Create or add to the track wagon's track stack in its slot
  setStorageItem(trackWagon, TRACK_PIECE_ID, chargesOf(trackWagon, TRACK_PIECE_ID) + 1);

  // Reset mana
  train.mana = 0;

  // Check if we can keep producing
  if (canProduce()) {
    startProduction();
  } else {
    stopProduction();
  }

  // UnitAddItem/UnitDropItemSlot issue implicit orders that cancel movement
  if (moveOrderCallback != null) moveOrderCallback();
}

/** Start mana regen. */
function startProduction(): void {
  producing = true;
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, PRODUCTION_RATE);
}

/** Stop production — reset mana and regen to 0. */
function stopProduction(): void {
  producing = false;
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, 0);
}

/**
 * Called whenever the train's inventory changes (item added/removed/charges changed).
 * Re-evaluates whether production should be running.
 */
function updateProduction(): void {
  const shouldProduce = canProduce() && !paused;

  if (shouldProduce && !producing) {
    startProduction();
  } else if (!shouldProduce && producing) {
    stopProduction();
  }
  // If shouldProduce && already producing, keep going (don't reset progress)
}

let manaTrigger: Trigger | null = null;

/** Initialize the production system. Must be called after the train is created. */
export function setupProduction(trainUnit: Unit, trackWagonUnit: Unit): void {
  train = trainUnit;
  trackWagon = trackWagonUnit;
  // A new train starts unlocked. The fire's pause is only lifted by putting
  // the fire out, so a round that ENDED burning -- a defeat, or a wrecked
  // train that still made it -- used to hand the lock to the next one.
  paused = false;
  producing = false;
  // Train starts with 0 mana, 0 regen — production begins when resources arrive
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, 0);

  // Destroy previous mana trigger if re-initializing for a new unit
  if (manaTrigger != null) manaTrigger.destroy();
  manaTrigger = Trigger.create();
  manaTrigger.registerUnitStateEvent(train, UNIT_STATE_MANA, GREATER_THAN_OR_EQUAL, gameState.trainMaxMana);
  manaTrigger.addAction(() => {
    onManaFull();
  });

  // Register callback so items.ts can notify us without a circular import
  setTrainInventoryCallback(() => {
    updateProduction();
    if (moveOrderCallback != null) moveOrderCallback();
  });
}
