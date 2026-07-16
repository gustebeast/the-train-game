import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { registerSaveSegment } from './save';
import { getHumanPlayers } from './util';
import { CREEP_CAMPS, campLevel } from './creep_camps';

/** Campaign unit inventory repurposed for the mercenary: items function like
 *  on a hero (can use), but nothing drops on death — see compiletime.ts. */
const MERC_INVENTORY_ABILITY_ID = FourCC(Abilities.UnitInventoryHuman);

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
    for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
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
);

// ---------------------------------------------------------------------------
// Per-fight state
// ---------------------------------------------------------------------------

/** The live mercenary unit while heroes are summoned, or null. */
let mercUnit: Unit | null = null;

/** Player ids owning each spawned hero this summon (duplicates = 2 heroes). */
let currentHeroOwnerIds: number[] = [];

// ---------------------------------------------------------------------------
// Control fairness — fewest heroes wins, ties go to least-recently-controlled
// ---------------------------------------------------------------------------

let controlSeq = 0;
/** Last control-assignment sequence number per player index (hero or merc). */
const lastControlled: number[] = [0, 0, 0, 0];

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
    if (campLevel(camp) > 2) continue;
    for (const creep of camp) {
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

/** Whether the Mercenary Contract upgrade is owned (also unlocks L2 camps). */
export function isMercUpgradeBought(): boolean {
  return upgradeBought;
}

/** Buy the Mercenary Contract: unlock level 2 camps and roll the first merc.
 *  Returns false if already owned. */
export function buyMercContract(): boolean {
  if (upgradeBought) return false;
  upgradeBought = true;
  mercTypeId = rollMercType();
  mercDead = false;
  mercItems = [];
  return true;
}

/** Reroll the mercenary (dead or alive): new random type, items carry over.
 *  If the old merc is on the field it is replaced in place; if it was dead
 *  and heroes are currently summoned (spawnNow), the new one spawns at the
 *  buyer's position. Returns false if the contract isn't owned. */
export function rerollMerc(buyerX: number, buyerY: number, spawnNow: boolean): boolean {
  if (!upgradeBought) return false;

  let replaceAt: { x: number; y: number; owner: MapPlayer } | null = null;
  if (mercUnit != null && GetUnitTypeId(mercUnit.handle) !== 0) {
    snapshotMercItems();
    replaceAt = { x: mercUnit.x, y: mercUnit.y, owner: mercUnit.owner };
    RemoveUnit(mercUnit.handle); // remove, not kill — rerolling isn't a death
    mercUnit = null;
  }

  mercTypeId = rollMercType();
  mercDead = false;

  if (replaceAt != null) {
    spawnMercUnit(replaceAt.owner, replaceAt.x, replaceAt.y);
  } else if (spawnNow) {
    const owner = pickMercController();
    if (owner != null) {
      spawnMercUnit(owner, buyerX, buyerY);
      stampControl(owner.id);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Spawn / lifecycle
// ---------------------------------------------------------------------------

function snapshotMercItems(): void {
  if (mercUnit == null) return;
  const h = mercUnit.handle;
  const items: number[] = [];
  for (let slot = 0; slot < 6; slot++) {
    const it = UnitItemInSlot(h, slot);
    if (it != null) {
      const id = GetItemTypeId(it);
      if (id !== 0) items.push(id);
    }
  }
  mercItems = items;
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
  const deathTrig = Trigger.create();
  TriggerRegisterUnitEvent(deathTrig.handle, u.handle, EVENT_UNIT_DEATH);
  deathTrig.addAction(() => {
    if (mercUnit != null && mercUnit.handle === GetTriggerUnit()) {
      snapshotMercItems();
      mercDead = true;
      mercUnit = null;
    }
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
  mercUnit = null;
  currentHeroOwnerIds = [];
}
