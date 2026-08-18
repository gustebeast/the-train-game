import { MapPlayer, Timer } from 'w3ts';
import { Players } from 'w3ts/globals';

/** Get all human players currently in the game (playing + user-controlled). */
export function getHumanPlayers(): MapPlayer[] {
  return Players.filter(
    (p: MapPlayer) => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );
}

/** Run a callback on the next frame (one-shot 0-second timer). */
export function nextFrame(cb: () => void): void {
  const t = Timer.create();
  t.start(0, false, () => {
    t.destroy();
    cb();
  });
}

// GetWorldBounds() allocates a new rect on every call and never frees it,
// so cache a single instance for all world-wide enumerations.
let worldBounds: rect | null = null;

/** Get the cached world-bounds rect. */
export function getWorldBounds(): rect {
  if (worldBounds == null) worldBounds = GetWorldBounds()!;
  return worldBounds;
}

/** Enumerate all units on the map. */
export function forEachUnitInWorld(cb: (u: unit) => void): void {
  const g = CreateGroup()!;
  GroupEnumUnitsInRect(g, getWorldBounds(), null!);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null) cb(u);
  });
  DestroyGroup(g);
}

/** WC3 inventories are six slots wide. */
const INVENTORY_SLOTS = 6;

/** Run cb for every item a unit is carrying, skipping empty slots. */
export function forEachInventoryItem(handle: unit, cb: (this: void, it: item) => void): void {
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = UnitItemInSlot(handle, slot);
    if (it != null) cb(it);
  }
}

/** Item type ids a unit is carrying, in slot order. Used to snapshot an
 *  inventory for the save file and to carry items across a respawn. */
export function getInventoryItemIds(handle: unit): number[] {
  const ids: number[] = [];
  forEachInventoryItem(handle, it => {
    const id = GetItemTypeId(it);
    if (id !== 0) ids.push(id);
  });
  return ids;
}
