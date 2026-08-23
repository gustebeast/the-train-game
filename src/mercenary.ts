import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { registerSaveSegment, parseFields } from './save';
import { getHumanPlayers, getInventoryItemIds, forEachInventoryItem } from './util';
import { getNeutralPassive } from './teams';
import { markRandomOutcomeTaken } from './randomOutcome';
import { seededInt } from './rng';
import { CREEP_CAMPS } from './creep_camps';

/** Hero-style inventory (the same ability the peasant carries tools with). It
 *  is BAKED onto every merc-able creep type in object data (see compiletime.ts):
 *  WC3 only creates working inventory slots for an inventory ability the unit
 *  has at creation time, so adding one at runtime yields 0 slots. This runtime
 *  add is therefore a harmless no-op backstop.
 *
 *  This is STOCK AInv, which drops its items on death — no object-data change
 *  suppresses that (an Aihn block that claimed to was dead config; see
 *  compiletime.ts). The death trigger's strip is therefore the only thing
 *  keeping a dead merc's items off the ground, and it depends on running before
 *  the engine's drop. */
const MERC_INVENTORY_ABILITY_ID = FourCC(Abilities.InventoryHero);

/** Must match the tileset used by rollCreepCamp in creeps.ts. */
const MERC_TILESET = 'Lordaeron Summer';

// ---------------------------------------------------------------------------
// Persistent state (saved via the 'mm' segment)
// ---------------------------------------------------------------------------

/**
 * Mercenaries live in ORDERED SLOTS, at most two of them.
 *
 * Slot 0 is the one the Mercenary Contract hires and slot 1 the one the Second
 * Contract hires, and each keeps its OWN kit. That ordering is what makes the
 * item rule work: lose both and re-buying the first contract hands back slot
 * 0's gear, while slot 1's waits for the second contract to be bought again.
 *
 * Everything else reads off how many are ALIVE. Camp level is living + 1 (none
 * -> level 1, one -> level 2, both -> level 3), and a contract is on the shelf
 * exactly when the slot below it is empty, so a death both drops the camp level
 * and puts the matching contract back up for sale.
 */
interface MercSlot {
  /** Unit type of this mercenary (0 = never rolled / slot empty). */
  typeId: number;
  /** True once it died; it stays dead until its contract is bought again. */
  dead: boolean;
  /** Item rawcodes this slot's mercenary carries, kept across death. */
  items: number[];
  /** The live unit while summoned, or null. */
  unit: Unit | null;
  /** Death trigger for the live unit, or null (see clearMercDeathTrigger). */
  deathTrig: Trigger | null;
}

const MAX_MERCS = 2;

function emptySlot(): MercSlot {
  return { typeId: 0, dead: false, items: [], unit: null, deathTrig: null };
}

/** Slots in hire order. A slot with typeId 0 was never hired. */
let slots: MercSlot[] = [emptySlot(), emptySlot()];

/** Slots holding a mercenary that is hired and not dead. */
function livingSlots(): MercSlot[] {
  return slots.filter(sl => sl.typeId !== 0 && !sl.dead);
}

/** How many mercenaries are alive right now (0-2). */
export function livingMercCount(): number {
  return livingSlots().length;
}

/** Highest creep camp level unlocked: one per living mercenary, above the
 *  level 1 baseline. Losing a mercenary really does cost you the camps. */
export function mercCampLevel(): number {
  return 1 + livingMercCount();
}

// ---------------------------------------------------------------------------
// Per-fight state
// ---------------------------------------------------------------------------

/** Player ids owning each spawned hero this summon (duplicates = 2 heroes). */
let currentHeroOwnerIds: number[] = [];

/** Destroy a slot's death trigger, if any. Safe to call repeatedly.
 *
 *  A mercenary is usually REMOVED rather than killed -- a reroll removes it and
 *  the round reset sweeps it -- and a removed unit fires no death event, so a
 *  trigger destroyed only in its own action would leak one per spawn. */
function clearMercDeathTrigger(sl: MercSlot): void {
  if (sl.deathTrig == null) return;
  DestroyTrigger(sl.deathTrig.handle);
  sl.deathTrig = null;
}

// ---------------------------------------------------------------------------
// Control fairness — fewest heroes wins, ties go to least-recently-controlled
// ---------------------------------------------------------------------------

let controlSeq = 0;
/** Last control-assignment sequence number per player index (hero or merc). */
const lastControlled: number[] = [0, 0, 0, 0];

// Save segment. One group of fields per slot, numbered: t1/d1/i1, t2/d2/i2.
// Old saves wrote a single unnumbered mercenary (t/d/it) and read into slot 0.
registerSaveSegment('mm',
  () => {
    const parts: string[] = [];
    for (let i = 0; i < MAX_MERCS; i++) {
      const sl = slots[i];
      if (sl.typeId === 0) continue;
      const n = tostring(i + 1);
      parts.push('t' + n + '=' + tostring(sl.typeId));
      parts.push('d' + n + '=' + (sl.dead ? '1' : '0'));
      if (sl.items.length > 0) parts.push('i' + n + '=' + sl.items.join(','));
    }
    return table.concat(parts, ';');
  },
  (raw) => {
    const readItems = (val: string): number[] => {
      const out: number[] = [];
      for (const [idStr] of string.gmatch(val, '([^,]+)')) {
        const id = tonumber(idStr) ?? 0;
        if (id !== 0) out.push(id);
      }
      return out;
    };
    for (const [key, val] of pairs(parseFields(raw))) {
      if (key === 't1' || key === 't') {
        slots[0].typeId = tonumber(val) ?? 0;
      } else if (key === 'd1' || key === 'd') {
        slots[0].dead = val === '1';
      } else if (key === 'i1' || key === 'it') {
        slots[0].items = readItems(val as string);
      } else if (key === 't2') {
        slots[1].typeId = tonumber(val) ?? 0;
      } else if (key === 'd2') {
        slots[1].dead = val === '1';
      } else if (key === 'i2') {
        slots[1].items = readItems(val as string);
      }
      // 'b' (the old "contract bought" flag) is deliberately ignored: whether a
      // mercenary exists is now simply whether its slot has a type.
    }
  },
  // Reset-then-apply baseline: no contracts, no mercenaries, no kit
  () => {
    slots = [emptySlot(), emptySlot()];
    currentHeroOwnerIds = [];
    controlSeq = 0;
    for (let i = 0; i < 4; i++) lastControlled[i] = 0;
  },
);

function stampControl(playerId: number): void {
  controlSeq++;
  if (playerId >= 0 && playerId < 4) {
    lastControlled[playerId] = controlSeq;
  }
}

/** Pick a mercenary's controller: fewest heroes this summon, ties broken by
 *  who was assigned control (hero or merc) least recently. */
function pickMercController(): MapPlayer | null {
  const humans = getHumanPlayers();
  let best: MapPlayer | null = null;
  let bestHeroes = 0;
  let bestSeq = 0;
  for (const p of humans) {
    let heroes = 0;
    for (const id of currentHeroOwnerIds) {
      if (id === p.id) heroes++;
    }
    const seq = p.id >= 0 && p.id < 4 ? lastControlled[p.id] : 0;
    if (best == null || heroes < bestHeroes || (heroes === bestHeroes && seq < bestSeq)) {
      best = p;
      bestHeroes = heroes;
      bestSeq = seq;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

/** Every creep type drawn from, up to `maxLevel` camps, each type once.
 *
 *  Level tracks the contracts: the first mercenary opens level 2 camps and
 *  draws from them, the second opens level 3 and draws from those too. */
function mercPool(maxLevel: number): string[] {
  const camps = CREEP_CAMPS[MERC_TILESET];
  if (camps == null) return [];
  const seen: Record<string, boolean> = {};
  const pool: string[] = [];
  for (const camp of camps) {
    if (camp.level > maxLevel) continue;
    for (const creep of camp.creeps) {
      if (seen[creep.id] !== true) {
        seen[creep.id] = true;
        pool.push(creep.id);
      }
    }
  }
  return pool;
}

/** Roll a mercenary type, never one you already field.
 *
 *  Excluding the mercenaries in play is the same rule the hero pool uses -- a
 *  reroll has to hand you something new -- and it stops the second contract
 *  duplicating the first. Seeded (rng.ts), so a save always rolls the same. */
function rollMercType(maxLevel: number): number {
  const excluded = livingSlots().map(sl => sl.typeId);
  const pool = mercPool(maxLevel).filter(id => !excluded.includes(FourCC(id)));
  if (pool.length === 0) return 0;
  return FourCC(pool[seededInt(0, pool.length - 1)]);
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/** Whether any mercenary has ever been hired. */
export function isMercUpgradeBought(): boolean {
  return slots.some(sl => sl.typeId !== 0);
}

/** Whether at least one mercenary is alive. */
export function hasActiveMerc(): boolean {
  return livingMercCount() > 0;
}

/** Whether a slot that once held a mercenary is empty because it died, so the
 *  next purchase of that contract is a replacement rather than a first hire. */
export function isMercDead(): boolean {
  return slots.some(sl => sl.typeId !== 0 && sl.dead);
}

/** The Mercenary Contract is on the shelf whenever none are alive. */
export function canBuyMercContract(): boolean {
  return livingMercCount() === 0;
}

/** The Second Contract is on the shelf only with exactly one alive: it is the
 *  step from one mercenary to two, and from level 2 camps to level 3. */
export function canBuySecondContract(): boolean {
  return livingMercCount() === 1;
}

/** Fill the lowest empty slot with a freshly rolled mercenary, handing back the
 *  kit that slot was holding. Rolling fresh rather than resurrecting is the
 *  point: buying again is a new hire, not the same creep back. */
function hire(maxLevel: number): boolean {
  const sl = slots.find(x => x.typeId === 0 || x.dead);
  if (sl == null) return false;
  const rolled = rollMercType(maxLevel);
  if (rolled === 0) return false;
  sl.typeId = rolled;
  sl.dead = false;
  // sl.items is deliberately NOT cleared: empty on a first hire, and on a
  // replacement it is this slot's own kit coming back.
  return true;
}

/** Buy the Mercenary Contract: your first mercenary, and level 2 camps. */
export function buyMercContract(): boolean {
  if (!canBuyMercContract()) return false;
  return hire(2);
}

/** Buy the Second Contract: a second mercenary, and level 3 (red) camps. The
 *  roll excludes the mercenary you already have. */
export function buySecondContract(): boolean {
  if (!canBuySecondContract()) return false;
  return hire(3);
}

// ---------------------------------------------------------------------------
// Spawn / lifecycle
// ---------------------------------------------------------------------------

function spawnMercUnit(sl: MercSlot, owner: MapPlayer, x: number, y: number): void {
  const u = Unit.create(owner, sl.typeId, x, y, 270);
  if (u == null) return;
  sl.unit = u;
  UnitAddAbility(u.handle, MERC_INVENTORY_ABILITY_ID);
  for (const itemId of sl.items) {
    UnitAddItem(u.handle, CreateItem(itemId, u.x, u.y)!);
  }
  PanCameraToTimedForPlayer(owner.handle, x, y, 0.5);

  // Death empties the slot until its contract is bought again. Snapshot the kit
  // and strip it before the corpse can drop it, or the items would be both
  // saved AND left on the ground as free loot.
  clearMercDeathTrigger(sl);
  const deathTrig = Trigger.create();
  sl.deathTrig = deathTrig;
  TriggerRegisterUnitEvent(deathTrig.handle, u.handle, EVENT_UNIT_DEATH);
  deathTrig.addAction(() => {
    if (sl.unit != null && sl.unit.handle === GetTriggerUnit()) {
      sl.items = getInventoryItemIds(sl.unit.handle);
      forEachInventoryItem(sl.unit.handle, it => RemoveItem(it));
      sl.dead = true;
      sl.unit = null;
    }
    if (sl.deathTrig === deathTrig) { sl.deathTrig = null; }
    DestroyTrigger(deathTrig.handle);
  });
}

/** Spawn every living mercenary alongside the heroes. */
export function spawnMercWithHeroes(x: number, y: number, heroOwnerIds: number[]): void {
  currentHeroOwnerIds = heroOwnerIds;
  for (const id of heroOwnerIds) {
    stampControl(id);
  }
  let i = 0;
  for (const sl of livingSlots()) {
    const owner = pickMercController();
    if (owner == null) return;
    // Fan them out so two mercenaries do not spawn on the same spot.
    spawnMercUnit(sl, owner, x + i * 96, y);
    stampControl(owner.id);
    i += 1;
  }
}

/** Snapshot every mercenary's kit and drop the live-unit references. Called
 *  before the unsummon sweep / round reset removes the units themselves. */
export function releaseMercUnit(): void {
  for (const sl of slots) {
    if (sl.unit != null && GetUnitTypeId(sl.unit.handle) !== 0) {
      sl.items = getInventoryItemIds(sl.unit.handle);
    }
    clearMercDeathTrigger(sl);
    sl.unit = null;
  }
  currentHeroOwnerIds = [];
}

// ---------------------------------------------------------------------------
// Lobby display + reroll
// ---------------------------------------------------------------------------

/** Neutral display copies, one per living mercenary, shown in the lobby beside
 *  last round's heroes so the Reroll item can target them. */
let lobbyMercs: Array<{ unit: Unit; slot: MercSlot }> = [];

/** Stand the living mercenaries in the lobby, starting at (x, y). */
export function spawnLobbyMerc(x: number, y: number): void {
  lobbyMercs = [];
  let i = 0;
  for (const sl of livingSlots()) {
    const u = Unit.create(getNeutralPassive(), sl.typeId, x + i * 96, y, 270);
    if (u != null) {
      u.invulnerable = true;
      // Show the kit, so the lobby says what a reroll would keep.
      for (const itemId of sl.items) {
        const it = CreateItem(itemId, u.x, u.y);
        if (it != null) UnitAddItem(u.handle, it);
      }
      lobbyMercs.push({ unit: u, slot: sl });
    }
    i += 1;
  }
}

/** Reroll the lobby mercenary under `unitHandle`: a new type, keeping its kit.
 *  Returns false if that unit is not a lobby mercenary, so the caller can fall
 *  through to the hero reroll. */
export function rerollLobbyMerc(unitHandle: unit): boolean {
  const entry = lobbyMercs.find(e => e.unit.handle === unitHandle);
  if (entry == null) return false;
  const x = entry.unit.x;
  const y = entry.unit.y;
  // Read the kit off the display unit rather than trusting the stored list --
  // the player may have handed it something since the lobby was built.
  entry.slot.items = getInventoryItemIds(entry.unit.handle);
  markRandomOutcomeTaken();
  // Excludes every mercenary in play, so a reroll is always something new.
  const rolled = rollMercType(mercCampLevel());
  if (rolled !== 0) entry.slot.typeId = rolled;
  RemoveUnit(entry.unit.handle);

  const replacement = Unit.create(getNeutralPassive(), entry.slot.typeId, x, y, 270);
  if (replacement != null) {
    replacement.invulnerable = true;
    for (const itemId of entry.slot.items) {
      const it = CreateItem(itemId, replacement.x, replacement.y);
      if (it != null) UnitAddItem(replacement.handle, it);
    }
    entry.unit = replacement;
  }
  return true;
}
