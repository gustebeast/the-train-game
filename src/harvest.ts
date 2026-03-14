import { Destructable, Item, Timer, Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { TREE_RAW, ROCK_RAW } from './terrain/constants';
import { log } from './debug';

const TREE_DEST_ID = FourCC(TREE_RAW);
const ROCK_DEST_ID = FourCC(ROCK_RAW);
const AXE_ID = FourCC(Items.SturdyWarAxe);
const PICKAXE_ID = FourCC(Items.RustyMiningPick);
const WOOD_ID = FourCC(Items.IronwoodBranch);
const STONE_ID = FourCC(Items.GemFragment);
const MAX_STACK = 3;

// Death triggers for resource drops (initialized by initHarvest, must be called before spawnTerrain)
let treeDeath!: Trigger;
let rockDeath!: Trigger;

function dropResource(itemId: number): void {
  const w = GetTriggerWidget();
  if (w == null) return;
  const x = GetWidgetX(w);
  const y = GetWidgetY(w);
  Item.create(itemId, x, y);
}

/** Register a resource destructable so it drops an item on death. */
export function registerResourceDest(dest: Destructable): void {
  if (dest.typeId === TREE_DEST_ID) {
    treeDeath.registerDeathEvent(dest);
  } else if (dest.typeId === ROCK_DEST_ID) {
    rockDeath.registerDeathEvent(dest);
  }
}

/** Check whether a unit is carrying an item of the given type. */
function unitHasItemType(u: Unit, itemTypeId: number): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const it = u.getItemInSlot(slot);
    if (it != null && it.typeId === itemTypeId) return true;
  }
  return false;
}

/** Returns the required tool for a destructable type, or 0 if none needed. */
function requiredToolForDest(destTypeId: number): number {
  if (destTypeId === TREE_DEST_ID) return AXE_ID;
  if (destTypeId === ROCK_DEST_ID) return PICKAXE_ID;
  return 0;
}

function toolName(itemTypeId: number): string {
  if (itemTypeId === AXE_ID) return 'Axe';
  if (itemTypeId === PICKAXE_ID) return 'Pickaxe';
  return '';
}

function showRequiresText(unitHandle: unit, name: string): void {
  const tt = CreateTextTag();
  if (tt != null) {
    SetTextTagText(tt, 'Requires ' + name + '!', 0.024);
    SetTextTagPosUnit(tt, unitHandle, 0);
    SetTextTagColor(tt, 255, 200, 200, 255);
    SetTextTagVelocity(tt, 0, 0.03);
    SetTextTagPermanent(tt, false);
    SetTextTagLifespan(tt, 2.0);
    SetTextTagFadepoint(tt, 1.5);
  }
}

function isResourceDest(destTypeId: number): boolean {
  return destTypeId === TREE_DEST_ID || destTypeId === ROCK_DEST_ID;
}

function isResource(itemTypeId: number): boolean {
  return itemTypeId === WOOD_ID || itemTypeId === STONE_ID;
}

/**
 * Unified handler for any order targeting a resource destructable.
 * - No tool → stop + show "Requires X!"
 * - Has tool → redirect to attack order on the destructable
 */
function handleResourceOrder(unit: Unit, dest: destructable): void {
  const destTypeId = GetDestructableTypeId(dest);
  const tool = requiredToolForDest(destTypeId);
  if (tool === 0) return;

  const unitHandle = unit.handle;

  if (!unitHasItemType(unit, tool)) {
    const t = Timer.create();
    t.start(0, false, () => {
      IssueImmediateOrder(unitHandle, 'stop');
      t.destroy();
    });
    showRequiresText(unitHandle, toolName(tool));
    return;
  }

  // Has tool — always redirect to attack (handles harvest/smart/etc uniformly)
  const t = Timer.create();
  t.start(0, false, () => {
    IssueTargetDestructableOrder(unitHandle, 'attack', dest);
    t.destroy();
  });
}

/** Find a resource destructable near coordinates. */
function findResourceDestAt(x: number, y: number): destructable | null {
  let found: destructable | null = null;
  const r = Rect(x - 64, y - 64, x + 64, y + 64);
  EnumDestructablesInRect(r, undefined, () => {
    const d = GetEnumDestructable();
    if (d != null && GetDestructableLife(d) > 0 && isResourceDest(GetDestructableTypeId(d))) {
      found = d;
    }
  });
  RemoveRect(r);
  return found;
}

export function initHarvest(): void {
  // --- Resource drop triggers (must be initialized before spawnTerrain) ---
  treeDeath = Trigger.create();
  treeDeath.addAction(() => dropResource(WOOD_ID));
  rockDeath = Trigger.create();
  rockDeath.addAction(() => dropResource(STONE_ID));

  // --- Intercept target orders on resource destructables (in view) ---
  const destTargetTrigger = Trigger.create();
  destTargetTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  destTargetTrigger.addAction(() => {
    const dest = GetOrderTargetDestructable();
    if (dest == null) return;
    if (!isResourceDest(GetDestructableTypeId(dest))) return;

    const unit = Unit.fromEvent();
    if (unit == null) return;
    handleResourceOrder(unit, dest);
  });

  // --- Intercept point orders near resource destructables (out of fog) ---
  const destPointTrigger = Trigger.create();
  destPointTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  destPointTrigger.addAction(() => {
    const x = GetOrderPointX();
    const y = GetOrderPointY();
    const unit = Unit.fromEvent();
    if (unit == null) return;

    const dest = findResourceDestAt(x, y);
    if (dest == null) return;
    handleResourceOrder(unit, dest);
  });

  // --- Item pickup: enforce one item, stack matching resources ---
  const pickupTrigger = Trigger.create();
  pickupTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickupTrigger.addAction(() => {
    const unit = Unit.fromEvent();
    const picked = Item.fromEvent();
    if (unit == null || picked == null) return;

    const pickedType = picked.typeId;
    const pickedIsResource = isResource(pickedType);

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
      // Same resource type — merge charges up to MAX_STACK
      const total = matchingResource.charges + picked.charges;
      const kept = math.min(total, MAX_STACK);
      const remainder = total - kept;

      matchingResource.charges = kept;
      if (remainder > 0) {
        // Drop leftover as a new stack at the unit's feet
        picked.charges = remainder;
        unit.removeItem(picked);
      } else {
        RemoveItem(picked.handle);
      }
    } else if (otherItem != null) {
      // Different item — drop the old one
      unit.removeItem(otherItem);
    }
  });

  log('Harvest system initialized');
}
