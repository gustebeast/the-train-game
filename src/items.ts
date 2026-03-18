import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { Abilities } from '@objectdata/abilities';
import { updateCarryingVisual } from './carrying';

let onTrainInventoryChanged: (() => void) | null = null;

/** Register a callback that fires whenever the train's inventory changes. */
export function setTrainInventoryCallback(cb: () => void): void {
  onTrainInventoryChanged = cb;
}

export const AXE_ID = FourCC(Items.SturdyWarAxe);
export const PICKAXE_ID = FourCC(Items.RustyMiningPick);
export const WOOD_ID = FourCC(Items.IronwoodBranch);
export const STONE_ID = FourCC(Items.GemFragment);
export const TRACK_PIECE_ID = FourCC(Items.MechanicalCritter);
export const BUCKET_ID = FourCC(Items.EmptyVial);
export const BUCKET_FULL_ID = FourCC(Items.FullVial);

const TRAIN_ID = FourCC(Units.WarWagon);
const CRATE_ID = FourCC(Units.GrainWarehouse);
const PEASANT_ID = FourCC(Units.Peasant);
const BUILD_ABILITY_ID = FourCC(Abilities.BuildTinyFarm);
const BRIDGE_ABILITY_ID = FourCC(Abilities.AcidBomb);
const FILL_ABILITY_ID = FourCC(Abilities.ShadowStrike);
const WATER_TRAIN_ABILITY_ID = FourCC(Abilities.DrunkenHaze);

/** Grant or revoke item-gated abilities (build track, build bridge). */
export function updateBuildAbility(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  if (findItemByType(u, TRACK_PIECE_ID) != null) {
    UnitAddAbility(u.handle, BUILD_ABILITY_ID);
  } else {
    UnitRemoveAbility(u.handle, BUILD_ABILITY_ID);
  }
  if (findItemByType(u, WOOD_ID) != null) {
    UnitAddAbility(u.handle, BRIDGE_ABILITY_ID);
  } else {
    UnitRemoveAbility(u.handle, BRIDGE_ABILITY_ID);
  }
  if (findItemByType(u, BUCKET_ID) != null) {
    UnitAddAbility(u.handle, FILL_ABILITY_ID);
  } else {
    UnitRemoveAbility(u.handle, FILL_ABILITY_ID);
  }
  if (findItemByType(u, BUCKET_FULL_ID) != null) {
    UnitAddAbility(u.handle, WATER_TRAIN_ABILITY_ID);
  } else {
    UnitRemoveAbility(u.handle, WATER_TRAIN_ABILITY_ID);
  }
}

/** Fixed inventory slot for each resource type on storage units (0-indexed). */
function storageSlot(itemTypeId: number): number {
  if (itemTypeId === TRACK_PIECE_ID) return 0;
  if (itemTypeId === WOOD_ID) return 1;
  if (itemTypeId === STONE_ID) return 2;
  return 0;
}

let crateMaxStack = 10;
let trainTrackMaxStack = 3;
let trainCargoMaxStack = 3;
let peasantMaxStack = 3;

/** Show a rejection message and stop the unit. */
export function rejectOrder(unitHandle: unit, msg: string): void {
  showFloatingText(unitHandle, msg);
  const t = Timer.create();
  t.start(0, false, () => {
    IssueImmediateOrder(unitHandle, 'stop');
    t.destroy();
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
  return u.typeId === TRAIN_ID || u.typeId === CRATE_ID;
}

export function isTrain(u: Unit): boolean {
  return u.typeId === TRAIN_ID;
}

/** Get the max stack size for a unit and item type. */
export function getMaxStack(u: Unit, itemTypeId?: number): number {
  if (isTrain(u)) {
    return itemTypeId === TRACK_PIECE_ID ? trainTrackMaxStack : trainCargoMaxStack;
  }
  if (u.typeId === CRATE_ID) return crateMaxStack;
  return peasantMaxStack;
}

export function isResource(itemTypeId: number): boolean {
  return itemTypeId === WOOD_ID || itemTypeId === STONE_ID || itemTypeId === TRACK_PIECE_ID;
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
  const it = u.getItemInSlot(0);
  return it != null ? it : null;
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

  // Special case: holding tracks and targeting train → take more tracks
  const heldItem = getSlot0Item(taker);
  if (heldItem != null && heldItem.typeId === TRACK_PIECE_ID && isTrain(storage)) {
    const trainTracks = findItemByType(storage, TRACK_PIECE_ID);
    if (trainTracks == null || trainTracks.charges <= 0) {
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

  if (isTrain(storage)) {
    if (onTrainInventoryChanged != null) onTrainInventoryChanged();
  }

  return true;
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

  // Update train production when its inventory changes
  if (isTrain(storage)) {
    if (onTrainInventoryChanged != null) onTrainInventoryChanged();
  }

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
      const t = Timer.create();
      t.start(0, false, () => {
        pendingGivers.delete(droppedItem);
        t.destroy();
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

    // Storage units only accept resources
    if (isStorage(unit) && !pickedIsResource) {
      if (dropper != null && dropper !== unit.handle) {
        unit.removeItem(picked);
        UnitAddItem(dropper, picked.handle);
        showFloatingText(dropper, "Can't store that!");
      } else {
        unit.removeItem(picked);
      }
      return;
    }

    // Can't give tracks to the train (but allow internally produced tracks)
    if (isTrain(unit) && pickedType === TRACK_PIECE_ID && dropper != null && dropper !== unit.handle) {
      unit.removeItem(picked);
      UnitAddItem(dropper, picked.handle);
      showFloatingText(dropper, "Can't load tracks!");
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
        // Already full — reject entirely
        if (dropper != null && dropper !== unit.handle) {
          unit.removeItem(picked);
          UnitAddItem(dropper, picked.handle);
          showFloatingText(dropper, 'Inventory full!');
        } else {
          unit.removeItem(picked);
        }
        return;
      }
      const total = matchingResource.charges + picked.charges;
      const kept = math.min(total, maxStack);
      const remainder = total - kept;

      matchingResource.charges = kept;
      if (remainder > 0) {
        if (dropper != null && dropper !== unit.handle) {
          // Return excess to the giver
          picked.charges = remainder;
          unit.removeItem(picked);
          UnitAddItem(dropper, picked.handle);
        } else {
          // Drop leftover at the unit's feet
          picked.charges = remainder;
          unit.removeItem(picked);
        }
      } else {
        RemoveItem(picked.handle);
      }
    } else if (otherItem != null && !isStorage(unit)) {
      // Peasant picking up a different item type — swap
      if (dropper != null && dropper !== unit.handle) {
        // Given by another unit — reject, return to giver
        unit.removeItem(picked);
        UnitAddItem(dropper, picked.handle);
        showFloatingText(dropper, "Can't mix items!");
      } else {
        // Self-pickup — drop the old one, move picked to slot 0
        unit.removeItem(otherItem);
        UnitDropItemSlot(unit.handle, picked.handle, 0);
      }
    } else if (isStorage(unit) && pickedIsResource) {
      // Move to the correct fixed slot for this resource type
      UnitDropItemSlot(unit.handle, picked.handle, storageSlot(pickedType));
    }

    // Update train production when its inventory changes
    if (isTrain(unit)) {
      if (onTrainInventoryChanged != null) onTrainInventoryChanged();
    }

    updateBuildAbility(unit);
    updateCarryingVisual(unit);
  });
}
