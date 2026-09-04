import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { isInGameplay } from './state';
import { registerSaveSegment, parseFields } from './save';
import { SUMMON_ABILITY_ID, UNSUMMON_ABILITY_ID, PEASANT_ID } from './constants';
import { createPlaceholder } from './placeholder';
import { seededValueAt, deriveSeed } from './rng';
import { gameState } from './state';
import { getNeutralExtra } from './teams';
import { isSummonUpgradePurchased } from './summonUpgrade';
import { forEachUnitInWorld, getHumanPlayers, getInventoryItemIds, giveItems, nextFrame } from './util';
import { spawnMercWithHeroes, releaseMercUnit } from './mercenary';

/** All standard WC3 heroes available for random selection. */
const HERO_POOL: string[] = [
  // Human
  Units.Paladin, Units.Archmage, Units.MountainKing, Units.BloodMage,
  // Orc
  Units.Blademaster, Units.FarSeer, Units.TaurenChieftain, Units.ShadowHunter,
  // Undead
  Units.DeathKnight, Units.Lich, Units.Dreadlord, Units.CryptLord,
  // Night Elf
  Units.DemonHunter, Units.KeeperOfTheGrove, Units.PriestessOfTheMoon, Units.Warden,
  // Tavern
  Units.Beastmaster, Units.DarkRanger, Units.PitLord, Units.Tinker,
  Units.Firelord, Units.Alchemist, Units.Brewmaster, Units.SeaWitch,
];

/** Convert a FourCC integer to a 4-character string. */
function fourCCStr(id: number): string {
  return string.char(
    math.floor(id / 0x1000000) % 256,
    math.floor(id / 0x10000) % 256,
    math.floor(id / 0x100) % 256,
    id % 256,
  );
}

/** Fisher-Yates shuffle, in place. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = GetRandomInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Run a callback for every peasant on the map. */
function forEachPeasant(cb: (u: unit) => void): void {
  forEachUnitInWorld(u => {
    if (GetUnitTypeId(u) === PEASANT_ID) cb(u);
  });
}

// ---------------------------------------------------------------------------
// Persistent hero data (4 heroes, saved across rounds)
// ---------------------------------------------------------------------------

export interface HeroData {
  typeId: number;
  xp: number;
  skills: Record<string, number>;
  /** Item rawcode IDs in inventory (up to 6 slots, 0 = empty). */
  items: number[];
  /** Bonus stats from consumed tomes (powerup items). */
  tomeStr: number;
  tomeAgi: number;
  tomeInt: number;
  tomeHP: number;
}

function emptyHero(): HeroData {
  return { typeId: 0, xp: 0, skills: {}, items: [], tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
}

/** The 4 heroes available across rounds. Persisted via save segments. */
const allHeroes: HeroData[] = [emptyHero(), emptyHero(), emptyHero(), emptyHero()];

/** Encode one hero's data as "t=FourCC;x=XP;ts=1;ta=2;ti=0;it=id1,id2,...;abilId=level;...". */
function encodeHero(hero: HeroData): string {
  if (hero.typeId === 0) return '';
  const parts: string[] = [];
  parts.push('t=' + tostring(hero.typeId));
  parts.push('x=' + tostring(hero.xp));
  if (hero.tomeStr !== 0) parts.push('ts=' + tostring(hero.tomeStr));
  if (hero.tomeAgi !== 0) parts.push('ta=' + tostring(hero.tomeAgi));
  if (hero.tomeInt !== 0) parts.push('ti=' + tostring(hero.tomeInt));
  if (hero.tomeHP !== 0) parts.push('th=' + tostring(hero.tomeHP));
  if (hero.items.length > 0) {
    parts.push('it=' + hero.items.join(','));
  }
  for (const [k, v] of Object.entries(hero.skills)) {
    if (v > 0) parts.push(k + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Decode "t=FourCC;x=XP;ts=1;ta=2;ti=0;it=id1,id2,...;abilId=level;..." into a HeroData. */
export function decodeHero(raw: string): HeroData {
  const hero = emptyHero();
  for (const [key, val] of pairs(parseFields(raw))) {
    if (key === 't') {
      hero.typeId = tonumber(val) ?? 0;
    } else if (key === 'x') {
      hero.xp = tonumber(val) ?? 0;
    } else if (key === 'ts') {
      hero.tomeStr = tonumber(val) ?? 0;
    } else if (key === 'ta') {
      hero.tomeAgi = tonumber(val) ?? 0;
    } else if (key === 'ti') {
      hero.tomeInt = tonumber(val) ?? 0;
    } else if (key === 'th') {
      hero.tomeHP = tonumber(val) ?? 0;
    } else if (key === 'it') {
      for (const [idStr] of string.gmatch(val, '([^,]+)')) {
        const id = tonumber(idStr) ?? 0;
        if (id !== 0) hero.items.push(id);
      }
    } else {
      hero.skills[key] = tonumber(val) ?? 0;
    }
  }
  return hero;
}

// Register save segments h1–h4. Reset restores the uninitialized-hero
// baseline (round-0 saves omit hN), letting initRandomHeroes re-roll.
for (let i = 0; i < 4; i++) {
  const idx = i;
  registerSaveSegment('h' + (idx + 1),
    () => encodeHero(allHeroes[idx]),
    (raw) => { allHeroes[idx] = decodeHero(raw); },
    () => { allHeroes[idx] = emptyHero(); },
  );
}

// ---------------------------------------------------------------------------
// Per-round state
// ---------------------------------------------------------------------------

/** Indices into allHeroes fielded this round.
 *
 *  NOT saved. The roster is derived from (hero XP, round number, run seed), all
 *  of which are already in the save, so re-deriving on load reproduces the same
 *  pair without storing it. Persisting it was the bug: a save carried a pair
 *  that outvoted the XP rule, so a run resumed with whoever the file happened to
 *  name -- and a file written by a build with the old selection bug pinned the
 *  same two heroes every round. Derived, a stale pair cannot exist. */
let chosenIndices: number[] = [0, 1];

/** Sub-seed namespace for the roster draw (challenges use 1, terrain 2). Kept
 *  well clear of those so a hero tie-break can never share a stream with them. */
const HERO_PICK_STREAM = 1000;

// ---------------------------------------------------------------------------
// Hero player control — which players control heroes vs peasants
// ---------------------------------------------------------------------------

/** Number of times each player (by index) has controlled a summoned hero. */
const heroControlCount: number[] = [0, 0, 0, 0];

/** Player indices chosen to control heroes this round. */
let chosenHeroPlayers: number[] = [];
let heroPlayersFromSave = false;

/** Original peasant owners before hero transfer, for restoration. */
const peasantOwnerMap: Map<unit, MapPlayer> = new Map();

// Persist heroControlCount as "hc" segment: "0,1,2,0" format
registerSaveSegment('hc',
  () => heroControlCount.join(','),
  (raw) => {
    let i = 0;
    for (const [val] of string.gmatch(raw, '([^,]+)')) {
      if (i < 4) heroControlCount[i] = tonumber(val) ?? 0;
      i++;
    }
  },
  () => {
    for (let i = 0; i < 4; i++) heroControlCount[i] = 0;
  },
);

// Persist chosenHeroPlayers as "hp" segment: "0,3" format
registerSaveSegment('hp',
  () => chosenHeroPlayers.join(','),
  (raw) => {
    const loaded: number[] = [];
    for (const [val] of string.gmatch(raw, '([^,]+)')) {
      loaded.push(tonumber(val) ?? 0);
    }
    if (loaded.length > 0) {
      chosenHeroPlayers = loaded;
      heroPlayersFromSave = true;
    }
  },
  () => {
    chosenHeroPlayers = [];
    heroPlayersFromSave = false;
  },
);

/** Choose which players control heroes this round.
 *  Players with the lowest heroControlCount are selected. */
export function chooseHeroPlayers(): void {
  // Same reasoning as chooseHeroes: the loaded assignment covers the round being
  // resumed, so this victory-time call must always re-pick.
  heroPlayersFromSave = false;
  pickLeastBusyHeroPlayers();
}

/** Choose the player(s) with the lowest heroControlCount. */
function pickLeastBusyHeroPlayers(): void {
  const humans = getHumanPlayers();
  const numPlayers = humans.length;
  if (numPlayers === 0) return;

  const numHeroControllers = numPlayers > 3 ? 2 : 1;

  // Build indices of human players (by player slot index)
  const playerIndices = humans.map(p => p.id);

  // Sort by control count ascending
  playerIndices.sort((a, b) => heroControlCount[a] - heroControlCount[b]);

  // Check for ties at the minimum count
  const minCount = heroControlCount[playerIndices[0]];
  const tied = playerIndices.filter(i => heroControlCount[i] === minCount);

  if (tied.length <= numHeroControllers) {
    // Not enough ties — take all tied + next lowest
    chosenHeroPlayers = playerIndices.slice(0, numHeroControllers);
  } else {
    // More ties than slots — shuffle tied and pick
    shuffle(tied);
    chosenHeroPlayers = tied.slice(0, numHeroControllers);
  }
}

/** Spawned hero units this round, each paired with its index into allHeroes.
 *  (Explicit pairing — a failed Unit.create must not misalign hero data.) */
let spawnedHeroes: Array<{ unit: Unit; dataIdx: number }> = [];

/** Whether heroes have been summoned this round. */
let heroesSpawned = false;

/** Callback invoked after heroes are summoned (with a 1-frame delay). */
let onHeroesSpawnedCallback: ((heroes: Unit[]) => void) | null = null;

/** Register a callback to run after heroes are summoned. */
export function onHeroesSpawned(cb: (heroes: Unit[]) => void): void {
  onHeroesSpawnedCallback = cb;
}

/** Callback invoked when every spawned hero has died. */
let onAllHeroesDeadCallback: (() => void) | null = null;

/** Register a callback to run when all spawned heroes have died. */
export function onAllHeroesDead(cb: () => void): void {
  onAllHeroesDeadCallback = cb;
}

/** Returns true if the 4 heroes have been initialized. */
export function hasHeroes(): boolean {
  return allHeroes[0].typeId !== 0;
}


// ---------------------------------------------------------------------------
// Hero selection
// ---------------------------------------------------------------------------

/** Pick 4 unique random heroes, populate allHeroes, and choose initial 2. Called once at game start. */
export function initRandomHeroes(): void {
  const available = [...HERO_POOL];
  for (let i = 0; i < 4; i++) {
    const idx = GetRandomInt(0, available.length - 1);
    allHeroes[i] = emptyHero();
    allHeroes[i].typeId = FourCC(available[idx]);
    available.splice(idx, 1);
  }
  chooseHeroes();
  if (heroPlayersFromSave) heroPlayersFromSave = false; else pickLeastBusyHeroPlayers();
}

/** Choose the 2 heroes with the lowest XP from the 4.
 *  If all XP is equal, pick 2 at random. Sets chosenIndices. */
/** Field the WHOLE roster, not the usual two.
 *
 *  The boss fight is the one time everybody comes: an ordinary round summons
 *  the two least-rested heroes, which is what chooseHeroes picks, and turning
 *  up to the finale with half the roster would be a strange way to end a run. */
export function chooseAllHeroes(): void {
  const all: number[] = [];
  for (let i = 0; i < allHeroes.length; i++) {
    if (allHeroes[i].typeId !== 0) all.push(i);
  }
  chosenIndices = all;
}

/** Field the two least-rested heroes for the round the game is on.
 *
 *  A pure function of (XP, round, run seed), so it can be called as often as it
 *  likes and answer the same thing: at victory (the round counter has already
 *  advanced, so this picks for the round about to be played), again when that
 *  round loads, and again after a reload of the same save. That is what makes
 *  the pair repeatable without saving it -- and why a reload cannot re-roll a
 *  tie in the player's favour.
 *
 *  Call it only where the roster is meant to be settled: XP moves while a round
 *  is played, so re-deriving mid-round would swap the party out from under it. */
export function chooseHeroes(): void {
  const indices = [0, 1, 2, 3];
  // Least XP first. Ties -- common early, when nobody has fought yet -- break on
  // a per-round seeded draw rather than table.sort's arbitrary order, which is
  // both unstable in Lua and identical every round. Index last so the ordering
  // is total and can never depend on sort internals.
  const tie = ROSTER_TIEBREAKS;
  for (let i = 0; i < 4; i++) {
    tie[i] = deriveSeed(HERO_PICK_STREAM + gameState.round * 4 + i);
  }
  indices.sort((a, b) => {
    const byXp = allHeroes[a].xp - allHeroes[b].xp;
    if (byXp !== 0) return byXp;
    const byDraw = tie[a] - tie[b];
    if (byDraw !== 0) return byDraw;
    return a - b;
  });

  chosenIndices = [indices[0], indices[1]];
}

/** Scratch space for the tie-break draws, reused so a pick allocates nothing. */
const ROSTER_TIEBREAKS: number[] = [0, 0, 0, 0];

/** Award XP to both chosen heroes and sync to units. */
export function awardHeroXP(xp: number): void {
  for (const idx of chosenIndices) {
    allHeroes[idx].xp += xp;
  }
  syncHeroXP();
}

/** Push XP from state → spawned hero units.
 *  Uses AddHeroXP to avoid the SetHeroXP bug where exceeding the XP table
 *  jumps straight to max level. */
function syncHeroXP(): void {
  for (const { unit, dataIdx } of spawnedHeroes) {
    if (unit.handle == null || GetUnitTypeId(unit.handle) === 0) continue;
    const current = GetHeroXP(unit.handle);
    const target = allHeroes[dataIdx].xp;
    const delta = target - current;
    if (delta > 0) {
      AddHeroXP(unit.handle, delta, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-round lifecycle
// ---------------------------------------------------------------------------

/** Reset per-round hero state. Called at the start of each round.
 *  Snapshots hero items if heroes are still alive (e.g. victory without unsummoning). */
export function resetHeroState(): void {
  if (heroesSpawned && spawnedHeroes.length > 0) {
    snapshotHeroItems();
  }
  releaseMercUnit(); // snapshots merc items if its unit still exists
  heroesSpawned = false;
  spawnedHeroes = [];
  peasantOwnerMap.clear();
}


/** Apply saved spell levels to a hero by calling SelectHeroSkill. */
function applySpells(hero: Unit, spells: Record<string, number>): void {
  for (const [abilRaw, level] of Object.entries(spells)) {
    const abilId = FourCC(abilRaw);
    for (let i = 0; i < level; i++) {
      SelectHeroSkill(hero.handle, abilId);
    }
  }
}

/** Transfer peasants from hero players to peasant players, and spawn heroes. */
function transferPeasantsAndSpawnHeroes(casterX: number, casterY: number): void {
  const humans = getHumanPlayers();
  const heroPlayers = chosenHeroPlayers.map(i => MapPlayer.fromIndex(i)!);
  const peasantPlayers = humans.filter(p => !chosenHeroPlayers.includes(p.id));

  // Find all peasants on the map and transfer hero players' peasants to peasant players
  forEachPeasant(u => {
    const owner = MapPlayer.fromHandle(GetOwningPlayer(u));
    if (owner == null) return;
    // Only transfer peasants owned by hero players
    if (!chosenHeroPlayers.includes(owner.id)) return;
    peasantOwnerMap.set(u, owner);
    // Round-robin assign to peasant players
    if (peasantPlayers.length > 0) {
      const target = peasantPlayers[peasantOwnerMap.size % peasantPlayers.length];
      SetUnitOwner(u, target.handle, true);
    }
  });

  // Spawn heroes — distribute across hero players
  spawnHeroes(heroPlayers, casterX, casterY);

  // Pan cameras to heroes for players who lost peasant control
  if (peasantPlayers.length > 0) {
    for (const { unit } of spawnedHeroes) {
      PanCameraToTimedForPlayer(unit.owner.handle, unit.x, unit.y, 0.5);
    }
  }

  // Increment control count
  for (const pi of chosenHeroPlayers) {
    heroControlCount[pi]++;
  }

  // Spawn the mercenary (if owned and alive) alongside the heroes
  spawnMercWithHeroes(casterX, casterY, spawnedHeroes.map(s => s.unit.owner.id));
}

/** Create one hero unit from allHeroes[dataIdx] with XP, skills and items
 *  applied. Tome stat bonuses land one frame later (hero stats must finalize
 *  first). Shared by round summons and the inter-round lobby hero display. */
/**
 * The ONE way a hero is put on the map.
 *
 * Everywhere a hero appears goes through here -- the mid-round summon, the DPS
 * test, the boss fight, the inter-round lobby display and the save chooser --
 * so all of them show the same hero: its level, its skills, its items and its
 * tomes. The callers differ only in WHICH heroes they stand up, WHO owns them
 * and WHERE, which is the whole of the difference between those five cases.
 *
 * It takes the hero's DATA rather than an index into the live roster, because
 * the save chooser is displaying a party that is not loaded and must not be:
 * picking a save must not overwrite the run you are looking at it from.
 */
export function spawnHeroFromData(
  data: HeroData, owner: MapPlayer, x: number, y: number,
): Unit | null {
  if (data.typeId === 0) return null;
  const hero = Unit.create(owner, data.typeId, x, y, 270);
  if (hero == null) return null;
  if (data.xp > 0) SetHeroXP(hero.handle, data.xp, true);
  applySpells(hero, data.skills);
  giveItems(hero, data.items);
  nextFrame(() => {
    const h = hero.handle;
    if (GetUnitTypeId(h) === 0) return; // removed before the frame elapsed
    if (data.tomeStr !== 0) SetHeroStr(h, GetHeroStr(h, false) + data.tomeStr, true);
    if (data.tomeAgi !== 0) SetHeroAgi(h, GetHeroAgi(h, false) + data.tomeAgi, true);
    if (data.tomeInt !== 0) SetHeroInt(h, GetHeroInt(h, false) + data.tomeInt, true);
    if (data.tomeHP !== 0) {
      BlzSetUnitMaxHP(h, BlzGetUnitMaxHP(h) + data.tomeHP);
      SetUnitState(h, UNIT_STATE_LIFE, BlzGetUnitMaxHP(h));
    }
  });
  return hero;
}

/** The same, for a hero in the live roster. */
function spawnHeroUnit(dataIdx: number, owner: MapPlayer, x: number, y: number): Unit | null {
  return spawnHeroFromData(allHeroes[dataIdx], owner, x, y);
}

/** Spawn the 2 chosen heroes. Each owner in the array gets one hero.
 *  If only 1 owner, both heroes go to that player.
 *  Fires onHeroesSpawnedCallback after one frame. */
export function spawnHeroes(owners: MapPlayer[], x: number, y: number): void {
  for (let i = 0; i < chosenIndices.length; i++) {
    const dataIdx = chosenIndices[i];
    const owner = owners[math.min(i, owners.length - 1)];
    const hero = spawnHeroUnit(dataIdx, owner, x, y);
    if (hero != null) {
      spawnedHeroes.push({ unit: hero, dataIdx });
    }
  }
  // Wait one frame for hero stats (XP/skills) to finalize, then register
  // death triggers and notify (tome bonuses are applied by spawnHeroUnit)
  nextFrame(() => {
    for (const { unit } of spawnedHeroes) {
      const deathTrig = Trigger.create();
      TriggerRegisterUnitEvent(deathTrig.handle, unit.handle, EVENT_UNIT_DEATH);
      deathTrig.addAction(() => {
        // Check if all heroes are dead
        if (spawnedHeroes.every(s => GetUnitState(s.unit.handle, UNIT_STATE_LIFE) <= 0)) {
          endHeroState();
          if (onAllHeroesDeadCallback != null) onAllHeroesDeadCallback();
        }
      });
    }
    if (onHeroesSpawnedCallback != null) onHeroesSpawnedCallback(getSpawnedHeroes());
  });
}

// ---------------------------------------------------------------------------
// End hero state — restore peasant control, remove heroes
// ---------------------------------------------------------------------------

/** Remove the units spawned by the last spawnHeroes() and forget them.
 *
 *  endHeroState cannot do this job: it only sweeps units owned by HUMAN
 *  players, and the sparring match's heroes belong to the hidden check player. It
 *  also clears the list, which the DPS timer's own teardown never did -- it
 *  destroyed the units and left their entries behind, so a second spawn would
 *  have appended to a list still holding dead handles. */
export function clearSpawnedHeroUnits(): void {
  for (const s of spawnedHeroes) {
    if (GetUnitTypeId(s.unit.handle) !== 0) RemoveUnit(s.unit.handle);
  }
  spawnedHeroes = [];
}

/** End hero summoning: snapshot items, remove heroes and their summons,
 *  restore peasant ownership, remove unsummon ability from all peasants. */
export function endHeroState(): void {
  if (!heroesSpawned) return;

  // Snapshot items before removing heroes; same for the mercenary, whose
  // unit is removed by the sweep below
  snapshotHeroItems();
  releaseMercUnit();

  // Remove heroes and anything they summoned (not kill — avoids dead hero
  // portraits in the UI). Human players only ever own peasants outside hero
  // mode, so any non-peasant unit they own is hero-related and safe to remove.
  const humanIds = getHumanPlayers().map(p => p.id);
  forEachUnitInWorld(u => {
    if (GetUnitTypeId(u) === PEASANT_ID) return;
    if (!humanIds.includes(GetPlayerId(GetOwningPlayer(u)))) return;
    RemoveUnit(u);
  });
  spawnedHeroes = [];
  heroesSpawned = false;

  // Restore peasant ownership and pan cameras back for players regaining peasant control
  for (const [peasantHandle, originalOwner] of peasantOwnerMap) {
    if (GetUnitTypeId(peasantHandle) !== 0) { // unit still exists
      if (originalOwner.slotState === PLAYER_SLOT_STATE_PLAYING) {
        SetUnitOwner(peasantHandle, originalOwner.handle, true);
        PanCameraToTimedForPlayer(originalOwner.handle, GetUnitX(peasantHandle), GetUnitY(peasantHandle), 0.5);
      } else {
        // Original owner left the game — their peasant dies instead of
        // being restored to an empty slot
        KillUnit(peasantHandle);
      }
    }
  }
  peasantOwnerMap.clear();

  // Remove unsummon ability from all peasants
  forEachPeasant(u => UnitRemoveAbility(u, UNSUMMON_ABILITY_ID));
}

/** Grant the Unsummon Heroes ability to all peasants. Called when all creeps are dead. */
/** How many heroes are fielded this round. Diagnostics for the tests, which
 *  need to see that a roster was chosen without spawning anybody. */
export function getChosenHeroCount(): number {
  return chosenIndices.length;
}

export function grantUnsummonToAllPeasants(): void {
  forEachPeasant(u => UnitAddAbility(u, UNSUMMON_ABILITY_ID));
}

// ---------------------------------------------------------------------------
// Item state tracking
// ---------------------------------------------------------------------------

/** Snapshot the current inventory of all spawned heroes into persistent state. */
function snapshotHeroItems(): void {
  for (const { unit, dataIdx } of spawnedHeroes) {
    allHeroes[dataIdx].items = getInventoryItemIds(unit.handle);
  }
}

/** Get the spawned hero units. */
export function getSpawnedHeroes(): Unit[] {
  return spawnedHeroes.map(s => s.unit);
}

/** Whether heroes are currently summoned (gameplay hero mode is active). */
export function areHeroesSpawned(): boolean {
  return heroesSpawned;
}

// ---------------------------------------------------------------------------
// Inter-round lobby hero display + reroll
// ---------------------------------------------------------------------------

/** Neutral display copies of the hero roster, inter-round lobby only.
 *  (Terrain cleanup removes the units; clearInterRoundLobbyHeroes drops the handles.) */
let lobbyHeroes: Array<{ unit: Unit; dataIdx: number }> = [];

/** Forget the display units without touching the world. Pairs with the terrain
 *  sweep, which has already removed them. */
export function clearInterRoundLobbyHeroes(): void {
  lobbyHeroes = [];
}

/** Stand the hero roster in the inter-round lobby, hero i on positions[i].
 *
 *  ALL FOUR are shown, not just the two that fought last round. The other two
 *  are equally yours -- equally rerollable, equally able to hold gear -- and
 *  showing only the pair that happened to be summoned made the inter-round lobby
 *  misrepresent the roster. Nothing shows before Summon Heroes is bought,
 *  because until then there is no roster to speak of.
 *
 *  Additive: it fills in whoever is missing and leaves standing heroes alone.
 *  That is what makes it safe to call mid-lobby after a purchase. A rebuild
 *  would recreate each hero from HeroData and silently drop anything a player
 *  had handed the display unit since the inter-round lobby opened. */
export function syncInterRoundLobbyHeroes(positions: Array<{ x: number; y: number }>): void {
  if (!isSummonUpgradePurchased()) return;
  for (let dataIdx = 0; dataIdx < allHeroes.length; dataIdx++) {
    if (allHeroes[dataIdx].typeId === 0) continue;
    if (lobbyHeroes.some(e => e.dataIdx === dataIdx)) continue;
    const pos = positions[math.min(dataIdx, positions.length - 1)];
    const unit = createRosterHeroUnit(dataIdx, pos.x, pos.y);
    if (unit != null) lobbyHeroes.push({ unit, dataIdx });
  }
}

/** The display units currently standing in the inter-round lobby. For tests,
 *  which need to ask who owns them and where they stand. */
export function getInterRoundLobbyHeroUnits(): Unit[] {
  return lobbyHeroes.map(e => e.unit);
}

/** Whether this roster slot holds someone the player has rolled but not yet
 *  met, and so is displayed as a question mark.
 *
 *  DERIVED, not tracked. The snapshot is the roster as it stood when this
 *  inter-round lobby visit began, so "different from the snapshot" is exactly
 *  "rolled since you walked in". Two things fall out for free: Reset Purchases
 *  restores the snapshot, which un-conceals everything without a second code
 *  path, and a mercenary hired into an empty slot differs from nothing, so a
 *  contract purchase conceals itself the same way a reroll does. */
function heroConcealed(dataIdx: number): boolean {
  if (lobbyHeroSnapshot == null) return false;
  return lobbyHeroSnapshot[dataIdx].typeId !== allHeroes[dataIdx].typeId;
}

/** The roster unit for a hero slot: the hero, or the "?" standing in for them.
 *
 *  The placeholder still carries the kit. What a reroll keeps is information
 *  the player is entitled to -- it is WHO they got that is being withheld. */
function createRosterHeroUnit(dataIdx: number, x: number, y: number): Unit | null {
  // Neutral EXTRA, not neutral passive. Both are allied to the humans, and the
  // only difference between them is shared vision -- which passive has. Owning
  // the display roster by passive therefore lit the whole lobby through six
  // heroes' sight radii, giving away ground the players' own units had not
  // walked. Extra is what the water border and the circles already use for
  // exactly this reason.
  const owner = getNeutralExtra();
  if (!heroConcealed(dataIdx)) {
    const hero = spawnHeroUnit(dataIdx, owner, x, y);
    if (hero != null) hero.invulnerable = true;
    return hero;
  }
  return createPlaceholder(owner, x, y, allHeroes[dataIdx].items);
}

/** Reroll the inter-round lobby hero represented by unitHandle: swap its slot in
 *  allHeroes to a random hero type not currently in the pool of 4, keeping
 *  XP, items and tome bonuses (skills are hero-specific and reset), and
 *  replace the inter-round lobby unit in place. Returns false if unitHandle is not a
 *  inter-round lobby hero or no candidate types remain. */
/** Next hero off the shared reroll queue.
 *
 *  ONE queue for the whole inter-round lobby, not a fresh roll per hero: rerolling your
 *  other hero hands you the same hero the first one would have got. The queue
 *  is the seeded stream (rng.ts) walked from a saved cursor, so it is identical
 *  every time a given save is loaded -- reloading to fish for a better result
 *  gets you the same one back.
 *
 *  `candidates` excludes every type currently in the pool of four, including
 *  the hero being replaced, so the exclusion set does not depend on which hero
 *  was targeted -- which is what makes both rerolls agree. */
function nextQueuedHeroType(candidates: number[]): number {
  if (candidates.length === 0) return 0;
  // Bounded: each step either lands on a candidate or skips a type already in
  // play, and there are only so many hero types.
  for (let step = 0; step < 256; step++) {
    const pos = gameState.heroQueuePos + step;
    const pick = HERO_POOL[seededValueAt(pos) % HERO_POOL.length];
    const id = FourCC(pick);
    if (candidates.includes(id)) {
      gameState.heroQueuePos = pos + 1;
      return id;
    }
  }
  // Stream never offered an eligible type; fall back so a reroll still resolves.
  gameState.heroQueuePos += 1;
  return candidates[0];
}

export function rerollInterRoundLobbyHero(unitHandle: unit): boolean {
  const entry = lobbyHeroes.find(e => e.unit.handle === unitHandle);
  if (entry == null) return false;

  // Exclude the roster as it stands AND the roster you walked in with. The
  // second half matters because the result is hidden: with heroes A and B,
  // rerolling A to C and then B to A leaves two question marks that reveal as
  // C and A, and the player -- who cannot see either -- has no way to tell that
  // one of their rerolls handed back a hero they already had.
  const currentTypes = allHeroes.map(h => h.typeId);
  const startedWith = lobbyHeroSnapshot == null ? [] : lobbyHeroSnapshot.map(h => h.typeId);
  const candidates = HERO_POOL.map(n => FourCC(n))
    .filter(id => !currentTypes.includes(id) && !startedWith.includes(id));
  if (candidates.length === 0) return false;

  const data = allHeroes[entry.dataIdx];

  // Items follow the hero. The replacement is rebuilt from HeroData, so
  // anything picked up onto the LOBBY unit has to be written back first --
  // otherwise the swap silently drops whatever the player just handed over.
  const carried: number[] = [];
  for (let slot = 0; slot < 6; slot++) {
    const it = entry.unit.getItemInSlot(slot);
    if (it != null) carried.push(it.typeId);
  }
  data.items = carried;

  data.typeId = nextQueuedHeroType(candidates);
  data.skills = {};

  const x = entry.unit.x;
  const y = entry.unit.y;
  RemoveUnit(entry.unit.handle);
  // Now concealed by construction -- the type just changed, so this comes back
  // as the question mark rather than the hero.
  const replacement = createRosterHeroUnit(entry.dataIdx, x, y);
  if (replacement != null) entry.unit = replacement;
  return true;
}

// ---------------------------------------------------------------------------
// Inter-round lobby snapshot — pairs with gameState's inter-round lobby snapshot so the inter-round lobby's
// "revert purchases" zone also undoes rerolls
// ---------------------------------------------------------------------------

function cloneHero(h: HeroData): HeroData {
  return {
    typeId: h.typeId, xp: h.xp,
    skills: { ...h.skills }, items: [...h.items],
    tomeStr: h.tomeStr, tomeAgi: h.tomeAgi, tomeInt: h.tomeInt, tomeHP: h.tomeHP,
  };
}

let lobbyHeroSnapshot: HeroData[] | null = null;

/** Snapshot hero data on inter-round lobby entry, for revert. */
export function saveHeroInterRoundLobbySnapshot(): void {
  lobbyHeroSnapshot = allHeroes.map(h => cloneHero(h));
}

/** Restore hero data from the inter-round lobby snapshot (undoes rerolls). */
export function revertHeroesToInterRoundLobbySnapshot(): void {
  if (lobbyHeroSnapshot == null) return;
  for (let i = 0; i < 4; i++) {
    allHeroes[i] = cloneHero(lobbyHeroSnapshot[i]);
  }
}

/** Find the allHeroes index for a spawned hero unit, or -1 if not a spawned hero. */
function spawnedDataIndexOf(unitHandle: unit): number {
  for (const { unit, dataIdx } of spawnedHeroes) {
    if (unit.handle === unitHandle) return dataIdx;
  }
  return -1;
}

export function initHeroes(): void {
  // Summon Heroes spell trigger
  const spellTrigger = Trigger.create();
  spellTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  spellTrigger.addAction(() => {
    if (GetSpellAbilityId() !== SUMMON_ABILITY_ID) return;
    if (!isInGameplay()) return;
    if (heroesSpawned) return;

    const caster = Unit.fromEvent();
    // Same guard as Unsummon below. No creep in the camp list carries Roar
    // today, but the ability is a repurposed standard one and the camp list
    // grows, so the check belongs here rather than in a comment.
    if (caster == null || caster.typeId !== PEASANT_ID) return;
    heroesSpawned = true;

    UnitRemoveAbility(caster.handle, SUMMON_ABILITY_ID);
    transferPeasantsAndSpawnHeroes(caster.x, caster.y);
  });

  // Unsummon Heroes spell trigger
  const unsummonTrigger = Trigger.create();
  unsummonTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  unsummonTrigger.addAction(() => {
    if (GetSpellAbilityId() !== UNSUMMON_ABILITY_ID) return;
    if (!isInGameplay()) return;
    // The caster MUST be one of ours. Unsummon Heroes is RoarNeutralHostile
    // repurposed, and four creeps in the camp list carry that same ability
    // natively as Roar -- Dire Wendigo, Dire Wolf, Wind Serpent and Sasquatch
    // Oracle. Without this check, a creep roaring at you dismissed your heroes
    // mid-fight, from an ability nobody could see it cast.
    const caster = GetTriggerUnit();
    if (caster == null || GetUnitTypeId(caster) !== PEASANT_ID) return;
    endHeroState();
  });

  // XP is granted by the creep camp system via scaleCreepStats / creep death triggers.
  // Native WC3 auto-XP is suspended on heroes when they spawn (see spawnHeroes).

  // Track hero skill learns
  const skillTrigger = Trigger.create();
  skillTrigger.registerAnyUnitEvent(EVENT_PLAYER_HERO_SKILL);
  skillTrigger.addAction(() => {
    const learner = GetTriggerUnit();
    if (learner == null) return;
    const dataIdx = spawnedDataIndexOf(learner);
    if (dataIdx < 0) return;
    const abilId = GetLearnedSkill();
    const level = GetLearnedSkillLevel();
    allHeroes[dataIdx].skills[fourCCStr(abilId)] = level;
  });

  // Tome stat bonuses by rawcode
  const TOME_BONUSES: Record<number, { str?: number; agi?: number; int?: number; hp?: number }> = {
    [FourCC('tstr')]: { str: 1 },   // Tome of Strength
    [FourCC('tdex')]: { agi: 1 },   // Tome of Agility
    [FourCC('tint')]: { int: 1 },   // Tome of Intelligence
    [FourCC('tkno')]: { str: 1, agi: 1, int: 1 }, // Tome of Knowledge
    [FourCC('tst2')]: { str: 2 },   // Tome of Strength +2
    [FourCC('tdx2')]: { agi: 2 },   // Tome of Agility +2
    [FourCC('tin2')]: { int: 2 },   // Tome of Intelligence +2
    [FourCC('manh')]: { hp: 50 },   // Manual of Health
  };

  // Track hero item pickup — snapshot inventory or record tome bonus
  const pickupTrigger = Trigger.create();
  pickupTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickupTrigger.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null) return;
    const picked = GetManipulatedItem();
    const dataIdx = spawnedDataIndexOf(u);
    if (dataIdx < 0) return;

    if (picked != null) {
      const bonus = TOME_BONUSES[GetItemTypeId(picked)];
      if (bonus != null) {
        allHeroes[dataIdx].tomeStr += bonus.str ?? 0;
        allHeroes[dataIdx].tomeAgi += bonus.agi ?? 0;
        allHeroes[dataIdx].tomeInt += bonus.int ?? 0;
        allHeroes[dataIdx].tomeHP += bonus.hp ?? 0;
        return; // consumed, not in inventory
      }
    }

    snapshotHeroItems();
  });

  // Track hero item drop — snapshot inventory into state
  const dropTrigger = Trigger.create();
  dropTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DROP_ITEM);
  dropTrigger.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null) return;
    if (spawnedDataIndexOf(u) < 0) return;
    snapshotHeroItems();
  });
}
