import { Destructable, Item, Timer, Trigger, Unit } from 'w3ts';
import { TREE_RAW, ROCK_RAW } from './terrain/constants';
import { AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID, unitHasItemType, rejectOrder } from './items';


const TREE_DEST_ID = FourCC(TREE_RAW);
const ROCK_DEST_ID = FourCC(ROCK_RAW);

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
 * - No tool → stop + show "Requires X!"
 * - Has tool → redirect to attack order on the destructable
 */
function handleResourceOrder(unit: Unit, dest: destructable): void {
  const destTypeId = GetDestructableTypeId(dest);
  const tool = requiredToolForDest(destTypeId);
  if (tool === 0) return;

  const unitHandle = unit.handle;

  if (!unitHasItemType(unit, tool)) {
    rejectOrder(unitHandle, 'Requires ' + toolName(tool) + '!');
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

}
