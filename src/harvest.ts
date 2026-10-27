import { Destructable, Item, Trigger, Unit } from 'w3ts';
import { BIOMES, } from './terrain/constants';
import { ROCK_RAW, GRANITE_RAW } from './sharedData';
import { findItemByType, rejectOrder } from './items';
import { AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID } from './constants';
import { noteChoppedTree, noteMinedStone } from './tutorialBoard';

/** Every biome's tree: they differ only in look. */
const TREE_DEST_IDS = new Set<number>();
for (const art of Object.values(BIOMES)) TREE_DEST_IDS.add(FourCC(art.tree));
const ROCK_DEST_ID = FourCC(ROCK_RAW);
const GRANITE_DEST_ID = FourCC(GRANITE_RAW);

// Death triggers for resource drops (initialized by initHarvest, must be called before spawnTerrain)
let treeDeath!: Trigger;
let rockDeath!: Trigger;
let resourceDropsPaused = false;

export function pauseResourceDrops(): void { resourceDropsPaused = true; }
export function resumeResourceDrops(): void { resourceDropsPaused = false; }

/** Who last ordered work on a resource, by destructable handle.
 *
 *  A destructable's death event does not say who killed it, so credit for
 *  chopping and mining comes from the order that started the job -- which this
 *  file already intercepts. Only read by the tutorial board. */
const lastHarvester = new Map<number, number>();

function dropResource(itemId: number): void {
  if (resourceDropsPaused) return;
  const w = GetTriggerWidget();
  if (w == null) return;
  const x = GetWidgetX(w);
  const y = GetWidgetY(w);
  Item.create(itemId, x, y);
  const playerId = lastHarvester.get(GetHandleId(w));
  if (playerId == null) return;
  lastHarvester.delete(GetHandleId(w));
  if (itemId === WOOD_ID) noteChoppedTree(playerId);
  else if (itemId === STONE_ID) noteMinedStone(playerId);
}

/** Register a resource destructable so it drops an item on death. */
export function registerResourceDest(dest: Destructable): void {
  if (TREE_DEST_IDS.has(dest.typeId)) {
    treeDeath.registerDeathEvent(dest);
  } else if (dest.typeId === ROCK_DEST_ID) {
    rockDeath.registerDeathEvent(dest);
  }
}

/** Returns the required tool for a destructable type, or 0 if none needed. */
function requiredToolForDest(destTypeId: number): number {
  if (TREE_DEST_IDS.has(destTypeId)) return AXE_ID;
  if (destTypeId === ROCK_DEST_ID) return PICKAXE_ID;
  return 0;
}

function isResourceDest(destTypeId: number): boolean {
  return TREE_DEST_IDS.has(destTypeId) || destTypeId === ROCK_DEST_ID;
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

  if (findItemByType(unit, tool) == null) {
    rejectOrder(unit.handle, 'Requires ' + (GetObjectName(tool) ?? 'a tool') + '!');
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
  // --- Resource drop triggers (must be initialized before spawnTerrain) ------
  treeDeath = Trigger.create();
  treeDeath.addAction(() => dropResource(WOOD_ID));
  rockDeath = Trigger.create();
  rockDeath.addAction(() => dropResource(STONE_ID));

  // --- Intercept target orders on resource destructables (in view) -----------
  const destTargetTrigger = Trigger.create();
  destTargetTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  destTargetTrigger.addAction(() => {
    const dest = GetOrderTargetDestructable();
    if (dest == null) return;
    const destTypeId = GetDestructableTypeId(dest);
    if (!isResourceDest(destTypeId) && destTypeId !== GRANITE_DEST_ID) return;

    const unit = Unit.fromEvent();
    if (unit == null) return;
    lastHarvester.set(GetHandleId(dest), unit.owner.id);
    handleResourceOrder(unit, dest);
  });

  // --- Intercept point orders near resource destructables (out of fog) -------
  //
  // A right-click on a tree under fog arrives as a POINT order at the tree, not
  // a target order. Only right-click (smart) and attack-move mean "work this":
  // a plain move that happens to end beside a tree is just walking, and
  // stopping it with "Requires Axe!" froze heroes and peasants alike.
  const destPointTrigger = Trigger.create();
  destPointTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  destPointTrigger.addAction(() => {
    const order = GetIssuedOrderId();
    if (order !== OrderId('smart') && order !== OrderId('attack')) return;
    const x = GetOrderPointX();
    const y = GetOrderPointY();
    const unit = Unit.fromEvent();
    if (unit == null) return;

    const dest = findResourceDestAt(x, y);
    if (dest == null) return;

    handleResourceOrder(unit, dest);
  });
}
