import { Item, Trigger, Unit } from 'w3ts';
import {
  WOOD_ID,
  STONE_ID,
  TRACK_PIECE_ID,
  findItemByType,
  getMaxStack,
  setTrainInventoryCallback,
} from './items';
import { gameState } from './state';


let onProductionInventoryChanged: (() => void) | null = null;

/** Register a callback to re-issue the train's move order after inventory changes. */
export function setMoveOrderCallback(cb: () => void): void {
  onProductionInventoryChanged = cb;
}

let train: Unit;
let productionRate = 12; // mana regen per second when producing
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

/** Check if the train has resources to produce and isn't at max tracks. */
function canProduce(): boolean {
  const wood = findItemByType(train, WOOD_ID);
  const stone = findItemByType(train, STONE_ID);
  if (wood == null || wood.charges <= 0) return false;
  if (stone == null || stone.charges <= 0) return false;
  const tracks = findItemByType(train, TRACK_PIECE_ID);
  const maxStack = getMaxStack(train, TRACK_PIECE_ID);
  if (tracks != null && tracks.charges >= maxStack) return false;
  return true;
}

/** Called when the train's mana reaches 100. */
function onManaFull(): void {
  const wood = findItemByType(train, WOOD_ID);
  const stone = findItemByType(train, STONE_ID);
  if (wood == null || stone == null) {
    // Resources removed mid-regen — reset
    stopProduction();
    return;
  }

  // Consume 1 wood and 1 stone
  wood.charges -= 1;
  if (wood.charges <= 0) RemoveItem(wood.handle);
  stone.charges -= 1;
  if (stone.charges <= 0) RemoveItem(stone.handle);

  // Create or add to track stack in slot 0
  const tracks = findItemByType(train, TRACK_PIECE_ID);
  if (tracks != null) {
    tracks.charges += 1;
  } else {
    const newTrack = Item.create(TRACK_PIECE_ID, train.x, train.y);
    if (newTrack != null) {
      newTrack.charges = 1;
      UnitAddItem(train.handle, newTrack.handle);
      UnitDropItemSlot(train.handle, newTrack.handle, 0);
    }
  }

  // Reset mana
  train.mana = 0;

  // Check if we can keep producing
  if (canProduce()) {
    startProduction();
  } else {
    stopProduction();
  }

  // UnitAddItem/UnitDropItemSlot issue implicit orders that cancel movement
  if (onProductionInventoryChanged != null) onProductionInventoryChanged();
}

/** Start mana regen. */
function startProduction(): void {
  producing = true;
  train.mana = 0;
  BlzSetUnitRealField(train.handle, UNIT_RF_MANA_REGENERATION, productionRate);
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
export function updateProduction(): void {
  const shouldProduce = canProduce() && !paused;

  if (shouldProduce && !producing) {
    startProduction();
  } else if (!shouldProduce && producing) {
    stopProduction();
  }
  // If shouldProduce && already producing, keep going (don't reset progress)
}

/** Initialize the production system. Must be called after the train is created. */
let manaTrigger: Trigger | null = null;

export function initProduction(trainUnit: Unit): void {
  train = trainUnit;
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
    if (onProductionInventoryChanged != null) onProductionInventoryChanged();
  });
}
