import { Item, Trigger, Unit } from 'w3ts';
import { updateCarryingVisual } from './carrying';
import { gameState } from './state';
import { nextFrame } from './util';
import {
  AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID,
  PEASANT_ID, TRAIN_ID, TRACK_WAGON_ID, CRATE_ID,
  BUILD_TRACK_ABILITY_ID, BRIDGE_ABILITY_ID, FILL_ABILITY_ID, WATER_TRAIN_ABILITY_ID,
} from './constants';

let onTrainInventoryChanged: (() => void) | null = null;

/** Register a callback that fires whenever the train's inventory changes. */
export function setTrainInventoryCallback(cb: () => void): void {
  onTrainInventoryChanged = cb;
}

let crate: Unit | null = null;
let crateStart: Unit | null = null;

export function setCrate(u: Unit): void {
  crate = u;
}

export function setCrateStart(u: Unit): void {
  crateStart = u;
}

export function getCrate(): Unit | null {
  return crate;
}

export function getCrateStart(): Unit | null {
  return crateStart;
}

/** Sync the target crate's current inventory into gameState. */
function syncCrateState(): void {
  if (crate == null) return;
  const tracks = findItemByType(crate, TRACK_PIECE_ID);
  const wood = findItemByType(crate, WOOD_ID);
  const stone = findItemByType(crate, STONE_ID);
  gameState.crateTrackCount = tracks != null ? tracks.charges : 0;
  gameState.crateWoodCount = wood != null ? wood.charges : 0;
  gameState.crateStoneCount = stone != null ? stone.charges : 0;
}

/** Set an item's charges on a storage unit, creating or removing the item as needed. */
export function setStorageItem(target: Unit, itemTypeId: number, charges: number, slot: number): void {
  const existing = findItemByType(target, itemTypeId);
  if (charges <= 0) {
    if (existing != null) RemoveItem(existing.handle);
    return;
  }
  if (existing != null) {
    existing.charges = charges;
  } else {
    const newItem = Item.create(itemTypeId, target.x, target.y);
    if (newItem != null) {
      newItem.charges = charges;
      UnitAddItem(target.handle, newItem.handle);
      UnitDropItemSlot(target.handle, newItem.handle, slot);
    }
  }
}

/** Populate the start crate from saved counts and reset them. Called at round start. */
export function loadCrateForRound(): void {
  if (crateStart == null) return;
  setStorageItem(crateStart, TRACK_PIECE_ID, gameState.crateTrackCount, 0);
  setStorageItem(crateStart, WOOD_ID, gameState.crateWoodCount, 1);
  setStorageItem(crateStart, STONE_ID, gameState.crateStoneCount, 2);
  gameState.crateTrackCount = 0;
  gameState.crateWoodCount = 0;
  gameState.crateStoneCount = 0;
}

/** Populate the start crate with max stack to show capacity. Called in lobby. */
export function loadCrateForLobby(): void {
  if (crateStart == null) return;
  setStorageItem(crateStart, TRACK_PIECE_ID, gameState.crateMaxStack, 0);
  setStorageItem(crateStart, WOOD_ID, gameState.crateMaxStack, 1);
  setStorageItem(crateStart, STONE_ID, gameState.crateMaxStack, 2);
}

function isCrate(u: Unit): boolean {
  return u.handle === crate?.handle;
}

/** Abilities granted while carrying the matching item type. */
const ITEM_GATED_ABILITIES: ReadonlyArray<readonly [number, number]> = [
  [TRACK_PIECE_ID, BUILD_TRACK_ABILITY_ID],
  [WOOD_ID, BRIDGE_ABILITY_ID],
  [BUCKET_ID, FILL_ABILITY_ID],
  [BUCKET_FULL_ID, WATER_TRAIN_ABILITY_ID],
];

/** Grant or revoke item-gated abilities (build track, bridge, fill, water train). */
export function updateBuildAbility(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  for (const [itemId, abilityId] of ITEM_GATED_ABILITIES) {
    if (findItemByType(u, itemId) != null) {
      UnitAddAbility(u.handle, abilityId);
    } else {
      UnitRemoveAbility(u.handle, abilityId);
    }
  }
}

/** Fixed inventory slot for each resource type on storage units (0-indexed). */
function storageSlot(itemTypeId: number): number {
  if (itemTypeId === TRACK_PIECE_ID) return 0;
  if (itemTypeId === WOOD_ID) return 1;
  if (itemTypeId === STONE_ID) return 2;
  return 0;
}


/** Show a rejection message and stop the unit. */
export function rejectOrder(unitHandle: unit, msg: string): void {
  showFloatingText(unitHandle, msg);
  nextFrame(() => IssueImmediateOrder(unitHandle, 'stop'));
}

/** Intercept a peasant's target order and reject it (with a message) unless
 *  the target passes the given check. */
export function registerPeasantTargetCheck(
  orderId: number,
  isValidTarget: (target: Unit) => boolean,
  rejectMsg: string,
): void {
  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  trigger.addAction(() => {
    if (GetIssuedOrderId() !== orderId) return;
    const unit = Unit.fromEvent();
    if (unit == null || unit.typeId !== PEASANT_ID) return;

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;

    if (!isValidTarget(target)) {
      rejectOrder(unit.handle, rejectMsg);
    }
  });
}

/** Show a floating text message above a unit. */
export function showFloatingText(unitHandle: unit, msg: string): void {
  const tt = CreateTextTag();
  if (tt != null) {
    SetTextTagText(tt, msg, 0.024);
    SetTextTagPosUnit(tt, unitHandle, 0);
    SetTextTagColor(tt, 255, 200, 200, 255);
    SetTextTagVelocity(tt, 0, 0.03);
    SetTextTagPermanent(tt, false);
    SetTextTagLifespan(tt, 2.0);
    SetTextTagFadepoint(tt, 1.5);
  }
}

export function isStorage(u: Unit): boolean {
  return u.typeId === TRAIN_ID || u.typeId === TRACK_WAGON_ID || u.typeId === CRATE_ID;
}

export function isTrain(u: Unit): boolean {
  return u.typeId === TRAIN_ID;
}

export function isTrackWagon(u: Unit): boolean {
  return u.typeId === TRACK_WAGON_ID;
}

/** Get the max stack size for a unit and item type. */
export function getMaxStack(u: Unit, itemTypeId?: number): number {
  if (isTrain(u)) {
    return itemTypeId === TRACK_PIECE_ID ? gameState.trainTrackMaxStack : gameState.trainCargoMaxStack;
  }
  if (isTrackWagon(u)) return gameState.trainTrackMaxStack;
  if (u.typeId === CRATE_ID) return gameState.crateMaxStack;
  return gameState.peasantMaxStack;
}

export function isResource(itemTypeId: number): boolean {
  return itemTypeId === WOOD_ID || itemTypeId === STONE_ID || itemTypeId === TRACK_PIECE_ID;
}

/** Items reserved for the train game systems (peasants, train, crate). */
function isTrainItem(itemTypeId: number): boolean {
  return isResource(itemTypeId)
    || itemTypeId === AXE_ID || itemTypeId === PICKAXE_ID
    || itemTypeId === BUCKET_ID || itemTypeId === BUCKET_FULL_ID;
}

/** Check whether a unit is carrying an item of the given type. */
export function unitHasItemType(u: Unit, itemTypeId: number): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const it = u.getItemInSlot(slot);
    if (it != null && it.typeId === itemTypeId) return true;
  }
  return false;
}

/** Get the item in slot 0 (first inventory slot) for a unit. */
export function getSlot0Item(u: Unit): Item | null {
  return u.getItemInSlot(0) ?? null;
}

/** Find an item of the given type in a unit's inventory. */
export function findItemByType(u: Unit, itemTypeId: number): Item | null {
  for (let slot = 0; slot < 6; slot++) {
    const it = u.getItemInSlot(slot);
    if (it != null && it.typeId === itemTypeId) return it;
  }
  return null;
}

/** Find any item in a unit's inventory. */
export function findAnyItem(u: Unit): Item | null {
  for (let slot = 0; slot < 6; slot++) {
    const it = u.getItemInSlot(slot);
    if (it != null) return it;
  }
  return null;
}

/**
 * Check whether a target unit can accept an item.
 * Returns an error message string if rejected, or null if accepted.
 */
export function validateGive(itemTypeId: number, target: Unit): string | null {
  // The track wagon is filled by the engine's production — only take
  if (isTrackWagon(target)) {
    return "Can't load the wagon!";
  }

  // Storage units only accept resources (track, wood, stone)
  if (isStorage(target) && !isResource(itemTypeId)) {
    return "Can't store that!";
  }

  // Can't give tracks to the train — only take
  if (isTrain(target) && itemTypeId === TRACK_PIECE_ID) {
    return "Can't load tracks!";
  }

  const matching = findItemByType(target, itemTypeId);
  if (matching != null) {
    if (matching.charges >= getMaxStack(target, itemTypeId)) {
      return 'Inventory full!';
    }
    return null; // Can stack more
  }

  // No matching item — storage units can hold multiple types, peasants can't
  if (!isStorage(target)) {
    const existing = findAnyItem(target);
    if (existing != null) {
      return "Can't mix items!";
    }
  }

  return null; // Target can accept
}

/** Priority order for taking items from storage. */
const TAKE_PRIORITY = [TRACK_PIECE_ID, WOOD_ID, STONE_ID];

/**
 * Determine which item type to take from a storage unit.
 * Returns the item type ID, or 0 if storage is empty.
 */
function chooseTakeType(storage: Unit): number {
  for (const typeId of TAKE_PRIORITY) {
    const item = findItemByType(storage, typeId);
    if (item != null && item.charges > 0) return typeId;
  }
  return 0;
}

/**
 * Check whether a taker can take from a storage unit.
 * Returns an error message if rejected, or null if allowed.
 */
export function validateTake(taker: Unit, storage: Unit): string | null {
  if (!isStorage(storage)) {
    return "Can't take from that!";
  }

  // Special case: holding tracks and targeting the track wagon → take more tracks
  const heldItem = getSlot0Item(taker);
  if (heldItem != null && heldItem.typeId === TRACK_PIECE_ID && isTrackWagon(storage)) {
    const wagonTracks = findItemByType(storage, TRACK_PIECE_ID);
    if (wagonTracks == null || wagonTracks.charges <= 0) {
      return 'No tracks!';
    }
    if (heldItem.charges >= getMaxStack(taker, TRACK_PIECE_ID)) {
      return 'Inventory full!';
    }
    return null;
  }

  // General take — slot 0 is empty, just check storage has something
  const takeType = chooseTakeType(storage);
  if (takeType === 0) {
    return 'Nothing to take!';
  }

  return null;
}

/**
 * Transfer an item from giver to storage, respecting stack caps.
 * Moves as many charges as possible; removes the giver's item if fully transferred.
 */
export function giveToStorage(giver: Unit, giverItem: Item, storage: Unit): boolean {
  const itemType = giverItem.typeId;
  const maxStack = getMaxStack(storage, itemType);
  const existing = findItemByType(storage, itemType);
  const currentCharges = existing != null ? existing.charges : 0;
  const canGive = maxStack - currentCharges;
  if (canGive <= 0) return false;

  const toGive = math.min(giverItem.charges, canGive);

  if (existing != null) {
    existing.charges += toGive;
  } else {
    const newItem = Item.create(itemType, storage.x, storage.y);
    if (newItem != null) {
      newItem.charges = toGive;
      UnitAddItem(storage.handle, newItem.handle);
      UnitDropItemSlot(storage.handle, newItem.handle, storageSlot(itemType));
    }
  }

  giverItem.charges -= toGive;
  if (giverItem.charges <= 0) {
    RemoveItem(giverItem.handle);
  }

  notifyStorageChanged(storage);

  return true;
}

/** Fire inventory-change side effects after a storage unit's contents change. */
function notifyStorageChanged(storage: Unit): void {
  if ((isTrain(storage) || isTrackWagon(storage)) && onTrainInventoryChanged != null) {
    onTrainInventoryChanged();
  }
  if (isCrate(storage)) syncCrateState();
}

/**
 * Transfer an item from storage to taker, respecting stack caps.
 * Returns true if anything was transferred.
 */
export function takeFromStorage(taker: Unit, storage: Unit): boolean {
  const takeType = chooseTakeType(storage);
  if (takeType === 0) return false;

  const source = findItemByType(storage, takeType);
  if (source == null || source.charges <= 0) return false;

  const maxStack = getMaxStack(taker, takeType);
  const existing = findItemByType(taker, takeType);
  const currentCharges = existing != null ? existing.charges : 0;
  const canTake = maxStack - currentCharges;
  if (canTake <= 0) return false;

  const toTake = math.min(source.charges, canTake);

  if (existing != null) {
    existing.charges += toTake;
  } else {
    const newItem = Item.create(takeType, taker.x, taker.y);
    if (newItem != null) {
      newItem.charges = toTake;
      UnitAddItem(taker.handle, newItem.handle);
    }
  }

  source.charges -= toTake;
  if (source.charges <= 0) {
    RemoveItem(source.handle);
  }

  notifyStorageChanged(storage);

  return true;
}

// Map of item handle → giver handle for in-flight give operations.
// Populated when we know a give is happening (spell or manual drag).
const pendingGivers = new Map<item, unit>();

/** Initialize the item pickup handler (stacking, one-item enforcement). */
export function initItems(): void {
  // Track who dropped an item — keyed by item handle so it can't go stale
  const dropTrigger = Trigger.create();
  dropTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DROP_ITEM);
  dropTrigger.addAction(() => {
    const dropperHandle = GetTriggerUnit();
    const droppedItem = GetManipulatedItem();
    if (dropperHandle != null && droppedItem != null) {
      pendingGivers.set(droppedItem, dropperHandle);
      // Clean up if no PICKUP_ITEM follows (e.g. dropped on ground, not to a unit)
      nextFrame(() => {
        pendingGivers.delete(droppedItem);
        const dropper = Unit.fromHandle(dropperHandle);
        if (dropper != null) {
          updateBuildAbility(dropper);
          updateCarryingVisual(dropper);
        }
      });
    }
  });

  const pickupTrigger = Trigger.create();
  pickupTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickupTrigger.addAction(() => {
    const unit = Unit.fromEvent();
    const picked = Item.fromEvent();
    if (unit == null || picked == null) return;

    const pickedType = picked.typeId;
    const pickedIsResource = isResource(pickedType);
    const dropper = pendingGivers.get(picked.handle) ?? null;
    pendingGivers.delete(picked.handle);
    // The unit that gave us this item, if it came from another unit
    const giver = dropper != null && dropper !== unit.handle ? dropper : null;

    // Remove the picked item; return it to the giver (with an optional message) if one exists.
    const rejectPickup = (msg?: string): void => {
      unit.removeItem(picked);
      if (giver != null) {
        UnitAddItem(giver, picked.handle);
        if (msg != null) showFloatingText(giver, msg);
      }
    };

    // Peasants can only pick up train items (tools, resources, buckets)
    if (unit.typeId === PEASANT_ID && !isTrainItem(pickedType)) {
      rejectPickup();
      return;
    }

    // Heroes can't pick up train items
    if (IsUnitType(unit.handle, UNIT_TYPE_HERO) && isTrainItem(pickedType)) {
      rejectPickup();
      return;
    }

    // Storage units only accept resources
    if (isStorage(unit) && !pickedIsResource) {
      rejectPickup("Can't store that!");
      return;
    }

    // Can't give tracks to the train (but allow internally produced tracks)
    if (isTrain(unit) && pickedType === TRACK_PIECE_ID && giver != null) {
      rejectPickup("Can't load tracks!");
      return;
    }

    // The track wagon only receives tracks from production, never from players
    if (isTrackWagon(unit) && giver != null) {
      rejectPickup("Can't load the wagon!");
      return;
    }

    // Scan inventory for existing items (excluding the one just picked up)
    let otherItem: Item | undefined;
    let matchingResource: Item | undefined;
    for (let slot = 0; slot < 6; slot++) {
      const it = unit.getItemInSlot(slot);
      if (it == null || it.handle === picked.handle) continue;
      if (pickedIsResource && it.typeId === pickedType) {
        matchingResource = it;
      } else {
        otherItem = it;
      }
    }

    if (matchingResource != null) {
      // Same resource type — merge charges up to max stack
      const maxStack = getMaxStack(unit, pickedType);
      if (matchingResource.charges >= maxStack) {
        rejectPickup('Inventory full!');
        return;
      }
      const total = matchingResource.charges + picked.charges;
      const kept = math.min(total, maxStack);
      const remainder = total - kept;

      matchingResource.charges = kept;
      if (remainder > 0) {
        // Return excess to the giver, or drop it at the unit's feet
        picked.charges = remainder;
        rejectPickup();
      } else {
        RemoveItem(picked.handle);
      }
    } else if (otherItem != null && unit.typeId === PEASANT_ID) {
      // Peasant picking up a different item type — swap
      if (giver != null) {
        rejectPickup("Can't mix items!");
      } else {
        // Self-pickup — drop the old one, move picked to slot 0
        unit.removeItem(otherItem);
        UnitDropItemSlot(unit.handle, picked.handle, 0);
      }
    } else if (isStorage(unit) && pickedIsResource) {
      // Move to the correct fixed slot for this resource type
      UnitDropItemSlot(unit.handle, picked.handle, storageSlot(pickedType));
    }

    // Update train production when the engine's or track wagon's inventory changes
    if ((isTrain(unit) || isTrackWagon(unit)) && onTrainInventoryChanged != null) {
      onTrainInventoryChanged();
    }

    updateBuildAbility(unit);
    updateCarryingVisual(unit);
  });
}
