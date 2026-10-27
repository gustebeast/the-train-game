import { MapPlayer, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID } from './constants';

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
  GroupEnumUnitsInRect(g, getWorldBounds(), undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null) cb(u);
  });
  DestroyGroup(g);
}

/** Run cb for every unit within `radius` of (x, y). */
export function forEachUnitInRange(x: number, y: number, radius: number, cb: (this: void, u: unit) => void): void {
  const g = CreateGroup()!;
  GroupEnumUnitsInRange(g, x, y, radius, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null) cb(u);
  });
  DestroyGroup(g);
}

/** The unit within `radius` of (x, y) nearest to it that passes `matches`, or
 *  null if none does. */
export function nearestUnitInRange(
  x: number, y: number, radius: number, matches: (this: void, u: unit) => boolean,
): unit | null {
  let nearest: unit | null = null;
  let bestDist = math.huge;
  forEachUnitInRange(x, y, radius, u => {
    if (!matches(u)) return;
    const dx = GetUnitX(u) - x;
    const dy = GetUnitY(u) - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      nearest = u;
    }
  });
  return nearest;
}

/** Run cb for every unit a player owns.
 *
 *  The group is created, enumerated and destroyed here, and cb only ever sees a
 *  live handle. Ten call sites were repeating that dance, and disagreeing about
 *  it: some passed the filter as `undefined` and some as `null!`, and each one
 *  had to remember DestroyGroup. */
export function forEachUnitOfPlayer(owner: player, cb: (this: void, u: unit) => void): void {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, owner, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null) cb(u);
  });
  DestroyGroup(g);
}

/** Remove units, summons first.
 *
 *  A summon survives RemoveUnit once whatever summoned it has been removed:
 *  measured, a Far Seer's Feral Spirit wolves swept in the same pass as the
 *  Far Seer stayed on the map, while the same wolves removed with the Far Seer
 *  still standing went. So every summon goes before anything that could have
 *  summoned it. */
export function removeUnitsSummonsFirst(units: ReadonlyArray<unit>): void {
  for (const u of units) {
    if (IsUnitType(u, UNIT_TYPE_SUMMONED)) RemoveUnit(u);
  }
  for (const u of units) {
    if (!IsUnitType(u, UNIT_TYPE_SUMMONED) && unitExists(u)) RemoveUnit(u);
  }
}

/** Whether a unit handle still refers to a unit on the map -- it has not been
 *  removed. A dead unit still exists until its corpse is gone. */
export function unitExists(u: unit): boolean {
  return GetUnitTypeId(u) !== 0;
}

/** Whether a unit exists and is alive. Every death signal counts -- the dead
 *  classification and a life at or below the engine's 0.405 floor -- since
 *  each was relied on somewhere, and inside a death event they do not all
 *  flip at the same moment. */
export function isAlive(u: unit): boolean {
  return GetUnitTypeId(u) !== 0 && !IsUnitType(u, UNIT_TYPE_DEAD) && GetWidgetLife(u) > 0.405;
}

/** Run cb for every peasant on the map, whoever owns it. */
export function forEachPeasant(cb: (this: void, u: Unit) => void): void {
  forEachUnitInWorld(handle => {
    if (GetUnitTypeId(handle) === PEASANT_ID) cb(Unit.fromHandle(handle)!);
  });
}

/** Run cb for every peasant a player owns. */
export function forEachPeasantOf(owner: player, cb: (this: void, u: Unit) => void): void {
  forEachUnitOfPlayer(owner, handle => {
    if (GetUnitTypeId(handle) === PEASANT_ID) cb(Unit.fromHandle(handle)!);
  });
}

/** A player's peasant -- each has one outside hero mode -- or null. */
export function firstPeasantOf(owner: player): Unit | null {
  let found: Unit | null = null;
  forEachPeasantOf(owner, u => {
    if (found == null) found = u;
  });
  return found;
}

/** Run cb with the caster whenever any unit's `abilityId` takes effect. */
export function onSpellEffect(abilityId: number, cb: (this: void, caster: Unit) => void): void {
  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  trigger.addAction(() => {
    if (GetSpellAbilityId() !== abilityId) return;
    const caster = Unit.fromEvent();
    if (caster != null) cb(caster);
  });
}

/** Register a chat command (exact match, any player) with its action. */
export function onChatCommand(command: string, action: () => void): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, command, true);
  });
  trigger.addAction(action);
}

/** Register a chat command that takes an argument, e.g. "-challenge 4".
 *
 *  WC3's non-exact chat event matches a SUBSTRING, not a prefix, so "-challenge"
 *  would also fire on someone typing "look at -challenge 4" mid-sentence. The
 *  guard below insists the message actually starts with the command, which is
 *  also what keeps the argument at a known offset. */
export function onChatCommandWithArg(command: string, action: (arg: string) => void): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, command, false);
  });
  trigger.addAction(() => {
    const said = GetEventPlayerChatString();
    if (said == null) return;
    if (string.sub(said, 1, string.len(command)) !== command) return;
    const [rest] = string.gsub(string.sub(said, string.len(command) + 1), '^%s+', '');
    action(rest);
  });
}

/** WC3 inventories are six slots wide. */
export const INVENTORY_SLOTS = 6;

/** Run cb for every item a unit is carrying, skipping empty slots. */
export function forEachInventoryItem(handle: unit, cb: (this: void, it: item) => void): void {
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = UnitItemInSlot(handle, slot);
    if (it != null) cb(it);
  }
}

/** The first item in a unit's inventory, in slot order, whose type passes
 *  `matches`, or null. */
export function findInventoryItem(handle: unit, matches: (this: void, itemTypeId: number) => boolean): item | null {
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = UnitItemInSlot(handle, slot);
    if (it != null && matches(GetItemTypeId(it))) return it;
  }
  return null;
}

/** Give a unit one of each item id, created at its feet, with their default
 *  charges. A remembered kit, charges and all, goes through giveKit. */
export function giveItems(target: unit, itemIds: ReadonlyArray<number>): void {
  giveKit(target, itemIds.map(id => ({ id, charges: 0 })));
}

/** One carried item as it is remembered between spawns: its type, and its
 *  charges -- 0 for an item that has none. Without the charges a potion used
 *  down to its last dose came back full on every respawn and every reload. */
export interface KitItem { id: number; charges: number; }

/** What a unit is carrying, in slot order. Used to snapshot an inventory for
 *  the save file and to carry it across a respawn. */
export function getInventoryKit(handle: unit): KitItem[] {
  const kit: KitItem[] = [];
  forEachInventoryItem(handle, it => {
    const id = GetItemTypeId(it);
    if (id !== 0) kit.push({ id, charges: GetItemCharges(it) });
  });
  return kit;
}

/** Hand a unit a remembered kit, charges and all. */
export function giveKit(target: unit, kit: ReadonlyArray<KitItem>): void {
  for (const entry of kit) {
    const it = CreateItem(entry.id, GetUnitX(target), GetUnitY(target));
    if (it == null) continue;
    if (entry.charges > 0) SetItemCharges(it, entry.charges);
    UnitAddItem(target, it);
  }
}
