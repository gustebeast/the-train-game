import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { registerSaveSegment, MERC_SAVE_KEY, encodeMercSlots, decodeMercSlots } from './save';
import { KitItem, forEachInventoryItem, getHumanPlayers, getInventoryKit, giveKit, unitExists } from './util';
import { getNeutralExtra } from './teams';
import { seededInt } from './rng';
import { CREEP_CAMPS } from './creepCamps';
import { UNKNOWN_UNIT_ID, MAX_MERCS, MAX_PLAYERS } from './constants';

/** Hero-style inventory (the same ability the peasant carries tools with),
 *  added to each mercenary as it spawns -- and only there.
 *
 *  Added at runtime it gives the full six working slots: measured in game for
 *  a type that never had it in object data (mercinventory). It used to be baked
 *  into object data as well, on the belief that a runtime add yields no slots,
 *  for 33 Lordaeron Summer types; the pool long since outgrew that list, and
 *  baking it onto a TYPE handed the inventory to every camp creep of the type,
 *  so a charmed one came over able to carry anything.
 *
 *  This is STOCK AInv, which drops its items on death — no object-data change
 *  suppresses that (an Aihn block that claimed to was dead config; see
 *  compiletime.ts). The death trigger's strip is therefore the only thing
 *  keeping a dead merc's items off the ground, and it depends on running before
 *  the engine's drop. */
const MERC_INVENTORY_ABILITY_ID = FourCC(Abilities.InventoryHero);


// --- Persistent state (saved via the 'mm' segment) ---------------------------

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
  /** What this slot's mercenary carries, kept across death. */
  items: KitItem[];
  /** The live unit while summoned, or null. */
  unit: Unit | null;
  /** Death trigger for the live unit, or null (see clearMercDeathTrigger). */
  deathTrig: Trigger | null;
}

function emptySlot(): MercSlot {
  return { typeId: 0, dead: false, items: [], unit: null, deathTrig: null };
}

function emptySlots(): MercSlot[] {
  const out: MercSlot[] = [];
  for (let i = 0; i < MAX_MERCS; i++) out.push(emptySlot());
  return out;
}

/** Slots in hire order. A slot with typeId 0 was never hired. */
let slots: MercSlot[] = emptySlots();

/** Slots holding a mercenary that is hired and not dead. */
function livingSlots(): MercSlot[] {
  return slots.filter(sl => sl.typeId !== 0 && !sl.dead);
}

/** How many mercenaries are alive right now (0-2). */
export function getLivingMercCount(): number {
  return livingSlots().length;
}

/** Highest creep camp level unlocked: one per living mercenary, above the
 *  level 1 baseline. Losing a mercenary really does cost you the camps. */
export function getMercCampLevel(): number {
  return 1 + getLivingMercCount();
}

// --- Per-fight state ---------------------------------------------------------

/** Player ids owning each spawned hero this summon (duplicates = 2 heroes). */
let currentHeroOwnerIds: number[] = [];

/** Destroy a slot's death trigger, if any. Safe to call repeatedly.
 *
 *  A mercenary is usually REMOVED rather than killed -- a reroll removes it and
 *  the round reset sweeps it -- and a removed unit fires no death event, so a
 *  trigger destroyed only in its own action would leak one per spawn. */
function clearMercDeathTrigger(sl: MercSlot): void {
  if (sl.deathTrig == null) return;
  sl.deathTrig.destroy();
  sl.deathTrig = null;
}

// --- Control fairness — fewest heroes wins, ties go to least-recently-controlled ---

let controlSeq = 0;
/** Last control-assignment sequence number per player index (hero or merc). */
const lastControlled: number[] = [];
for (let i = 0; i < MAX_PLAYERS; i++) lastControlled.push(0);

// Save segment; the format is save.ts's, which the chooser reads too.
registerSaveSegment(MERC_SAVE_KEY,
  () => encodeMercSlots(slots),
  (raw) => {
    const saved = decodeMercSlots(raw);
    for (let i = 0; i < MAX_MERCS; i++) {
      slots[i].typeId = saved[i].typeId;
      slots[i].dead = saved[i].dead;
      slots[i].items = saved[i].items;
    }
  },
  // Reset-then-apply baseline: no contracts, no mercenaries, no kit
  () => {
    slots = emptySlots();
    currentHeroOwnerIds = [];
    controlSeq = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) lastControlled[i] = 0;
  },
);

function stampControl(playerId: number): void {
  controlSeq++;
  if (playerId >= 0 && playerId < MAX_PLAYERS) {
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
    const seq = p.id >= 0 && p.id < MAX_PLAYERS ? lastControlled[p.id] : 0;
    if (best == null || heroes < bestHeroes || (heroes === bestHeroes && seq < bestSeq)) {
      best = p;
      bestHeroes = heroes;
      bestSeq = seq;
    }
  }
  return best;
}

// --- Rolling -----------------------------------------------------------------

/** Every creep type drawn from, up to `maxLevel` camps, each type once.
 *
 *  Level tracks the contracts: the first mercenary opens level 2 camps and
 *  draws from them, the second opens level 3 and draws from those too. */
function mercPool(maxLevel: number): string[] {
  const camps = CREEP_CAMPS;
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
  const excluded = livingSlots().map(sl => sl.typeId).concat(startedWithTypes());
  const pool = mercPool(maxLevel).filter(id => !excluded.includes(FourCC(id)));
  if (pool.length === 0) return 0;
  return FourCC(pool[seededInt(0, pool.length - 1)]);
}

// --- Purchases ---------------------------------------------------------------

/** Whether at least one mercenary is alive. */
export function hasActiveMerc(): boolean {
  return getLivingMercCount() > 0;
}

/** Whether a slot that once held a mercenary is empty because it died, so the
 *  next purchase of that contract is a replacement rather than a first hire. */
export function isMercDead(): boolean {
  return slots.some(sl => sl.typeId !== 0 && sl.dead);
}

/** The Mercenary Contract is on the shelf whenever none are alive. */
export function canBuyMercContract(): boolean {
  return getLivingMercCount() === 0;
}

/** The Second Contract is on the shelf only with exactly one alive: it is the
 *  step from one mercenary to two, and from level 2 camps to level 3. */
export function canBuySecondContract(): boolean {
  return getLivingMercCount() === 1;
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

/** Test hook: hire exactly these mercenaries, bare-handed, in slot order. */
export function setMercsForTest(typeIds: ReadonlyArray<number>): void {
  for (let i = 0; i < MAX_MERCS; i++) {
    slots[i] = emptySlot();
    if (i < typeIds.length) slots[i].typeId = typeIds[i];
  }
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

// --- Spawn / lifecycle -------------------------------------------------------

/** What a mercenary IS, for the purpose of standing one up: a creep type and
 *  whatever it is carrying. */
export interface MercData {
  typeId: number;
  items: ReadonlyArray<KitItem>;
}

/**
 * The ONE way a mercenary is put on the map.
 *
 * Every place one appears goes through here -- the mid-round spawn, the boss
 * fight, the inter-round lobby roster and the save chooser -- so all of them
 * show the same mercenary, carrying the same kit in an inventory it can
 * actually hold. Without the inventory ability the unit has no slots at all,
 * and the items it is handed drop on the floor beside it.
 *
 * It takes the mercenary's DATA rather than a contract slot, because the save
 * chooser is displaying a party that is not loaded and must not be: looking at
 * a save cannot be allowed to overwrite the run you are looking at it from.
 */
export function spawnMercFromData(
  data: MercData, owner: MapPlayer, x: number, y: number,
): Unit | null {
  if (data.typeId === 0) return null;
  const u = Unit.create(owner, data.typeId, x, y, 270);
  if (u == null) return null;
  UnitAddAbility(u.handle, MERC_INVENTORY_ABILITY_ID);
  giveKit(u.handle, data.items);
  return u;
}

function spawnMercUnit(sl: MercSlot, owner: MapPlayer, x: number, y: number): void {
  const u = spawnMercFromData(sl, owner, x, y);
  if (u == null) return;
  sl.unit = u;
  PanCameraToTimedForPlayer(owner.handle, x, y, 0.5);

  // Death empties the slot until its contract is bought again. Snapshot the kit
  // and strip it before the corpse can drop it, or the items would be both
  // saved AND left on the ground as free loot.
  clearMercDeathTrigger(sl);
  const deathTrig = Trigger.create();
  sl.deathTrig = deathTrig;
  deathTrig.registerUnitEvent(u, EVENT_UNIT_DEATH);
  deathTrig.addAction(() => {
    if (sl.unit != null && sl.unit.handle === GetTriggerUnit()) {
      sl.items = getInventoryKit(sl.unit.handle);
      forEachInventoryItem(sl.unit.handle, it => RemoveItem(it));
      sl.dead = true;
      sl.unit = null;
    }
    if (sl.deathTrig === deathTrig) { sl.deathTrig = null; }
    deathTrig.destroy();
  });
}

/** Field the mercenaries for one specific owner, for the sparring match.
 *
 *  Not spawnMercWithHeroes, which does three things the sparring match must not
 *  do. It picks the owner itself via pickMercController -- always a HUMAN, so
 *  the ids passed in were ignored and the match's mercenary ended up belonging
 *  to player 1. It pans that owner's camera to the spawn, which is what yanked
 *  the view across the lobby when the match began. And it registers the death
 *  trigger that marks the slot dead and strips its kit, which a practice fight
 *  has no business doing to the player's actual mercenary.
 *
 *  sl.unit is still set, so getSpawnedMercUnits finds them and the teardown
 *  takes them off the field. */
export function spawnMercsForOwner(owner: MapPlayer, x: number, y: number): void {
  let i = 0;
  for (const sl of livingSlots()) {
    const u = spawnMercFromData(sl, owner, x + i * 96, y);
    if (u != null) sl.unit = u;
    i += 1;
  }
}

/** The living mercenaries as data, for standing up extra copies of them that
 *  must not touch the contract slots -- see the sparring match. */
export function getLivingMercData(): MercData[] {
  return livingSlots().map(sl => ({ typeId: sl.typeId, items: sl.items }));
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

/** The mercenary units standing right now. Empty when none are fielded.
 *
 *  Exists for the sparring match, which fields the roster itself rather than through
 *  the summon path, and so has to ask who else is on the field. */
export function getSpawnedMercUnits(): Unit[] {
  const live: Unit[] = [];
  for (const sl of slots) {
    if (sl.unit != null && unitExists(sl.unit.handle)) live.push(sl.unit);
  }
  return live;
}

/** Take the mercenaries off the field, keeping their kit.
 *
 *  releaseMercUnits snapshots and forgets them but leaves the units standing,
 *  because the callers it was written for (the unsummon sweep, the round reset)
 *  remove the units themselves straight afterwards. The sparring match has no such
 *  sweep -- its combatants belong to a non-human player nothing else touches --
 *  so it needs the units gone as well. */
export function removeSpawnedMercUnits(): void {
  const live = getSpawnedMercUnits();
  releaseMercUnits();   // snapshots kit first, then drops the references
  for (const u of live) {
    if (unitExists(u.handle)) RemoveUnit(u.handle);
  }
}

/** Record what each mercenary on the field is carrying, leaving it there. */
export function snapshotMercKits(): void {
  for (const sl of slots) {
    if (sl.unit != null && unitExists(sl.unit.handle)) {
      sl.items = getInventoryKit(sl.unit.handle);
    }
  }
}

/** Snapshot every mercenary's kit and drop the live-unit references. Called
 *  before the unsummon sweep / round reset removes the units themselves. */
export function releaseMercUnits(): void {
  snapshotMercKits();
  for (const sl of slots) {
    clearMercDeathTrigger(sl);
    sl.unit = null;
  }
  currentHeroOwnerIds = [];
}

// --- Inter-round lobby display + reroll --------------------------------------

/** Slot types as they stood when this inter-round lobby visit began, so a
 *  mercenary rolled since can be told apart from one you already had. Mirrors
 *  the hero snapshot in heroes.ts; see heroConcealed there for why this is
 *  derived rather than tracked. */
let lobbyMercSnapshot: number[] | null = null;

/** Snapshot mercenary slots on inter-round lobby entry. */
export function saveMercInterRoundLobbySnapshot(): void {
  lobbyMercSnapshot = slots.map(sl => (sl.dead ? 0 : sl.typeId));
}

/** Types the player already had standing in front of them when the visit began.
 *  Excluded from rolls so a reroll cannot hand back a mercenary they walked in
 *  with -- invisible to them now that the result is concealed. */
function startedWithTypes(): number[] {
  return lobbyMercSnapshot == null ? [] : lobbyMercSnapshot.filter(id => id !== 0);
}

/** Whether this slot holds a mercenary rolled but not yet met. */
function mercConcealed(slotIndex: number): boolean {
  if (lobbyMercSnapshot == null) return false;
  const sl = slots[slotIndex];
  return lobbyMercSnapshot[slotIndex] !== (sl.dead ? 0 : sl.typeId);
}

/** Neutral display copies, one per living mercenary, shown in the inter-round lobby beside
 *  the heroes so the Reroll item can target them.
 *
 *  Keyed by slot INDEX, not by slot object: the save reset swaps in fresh slot
 *  objects, so an identity reference would go stale on load. */
let lobbyMercs: Array<{ unit: Unit; slotIndex: number }> = [];

/** Forget the display units without touching the world. Pairs with the terrain
 *  sweep, which has already removed them. */
export function clearInterRoundLobbyMercs(): void {
  lobbyMercs = [];
}

/** Stand the living mercenaries in the inter-round lobby, contract slot i on positions[i].
 *
 *  Additive, so buying a contract can call this to put the new hire on the
 *  floor at once rather than leaving the player to wonder what they bought
 *  until the next inter-round lobby. Mercenaries already standing are left alone, kit and
 *  all. */
export function syncInterRoundLobbyMercs(positions: Array<{ x: number; y: number }>): void {
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    if (sl.typeId === 0 || sl.dead) continue;
    if (lobbyMercs.some(e => e.slotIndex === i)) continue;
    const pos = positions[Math.min(i, positions.length - 1)];
    const u = createRosterMercUnit(i, pos.x, pos.y);
    if (u == null) continue;
    lobbyMercs.push({ unit: u, slotIndex: i });
  }
}

/** Stand slot `slotIndex`'s mercenary in the inter-round lobby roster.
 *
 *  Same routine as the fighting mercenary, so the display carries the kit the
 *  way it will carry it in the round -- in an inventory, not on the floor. A
 *  mercenary rolled this visit (hired or rerolled) stands as a question mark
 *  until the round starts, holding the same items, so the lobby still says
 *  what a reroll would keep. Neutral extra owns the display roster so it
 *  grants no vision -- see createRosterHeroUnit in heroes.ts. */
function createRosterMercUnit(slotIndex: number, x: number, y: number): Unit | null {
  const sl = slots[slotIndex];
  const typeId = mercConcealed(slotIndex) ? UNKNOWN_UNIT_ID : sl.typeId;
  const u = spawnMercFromData({ typeId, items: sl.items }, getNeutralExtra(), x, y);
  if (u != null) u.invulnerable = true;
  return u;
}

/** The mercenary display units standing in the inter-round lobby. */
export function getInterRoundLobbyMercUnits(): Unit[] {
  return lobbyMercs.map(e => e.unit);
}

/** Reroll the inter-round lobby mercenary under `unitHandle`: a new type, keeping its kit.
 *  Returns false if that unit is not an inter-round lobby mercenary, so the caller can fall
 *  through to the hero reroll. */
export function rerollInterRoundLobbyMerc(unitHandle: unit): boolean {
  const entry = lobbyMercs.find(e => e.unit.handle === unitHandle);
  if (entry == null) return false;
  const slot = slots[entry.slotIndex];
  if (slot == null) return false;
  const x = entry.unit.x;
  const y = entry.unit.y;
  // Read the kit off the display unit rather than trusting the stored list --
  // the player may have handed it something since the inter-round lobby was built.
  slot.items = getInventoryKit(entry.unit.handle);
  // Excludes every mercenary in play, so a reroll is always something new.
  const rolled = rollMercType(getMercCampLevel());
  if (rolled !== 0) slot.typeId = rolled;
  RemoveUnit(entry.unit.handle);

  // Concealed by construction: the type just changed.
  const replacement = createRosterMercUnit(entry.slotIndex, x, y);
  if (replacement != null) entry.unit = replacement;
  return true;
}
