import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { registerSaveSegment, parseFields } from './save';
import { getHumanPlayers, getInventoryItemIds, forEachInventoryItem } from './util';
import { getNeutralPassive } from './teams';
import { markRandomOutcomeTaken } from './randomOutcome';
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

/** Whether the Mercenary Contract shop upgrade has been purchased. */
let upgradeBought = false;

/** Unit type of the current mercenary (0 = none rolled yet). */
let mercTypeId = 0;

/** True once the mercenary died — it never respawns until rerolled. */
let mercDead = false;

/** Item rawcode IDs the mercenary carries (persist like hero items). */
let mercItems: number[] = [];

// ---------------------------------------------------------------------------
// Per-fight state
// ---------------------------------------------------------------------------

/** The live mercenary unit while heroes are summoned, or null. */
let mercUnit: Unit | null = null;

/** Death trigger for the live mercenary, or null.
 *
 *  Held at module scope because the merc is usually REMOVED rather than killed
 *  — a reroll removes it, and the round reset sweeps it — and a removed unit
 *  fires no death event, so a trigger created per spawn and destroyed only in
 *  its own action leaks one trigger per spawn, every round. */
let mercDeathTrig: Trigger | null = null;

/** Destroy the live merc's death trigger, if any. Safe to call repeatedly. */
function clearMercDeathTrigger(): void {
  if (mercDeathTrig == null) return;
  DestroyTrigger(mercDeathTrig.handle);
  mercDeathTrig = null;
}

/** Player ids owning each spawned hero this summon (duplicates = 2 heroes). */
let currentHeroOwnerIds: number[] = [];

// ---------------------------------------------------------------------------
// Control fairness — fewest heroes wins, ties go to least-recently-controlled
// ---------------------------------------------------------------------------

let controlSeq = 0;
/** Last control-assignment sequence number per player index (hero or merc). */
const lastControlled: number[] = [0, 0, 0, 0];

// Save segment (registered after all state above so the closures capture the
// declared locals — Lua closures can't reference locals declared later).
registerSaveSegment('mm',
  () => {
    if (!upgradeBought) return '';
    const parts: string[] = ['b=1', 't=' + tostring(mercTypeId), 'd=' + (mercDead ? '1' : '0')];
    if (mercItems.length > 0) {
      parts.push('it=' + mercItems.join(','));
    }
    return table.concat(parts, ';');
  },
  (raw) => {
    for (const [key, val] of pairs(parseFields(raw))) {
      if (key === 'b') {
        upgradeBought = val === '1';
      } else if (key === 't') {
        mercTypeId = tonumber(val) ?? 0;
      } else if (key === 'd') {
        mercDead = val === '1';
      } else if (key === 'it') {
        mercItems = [];
        for (const [idStr] of string.gmatch(val, '([^,]+)')) {
          const id = tonumber(idStr) ?? 0;
          if (id !== 0) mercItems.push(id);
        }
      }
    }
  },
  // Reset-then-apply baseline: no contract, no merc, no items
  () => {
    upgradeBought = false;
    mercTypeId = 0;
    mercDead = false;
    mercItems = [];
    mercUnit = null;
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

/** Pick the mercenary's controller: fewest heroes this summon, ties broken by
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

/** Pick a random creep type from the available camps of the tileset (each
 *  unique type weighted equally). Includes level 2 camps — the Mercenary
 *  Contract that grants a merc also unlocks them — but not level 3 (red)
 *  camps, which never enter the rotation. */
function rollMercType(): number {
  const camps = CREEP_CAMPS[MERC_TILESET];
  if (camps == null) return 0;
  const seen: Record<string, boolean> = {};
  const pool: string[] = [];
  for (const camp of camps) {
    if (camp.level > 2) continue;
    for (const creep of camp.creeps) {
      if (seen[creep.id] !== true) {
        seen[creep.id] = true;
        pool.push(creep.id);
      }
    }
  }
  if (pool.length === 0) return 0;
  return FourCC(pool[GetRandomInt(0, pool.length - 1)]);
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/** Whether the Mercenary Contract upgrade has ever been bought. */
export function isMercUpgradeBought(): boolean {
  return upgradeBought;
}

/** Whether a LIVING mercenary is under contract. This -- not the raw purchase
 *  flag -- is what gates the perks: a merc that dies takes its level 2 camps
 *  with it, and the contract goes back on sale so buying again revives it. */
export function hasActiveMerc(): boolean {
  return upgradeBought && !mercDead;
}

/** Whether the merc is dead and awaiting a re-purchase. */
export function isMercDead(): boolean {
  return upgradeBought && mercDead;
}

/** Buy the Mercenary Contract. First purchase hires a merc; buying again after
 *  one died revives it as a FRESH random creep for the same price, and the
 *  items it was carrying come back with it (death does not lose them --
 *  they were snapshotted off the corpse). Returns false if the current merc is
 *  still alive, in which case there is nothing to buy. */
export function buyMercContract(): boolean {
  if (hasActiveMerc()) return false;
  upgradeBought = true;
  mercTypeId = rollMercType();
  mercDead = false;
  // mercItems is deliberately NOT cleared: on a first purchase it is already
  // empty, and on a revive it is the dead merc's kit being handed back.
  return true;
}

// ---------------------------------------------------------------------------
// Spawn / lifecycle
// ---------------------------------------------------------------------------

function snapshotMercItems(): void {
  if (mercUnit == null) return;
  mercItems = getInventoryItemIds(mercUnit.handle);
}

function spawnMercUnit(owner: MapPlayer, x: number, y: number): void {
  const u = Unit.create(owner, mercTypeId, x, y, 270);
  if (u == null) return;
  mercUnit = u;
  UnitAddAbility(u.handle, MERC_INVENTORY_ABILITY_ID);
  for (const itemId of mercItems) {
    UnitAddItem(u.handle, CreateItem(itemId, u.x, u.y)!);
  }
  PanCameraToTimedForPlayer(owner.handle, x, y, 0.5);

  // Death is permanent: snapshot items (they don't drop — the merc inventory
  // has drop-on-death off) and never respawn until a reroll.
  // Replace any trigger left over from a previous spawn before making a new
  // one, so a reroll or a round reset cannot strand it.
  clearMercDeathTrigger();
  const deathTrig = Trigger.create();
  mercDeathTrig = deathTrig;
  TriggerRegisterUnitEvent(deathTrig.handle, u.handle, EVENT_UNIT_DEATH);
  deathTrig.addAction(() => {
    if (mercUnit != null && mercUnit.handle === GetTriggerUnit()) {
      snapshotMercItems();
      // Strip the items before the corpse drops them: they are saved in
      // mercItems for a later reroll, so dropping them too would duplicate them
      // as free loot on the ground.
      forEachInventoryItem(mercUnit.handle, it => RemoveItem(it));
      mercDead = true;
      mercUnit = null;
    }
    // Clear the module reference as well as the handle, or the next spawn's
    // clearMercDeathTrigger would destroy this same handle a second time.
    if (mercDeathTrig === deathTrig) { mercDeathTrig = null; }
    DestroyTrigger(deathTrig.handle);
  });
}

/** Spawn the mercenary alongside the heroes. Called on Summon Heroes with the
 *  player ids owning each spawned hero (used for the fewest-heroes rule). */
export function spawnMercWithHeroes(x: number, y: number, heroOwnerIds: number[]): void {
  currentHeroOwnerIds = heroOwnerIds;
  // Hero controllers count as "controlled a unit" this summon
  for (const id of heroOwnerIds) {
    stampControl(id);
  }
  if (!upgradeBought || mercTypeId === 0 || mercDead) return;
  const owner = pickMercController();
  if (owner == null) return;
  spawnMercUnit(owner, x, y);
  stampControl(owner.id);
}

/** Snapshot the merc's items and drop the live-unit reference. Called before
 *  the unsummon sweep / round reset removes the unit itself. */
export function releaseMercUnit(): void {
  if (mercUnit != null && GetUnitTypeId(mercUnit.handle) !== 0) {
    snapshotMercItems();
  }
  // The caller removes the unit, which fires no death event, so the trigger has
  // to go here or it outlives every round.
  clearMercDeathTrigger();
  mercUnit = null;
  currentHeroOwnerIds = [];
}

// ---------------------------------------------------------------------------
// Lobby display + reroll
// ---------------------------------------------------------------------------

/** Read a unit's inventory into the persistent merc kit. */
function snapshotMercItems2(u: Unit): void {
  const items: number[] = [];
  for (let slot = 0; slot < 6; slot++) {
    const it = UnitItemInSlot(u.handle, slot);
    if (it != null) {
      const id = GetItemTypeId(it);
      if (id !== 0) items.push(id);
    }
  }
  mercItems = items;
}

/** Neutral display copy of the merc, shown in the lobby beside last round's
 *  heroes so the one Reroll item can target it too. Rebuilt each lobby (the
 *  terrain cleanup removes the unit). */
let lobbyMerc: Unit | null = null;

/** Stand the merc in the lobby, next to the heroes. No-op when no merc is
 *  under contract -- a dead one is not shown, because there is nothing to
 *  reroll until the contract is bought again. */
export function spawnLobbyMerc(x: number, y: number): void {
  lobbyMerc = null;
  if (!hasActiveMerc() || mercTypeId === 0) return;
  const u = Unit.create(getNeutralPassive(), mercTypeId, x, y, 270);
  if (u == null) return;
  u.invulnerable = true;
  // Show the gear it is carrying, so the lobby says what a reroll would keep.
  for (const itemId of mercItems) {
    const it = CreateItem(itemId, u.x, u.y);
    if (it != null) UnitAddItem(u.handle, it);
  }
  lobbyMerc = u;
}

/** Reroll the lobby merc: a new random creep type, keeping the items it
 *  carries. Returns false if unitHandle is not the lobby merc, so the caller
 *  can fall through to other reroll targets. */
export function rerollLobbyMerc(unitHandle: unit): boolean {
  if (lobbyMerc == null || lobbyMerc.handle !== unitHandle) return false;
  const x = lobbyMerc.x;
  const y = lobbyMerc.y;
  // Keep whatever it is holding: the display unit is about to be destroyed,
  // so read the gear off it rather than trusting the stored list.
  snapshotMercItems2(lobbyMerc);
  markRandomOutcomeTaken();
  mercTypeId = rollMercType();
  RemoveUnit(lobbyMerc.handle);
  lobbyMerc = null;
  spawnLobbyMerc(x, y);
  return true;
}
