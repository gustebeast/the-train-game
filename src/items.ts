import { Item, Trigger, Unit } from 'w3ts';
import { updateCarryingVisual } from './carrying';
import { gameState } from './state';
import { canHold, isPeasantAbilityItem, isResourceItem, isShopUpgrade } from './itemRules';
import { INVENTORY_SLOTS, giveItems, nextFrame, findInventoryItem } from './util';
import {
  WOOD_ID, STONE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID, PEASANT_ID, TRAIN_ID,
  TRACK_WAGON_ID, CRATE_ID, MUSCLE_MILK_ID, BUILD_TRACK_ABILITY_ID, BRIDGE_ABILITY_ID,
  FILL_ABILITY_ID, WATER_TRAIN_ABILITY_ID, ABILITY_ITEM_FAMILIES,
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

export function getCrateStart(): Unit | null {
  return crateStart;
}

/** Bank what is in the target crate as next round's starting crate. Called
 *  once, when the round is won and before the save is written.
 *
 *  Read off the crate rather than tallied as items go in: the tally only saw
 *  the give/take spell, so wood dropped in by a manual right-click never
 *  counted and silently failed to carry over. */
export function bankCrateForNextRound(): void {
  if (crate == null) return;
  gameState.crateTrackCount = chargesOf(crate, TRACK_PIECE_ID);
  gameState.crateWoodCount = chargesOf(crate, WOOD_ID);
  gameState.crateStoneCount = chargesOf(crate, STONE_ID);
}

/** Set an item's charges on a storage unit, creating or removing the item as
 *  needed. A new stack goes in the carrier's own slot for that resource. */
export function setStorageItem(target: Unit, itemTypeId: number, charges: number): void {
  const existing = findItemByType(target, itemTypeId);
  if (charges <= 0) {
    if (existing != null) RemoveItem(existing.handle);
    return;
  }
  if (existing != null) {
    existing.charges = charges;
  } else {
    addToStack(target, itemTypeId, charges, true);
  }
}

/** Add charges to a unit's stack of an item, starting the stack if it has
 *  none. `inStorageSlot` puts a new stack in the carrier's own slot for that
 *  resource (getStorageSlot); otherwise it goes wherever the engine puts it. */
function addToStack(target: Unit, itemTypeId: number, charges: number, inStorageSlot: boolean): void {
  const existing = findItemByType(target, itemTypeId);
  if (existing != null) {
    existing.charges += charges;
    return;
  }
  const newItem = Item.create(itemTypeId, target.x, target.y);
  if (newItem == null) return;
  newItem.charges = charges;
  UnitAddItem(target.handle, newItem.handle);
  if (inStorageSlot) UnitDropItemSlot(target.handle, newItem.handle, getStorageSlot(target, itemTypeId));
}

/** Move as many charges of `source` as `dest` has room for (its stack cap,
 *  getMaxStack), removing `source` once it is empty. Returns how many moved. */
function moveCharges(source: Item, dest: Unit, inStorageSlot: boolean): number {
  const room = getMaxStack(dest) - chargesOf(dest, source.typeId);
  if (room <= 0) return 0;
  const moved = math.min(source.charges, room);
  addToStack(dest, source.typeId, moved, inStorageSlot);
  source.charges -= moved;
  if (source.charges <= 0) RemoveItem(source.handle);
  return moved;
}

/** Populate the start crate from saved counts and reset them. Called at round start. */
export function loadCrateForRound(): void {
  if (crateStart == null) return;
  setStorageItem(crateStart, TRACK_PIECE_ID, gameState.crateTrackCount);
  setStorageItem(crateStart, WOOD_ID, gameState.crateWoodCount);
  setStorageItem(crateStart, STONE_ID, gameState.crateStoneCount);
  gameState.crateTrackCount = 0;
  gameState.crateWoodCount = 0;
  gameState.crateStoneCount = 0;
}

/** Populate the start crate with max stack to show capacity. Called in inter-round lobby. */
export function loadCrateForInterRoundLobby(): void {
  if (crateStart == null) return;
  setStorageItem(crateStart, TRACK_PIECE_ID, gameState.crateMaxStack);
  setStorageItem(crateStart, WOOD_ID, gameState.crateMaxStack);
  setStorageItem(crateStart, STONE_ID, gameState.crateMaxStack);
}

/** Abilities granted while carrying the matching item type. */
const ITEM_GATED_ABILITIES: ReadonlyArray<readonly [number, number]> = (() => {
  const gated: [number, number][] = [
    [TRACK_PIECE_ID, BUILD_TRACK_ABILITY_ID],
    [WOOD_ID, BRIDGE_ABILITY_ID],
    [BUCKET_ID, FILL_ABILITY_ID],
    [BUCKET_FULL_ID, WATER_TRAIN_ABILITY_ID],
  ];
  for (const f of ABILITY_ITEM_FAMILIES) {
    if (f.spell != null) gated.push([f.plain, f.spell]);
    if (f.greaterSpell != null) gated.push([f.greater, f.greaterSpell]);
  }
  return gated;
})();

/** Grant or revoke item-gated abilities (build track, bridge, fill, water
 *  train, and the ability items' spells). An ability two items grant is kept while either is held. */
export function updateBuildAbility(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  const granted = new Set<number>();
  for (const [itemId, abilityId] of ITEM_GATED_ABILITIES) {
    if (findItemByType(u, itemId) != null) granted.add(abilityId);
  }
  for (const [, abilityId] of ITEM_GATED_ABILITIES) {
    if (granted.has(abilityId)) {
      UnitAddAbility(u.handle, abilityId);
    } else {
      UnitRemoveAbility(u.handle, abilityId);
    }
  }
}

/** Which of an ability item family's two a unit holds: 2 for the Greater
 *  version, 1 for the plain one, 0 for neither. `plain` names the family. */
export function abilityItemTier(u: Unit, plain: number): number {
  for (const f of ABILITY_ITEM_FAMILIES) {
    if (f.plain !== plain) continue;
    if (findItemByType(u, f.greater) != null) return 2;
    if (findItemByType(u, f.plain) != null) return 1;
  }
  return 0;
}

/** Extra a peasant carries per stack for the Muscle Milk™ it holds. */
function carryBonus(u: Unit): number {
  return abilityItemTier(u, MUSCLE_MILK_ID);
}

/** A peasant carrying more than it now may -- its Muscle Milk™ just left --
 *  drops the excess at its feet. */
function dropExcessStack(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  const maxStack = getMaxStack(u);
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = u.getItemInSlot(slot);
    if (it == null || !isResourceItem(it.typeId)) continue;
    splitExcess(it, maxStack, u.x, u.y);
  }
}

/** Cut a stack down to `cap`, the rest becoming a new item on the ground at
 *  (x, y). Returns that item, or null if the stack already fit. */
function splitExcess(it: Item, cap: number, x: number, y: number): item | null {
  if (it.charges <= cap) return null;
  const rest = CreateItem(it.typeId, x, y);
  if (rest != null) SetItemCharges(rest, it.charges - cap);
  it.charges = cap;
  return rest ?? null;
}

/** An inventory changed: refresh what the unit can build AND what it looks like
 *  carrying.
 *
 *  The two always belong together -- the contents decide the ability, slot 0
 *  decides the visual -- and every caller wanted both. Calling only one is how a
 *  peasant ends up still shouldering a log it has already spent, which is
 *  exactly what building a bridge with your last wood used to do. */
export function refreshCarrier(u: Unit): void {
  dropExcessStack(u);
  updateBuildAbility(u);
  updateCarryingVisual(u);
}

/** The same refresh, one frame later, addressed by handle.
 *
 *  Spells have to defer it: revoking an ability inside its own SPELL_EFFECT
 *  cancels the cast that is running. The unit is re-resolved on the way in
 *  because it can be gone by then. */
export function refreshCarrierNextFrame(handle: unit): void {
  nextFrame(() => {
    const u = Unit.fromHandle(handle);
    if (u != null) refreshCarrier(u);
  });
}

/**
 * Where each resource sits on a storage unit, 0-indexed.
 *
 * Per CARRIER, not one layout for all of them: the order is simply the order
 * that carrier's resources are listed in, so nothing reserves a slot for
 * something the carrier cannot hold. The engine took wood and stone at 1 and 2
 * -- reading as the second and third slots -- because slot 0 was being kept for
 * track pieces it is not allowed to carry.
 */
function storageOrder(carrier: Unit): number[] {
  if (isTrain(carrier)) return [WOOD_ID, STONE_ID];
  if (isTrackWagon(carrier)) return [TRACK_PIECE_ID];
  // The crate takes all three, and keeps tracks first.
  return [TRACK_PIECE_ID, WOOD_ID, STONE_ID];
}

function getStorageSlot(carrier: Unit, itemTypeId: number): number {
  const order = storageOrder(carrier);
  for (let i = 0; i < order.length; i++) {
    if (order[i] === itemTypeId) return i;
  }
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

/** How many of one item a unit can stack. A carrier has one stack size for
 *  everything it is allowed to hold (itemRules.canHold). */
export function getMaxStack(u: Unit): number {
  if (isTrain(u)) return gameState.trainCargoMaxStack;
  if (isTrackWagon(u)) return gameState.trainTrackMaxStack;
  if (u.typeId === CRATE_ID) return gameState.crateMaxStack;
  return gameState.peasantMaxStack + carryBonus(u);
}

/** How many of an item a unit carries: its stack's charges, 0 if it has none. */
export function chargesOf(u: Unit, itemTypeId: number): number {
  return findItemByType(u, itemTypeId)?.charges ?? 0;
}

/** Use up one charge of a carried item, removing it at zero. Returns false if
 *  the unit carries none. */
export function spendCharge(u: Unit, itemTypeId: number): boolean {
  const it = findItemByType(u, itemTypeId);
  if (it == null) return false;
  it.charges -= 1;
  if (it.charges <= 0) RemoveItem(it.handle);
  return true;
}

/** Exchange a carried item for another -- the bucket filling and emptying.
 *  Returns false if the unit is not carrying `from`.
 *
 *  The carrier refresh is deferred: these swaps happen inside a spell's own
 *  effect, and revoking the ability that is being cast cancels it. */
export function swapCarriedItem(u: Unit, from: number, to: number): boolean {
  const old = findItemByType(u, from);
  if (old == null) return false;
  RemoveItem(old.handle);
  giveItems(u.handle, [to]);
  refreshCarrierNextFrame(u.handle);
  return true;
}

/** Get the item in slot 0 (first inventory slot) for a unit. */
export function getSlot0Item(u: Unit): Item | null {
  return u.getItemInSlot(0) ?? null;
}

/** Find an item of the given type in a unit's inventory. */
export function findItemByType(u: Unit, itemTypeId: number): Item | null {
  const it = findInventoryItem(u.handle, id => id === itemTypeId);
  return it != null ? Item.fromHandle(it) ?? null : null;
}

/** Find the item a unit is carrying -- anything but a peasant ability item,
 *  which rides in its own slot and never counts against the one-item rule. */
function findAnyItem(u: Unit): Item | null {
  const it = findInventoryItem(u.handle, id => !isPeasantAbilityItem(id));
  return it != null ? Item.fromHandle(it) ?? null : null;
}

/**
 * Check whether a target unit can accept an item.
 * Returns an error message string if rejected, or null if accepted.
 */
export function validateGive(itemTypeId: number, target: Unit): string | null {
  // Same holding rules as a pickup -- see itemRules.canHold.
  const forbidden = canHold(target, itemTypeId);
  if (forbidden != null) return forbidden;

  const refused = refuseHandOff(target);
  if (refused != null) return refused;

  const matching = findItemByType(target, itemTypeId);
  if (matching != null) {
    if (matching.charges >= getMaxStack(target)) {
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

/** Transfer POLICY, not a holding rule: a target that can hold the item
 *  perfectly well but may not be HANDED one by a player. Asked by both ways a
 *  player hands something over -- the give spell and a right-click give. */
function refuseHandOff(target: Unit): string | null {
  // The track wagon is filled by the engine's production; players only take.
  if (isTrackWagon(target)) return "Can't load the wagon!";
  return null;
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
    if (heldItem.charges >= getMaxStack(taker)) {
      return 'Inventory full!';
    }
    return null;
  }

  // An empty-handed take: storage just has to have something
  const takeType = chooseTakeType(storage);
  if (takeType === 0) {
    return 'Nothing to take!';
  }

  return null;
}

/**
 * Transfer a carried item into storage, respecting stack caps.
 * Moves as many charges as possible; removes the giver's item if fully transferred.
 */
export function giveToStorage(giverItem: Item, storage: Unit): boolean {
  if (moveCharges(giverItem, storage, true) === 0) return false;
  notifyStorageChanged(storage);
  return true;
}

/** Fire inventory-change side effects after a storage unit's contents change. */
function notifyStorageChanged(storage: Unit): void {
  if ((isTrain(storage) || isTrackWagon(storage)) && onTrainInventoryChanged != null) {
    onTrainInventoryChanged();
  }
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
  // Not into a storage slot: the taker's pickup handling places what it gets.
  if (moveCharges(source, taker, false) === 0) return false;
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
        if (dropper != null) refreshCarrier(dropper);
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
    const pickedIsResource = isResourceItem(pickedType);
    const dropper = pendingGivers.get(picked.handle) ?? null;
    pendingGivers.delete(picked.handle);
    // The unit that gave us this item, if it came from another unit
    const giver = dropper != null && dropper !== unit.handle ? dropper : null;

    // Remove the picked item; return it to the giver (with an optional message)
    // if one exists. With no giver the item simply drops back on the ground --
    // show the reason over the unit that tried, or a refused pickup looks like
    // the click did nothing.
    const rejectPickup = (msg?: string): void => {
      unit.removeItem(picked);
      if (giver != null) {
        UnitAddItem(giver, picked.handle);
        if (msg != null) showFloatingText(giver, msg);
      } else if (msg != null) {
        showFloatingText(unit.handle, msg);
      }
    };

    // WHO CAN HOLD WHAT: one shared check (itemRules.canHold) covers picking an
    // item up off the ground AND being handed one by right-click, since both
    // arrive here as a pickup. The give/take spell asks the same function via
    // validateGive, so the rules exist in exactly one place.
    const forbidden = canHold(unit, pickedType);
    if (forbidden != null) {
      rejectPickup(forbidden);
      return;
    }

    // A purchase arrives here like any pickup at the buyer's feet. An upgrade is
    // used up the moment it is acquired (shop.ts), so like a powerup it never
    // displaces what the buyer is holding -- buying one used to drop the axe.
    if (isShopUpgrade(pickedType)) return;

    if (giver != null) {
      const refused = refuseHandOff(unit);
      if (refused != null) {
        rejectPickup(refused);
        return;
      }
    }

    // A peasant ability item lives in the last slot, one at a time, by the
    // same rule as the carried item: picking one up swaps out the one held,
    // being handed one while holding one is refused. The carried item is
    // untouched either way.
    if (isPeasantAbilityItem(pickedType)) {
      let held: Item | undefined;
      for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
        const it = unit.getItemInSlot(slot);
        if (it != null && it.handle !== picked.handle && isPeasantAbilityItem(it.typeId)) held = it;
      }
      if (held != null) {
        if (giver != null) {
          rejectPickup("Can't mix items!");
          return;
        }
        unit.removeItem(held);
      }
      UnitDropItemSlot(unit.handle, picked.handle, ABILITY_SLOT);
      refreshCarrier(unit);
      return;
    }

    // Scan inventory for existing items (excluding the one just picked up, and
    // any ability item, which keeps its own slot)
    let otherItem: Item | undefined;
    let matchingResource: Item | undefined;
    for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
      const it = unit.getItemInSlot(slot);
      if (it == null || it.handle === picked.handle || isPeasantAbilityItem(it.typeId)) continue;
      if (pickedIsResource && it.typeId === pickedType) {
        matchingResource = it;
      } else {
        otherItem = it;
      }
    }

    if (matchingResource != null) {
      // Same resource type — merge charges up to max stack
      const maxStack = getMaxStack(unit);
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
      // A storage's own limit holds however big the stack handed over: a
      // peasant with Muscle Milk™ carries more than some storage takes. The
      // rest goes back to the giver.
      const back = splitExcess(picked, getMaxStack(unit), unit.x, unit.y);
      if (back != null && giver != null) UnitAddItem(giver, back);
      // Move to the correct fixed slot for this resource type
      UnitDropItemSlot(unit.handle, picked.handle, getStorageSlot(unit, pickedType));
    }

    // A pile off the ground (Vacuum Resources makes them) can hold more than a
    // peasant carries: take a full stack and leave the rest where it lay.
    if (unit.typeId === PEASANT_ID && pickedIsResource && UnitHasItem(unit.handle, picked.handle)) {
      splitExcess(picked, getMaxStack(unit), unit.x, unit.y);
    }

    // Update train production when the engine's or track wagon's inventory changes
    notifyStorageChanged(unit);

    refreshCarrier(unit);
  });

  // A peasant's slots mean something: slot 0 holds the one carried item (what
  // Give/Take hands over and what the peasant is seen carrying), and the last
  // slot holds an ability item. Dragging an item between slots can't be
  // refused, but the game announces it -- the drag is a target order on the
  // item, 852002 + destination slot -- and the move lands right after this
  // handler. So a frame later the inventory is checked against that layout and
  // anything out of place is put back. Putting it back is itself a drag, which
  // brings us here again; by then the layout is valid and the check does
  // nothing. Right-click give and drop are other orders and are left alone.
  const moveTrigger = Trigger.create();
  moveTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  moveTrigger.addAction(() => {
    const order = GetIssuedOrderId();
    if (order < MOVE_SLOT_ORDER_FIRST || order >= MOVE_SLOT_ORDER_FIRST + INVENTORY_SLOTS) return;
    const unitHandle = GetTriggerUnit();
    if (unitHandle == null || GetUnitTypeId(unitHandle) !== PEASANT_ID) return;
    nextFrame(() => arrangePeasantSlots(unitHandle));
  });
}

/** Order id of "move the target item to slot 0"; slots 1-5 follow it. */
const MOVE_SLOT_ORDER_FIRST = 852002;
const CARRIED_SLOT = 0;
const ABILITY_SLOT = INVENTORY_SLOTS - 1;

function homeSlot(itemTypeId: number): number {
  return isPeasantAbilityItem(itemTypeId) ? ABILITY_SLOT : CARRIED_SLOT;
}

/** Move every item that is out of place into its home slot. Each home holds
 *  one item, so one that finds its home already taken by something that
 *  belongs there is dropped at the peasant's feet -- a stone and a log never
 *  share an inventory, whichever of them got there first keeps the slot. */
function arrangePeasantSlots(u: unit): void {
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = UnitItemInSlot(u, slot);
    if (it == null) continue;
    const home = homeSlot(GetItemTypeId(it));
    if (slot === home) continue;
    const occupant = UnitItemInSlot(u, home);
    if (occupant != null && homeSlot(GetItemTypeId(occupant)) === home) {
      UnitRemoveItem(u, it);
    } else {
      UnitDropItemSlot(u, it, home);
    }
  }
}