import { Destructable, Item, Trigger, Unit } from 'w3ts';
import { TREE_RAW, ROCK_RAW, GRANITE_RAW } from './terrain/constants';
import { AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID, unitHasItemType, rejectOrder } from './items';


const TREE_DEST_ID = FourCC(TREE_RAW);
const ROCK_DEST_ID = FourCC(ROCK_RAW);
const GRANITE_DEST_ID = FourCC(GRANITE_RAW);

// Death triggers for resource drops (initialized by initHarvest, must be called before spawnTerrain)
let treeDeath!: Trigger;
let rockDeath!: Trigger;
let resourceDropsPaused = false;

export function pauseResourceDrops(): void { resourceDropsPaused = true; }
export function resumeResourceDrops(): void { resourceDropsPaused = false; }

function dropResource(itemId: number): void {
  if (resourceDropsPaused) return;
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

function isResourceDest(destTypeId: number): boolean {
  return destTypeId === TREE_DEST_ID || destTypeId === ROCK_DEST_ID;
}

/**
 * Unified handler for any order targeting a resource destructable.
 * - Granite → stop + show "Granite cannot be destroyed!"
 * - No tool → stop + show "Requires X!"
 * - Has tool → allow native attack order to proceed
 */
function handleResourceOrder(unit: Unit, dest: destructable): void {
  const destTypeId = GetDestructableTypeId(dest);

  if (destTypeId === GRANITE_DEST_ID) {
    rejectOrder(unit.handle, 'Granite cannot be destroyed!');
    return;
  }

  const tool = requiredToolForDest(destTypeId);
  if (tool === 0) return;

  if (!unitHasItemType(unit, tool)) {
    rejectOrder(unit.handle, 'Requires ' + toolName(tool) + '!');
    return;
  }

  // Has tool — let the native attack order proceed
}

/** Find a resource destructable near coordinates. */
function findResourceDestAt(x: number, y: number): destructable | null {
  let found: destructable | null = null;
  const r = Rect(x - 64, y - 64, x + 64, y + 64);
  EnumDestructablesInRect(r, undefined, () => {
    const d = GetEnumDestructable();
    if (d != null && GetDestructableLife(d) > 0) {
      const dt = GetDestructableTypeId(d);
      if (isResourceDest(dt) || dt === GRANITE_DEST_ID) {
        found = d;
      }
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
    const destTypeId = GetDestructableTypeId(dest);
    if (!isResourceDest(destTypeId) && destTypeId !== GRANITE_DEST_ID) return;

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

}
