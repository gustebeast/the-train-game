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

/** Run cb for every peasant a player owns. */
export function forEachPeasantOf(owner: player, cb: (this: void, u: Unit) => void): void {
  forEachUnitOfPlayer(owner, handle => {
    if (GetUnitTypeId(handle) === PEASANT_ID) cb(Unit.fromHandle(handle)!);
  });
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

/** Give a unit one of each item id, created at its feet.
 *
 *  Four places restored a kit this way -- a hero, a mercenary, a rerolled
 *  mercenary and a concealed placeholder -- and they did not agree on how.
 *  Three tested CreateItem's result; the hero path asserted it with `!`, which
 *  hands UnitAddItem a null the one time the engine declines. */
export function giveItems(u: Unit, itemIds: ReadonlyArray<number>): void {
  for (const id of itemIds) {
    const it = CreateItem(id, u.x, u.y);
    if (it != null) UnitAddItem(u.handle, it);
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
