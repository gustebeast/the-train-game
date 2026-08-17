import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { isInGameplay } from './state';
import { registerSaveSegment } from './save';
import { SUMMON_ABILITY_ID, UNSUMMON_ABILITY_ID, PEASANT_ID } from './constants';
import { getNeutralPassive } from './teams';
import { getHumanPlayers, nextFrame, forEachUnitInWorld } from './util';
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

interface HeroData {
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
function decodeHero(raw: string): HeroData {
  const hero = emptyHero();
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
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

/** Indices into allHeroes for the 2 chosen this round. Persisted via save segment. */
let chosenIndices: [number, number] = [0, 1];
let chosenFromSave = false;

// Persist chosenIndices as "ci" segment: "0,1" format
registerSaveSegment('ci',
  () => tostring(chosenIndices[0]) + ',' + tostring(chosenIndices[1]),
  (raw) => {
    const [a, b] = string.match(raw, '(%d+),(%d+)');
    if (a != null && b != null) {
      chosenIndices = [tonumber(a) ?? 0, tonumber(b) ?? 1];
      chosenFromSave = true;
    }
  },
  () => {
    chosenIndices = [0, 1];
    chosenFromSave = false;
  },
);

// ---------------------------------------------------------------------------
// Last summoned heroes — shown in the lobby for rerolling
// ---------------------------------------------------------------------------

/** Indices into allHeroes of the heroes summoned in the most recent round.
 *  Empty if Summon Heroes wasn't used. Cleared at round start (load.ts). */
let lastSummonedIndices: number[] = [];

registerSaveSegment('ls',
  () => lastSummonedIndices.join(','),
  (raw) => {
    const loaded: number[] = [];
    for (const [val] of string.gmatch(raw, '([^,]+)')) {
      const idx = tonumber(val);
      if (idx != null && idx >= 0 && idx < 4) loaded.push(idx);
    }
    lastSummonedIndices = loaded;
  },
  () => { lastSummonedIndices = []; },
);

/** Forget the previous round's summons. Called when a new round starts. */
export function clearLastSummoned(): void {
  lastSummonedIndices = [];
}

/** Whether heroes were summoned in the previous round (drives lobby display + reroll stock). */
export function hadSummonLastRound(): boolean {
  return lastSummonedIndices.length > 0;
}

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
  if (heroPlayersFromSave) {
    heroPlayersFromSave = false;
    return;
  }
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
  chooseHeroPlayers();
}

/** Choose the 2 heroes with the lowest XP from the 4.
 *  If all XP is equal, pick 2 at random. Sets chosenIndices. */
export function chooseHeroes(): void {
  if (chosenFromSave) {
    chosenFromSave = false;
    return;
  }
  const indices = [0, 1, 2, 3];

  // Sort by XP ascending
  indices.sort((a, b) => allHeroes[a].xp - allHeroes[b].xp);

  const allSameXP = allHeroes.every(h => h.xp === allHeroes[0].xp);
  if (allSameXP) {
    // Shuffle for random pick
    shuffle(indices);
  }

  chosenIndices = [indices[0], indices[1]];
}

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
 *  first). Shared by round summons and the lobby hero display. */
function spawnHeroUnit(dataIdx: number, owner: MapPlayer, x: number, y: number): Unit | null {
  const data = allHeroes[dataIdx];
  if (data.typeId === 0) return null;
  const hero = Unit.create(owner, data.typeId, x, y, 270);
  if (hero == null) return null;
  if (data.xp > 0) SetHeroXP(hero.handle, data.xp, true);
  applySpells(hero, data.skills);
  for (const itemId of data.items) {
    UnitAddItem(hero.handle, CreateItem(itemId, hero.x, hero.y)!);
  }
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
export function grantUnsummonToAllPeasants(): void {
  forEachPeasant(u => UnitAddAbility(u, UNSUMMON_ABILITY_ID));
}

// ---------------------------------------------------------------------------
// Item state tracking
// ---------------------------------------------------------------------------

/** Snapshot the current inventory of all spawned heroes into persistent state. */
function snapshotHeroItems(): void {
  for (const { unit, dataIdx } of spawnedHeroes) {
    const h = unit.handle;
    const items: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const it = UnitItemInSlot(h, slot);
      if (it != null) {
        const id = GetItemTypeId(it);
        if (id !== 0) items.push(id);
      }
    }
    allHeroes[dataIdx].items = items;
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
// Lobby hero display + reroll
// ---------------------------------------------------------------------------

/** Neutral display copies of last round's summoned heroes, lobby only.
 *  (Terrain cleanup removes the units; the list is rebuilt each lobby.) */
let lobbyHeroes: Array<{ unit: Unit; dataIdx: number }> = [];

/** Spawn last round's summoned heroes as neutral lobby units, one per
 *  position (extras stack on the last position). No-op if Summon Heroes
 *  wasn't used last round. */
export function spawnLobbyHeroes(positions: Array<{ x: number; y: number }>): void {
  lobbyHeroes = [];
  const owner = getNeutralPassive();
  lastSummonedIndices.forEach((dataIdx, i) => {
    const pos = positions[math.min(i, positions.length - 1)];
    const hero = spawnHeroUnit(dataIdx, owner, pos.x, pos.y);
    if (hero != null) {
      hero.invulnerable = true;
      lobbyHeroes.push({ unit: hero, dataIdx });
    }
  });
}

/** Reroll the lobby hero represented by unitHandle: swap its slot in
 *  allHeroes to a random hero type not currently in the pool of 4, keeping
 *  XP, items and tome bonuses (skills are hero-specific and reset), and
 *  replace the lobby unit in place. Returns false if unitHandle is not a
 *  lobby hero or no candidate types remain. */
export function rerollLobbyHero(unitHandle: unit): boolean {
  const entry = lobbyHeroes.find(e => e.unit.handle === unitHandle);
  if (entry == null) return false;

  const currentTypes = allHeroes.map(h => h.typeId);
  const candidates = HERO_POOL.map(n => FourCC(n)).filter(id => !currentTypes.includes(id));
  if (candidates.length === 0) return false;

  const data = allHeroes[entry.dataIdx];
  data.typeId = candidates[GetRandomInt(0, candidates.length - 1)];
  data.skills = {};

  const x = entry.unit.x;
  const y = entry.unit.y;
  RemoveUnit(entry.unit.handle);
  const replacement = spawnHeroUnit(entry.dataIdx, getNeutralPassive(), x, y);
  if (replacement != null) {
    replacement.invulnerable = true;
    entry.unit = replacement;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lobby snapshot — pairs with gameState's lobby snapshot so the lobby's
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

/** Snapshot hero data on lobby entry, for revert. */
export function saveHeroLobbySnapshot(): void {
  lobbyHeroSnapshot = allHeroes.map(h => cloneHero(h));
}

/** Restore hero data from the lobby snapshot (undoes rerolls). */
export function revertHeroesToLobbySnapshot(): void {
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

    heroesSpawned = true;
    const caster = Unit.fromEvent();
    if (caster == null) return;

    UnitRemoveAbility(caster.handle, SUMMON_ABILITY_ID);
    transferPeasantsAndSpawnHeroes(caster.x, caster.y);
    // Remember for the next lobby's hero display/reroll
    lastSummonedIndices = [chosenIndices[0], chosenIndices[1]];
  });

  // Unsummon Heroes spell trigger
  const unsummonTrigger = Trigger.create();
  unsummonTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  unsummonTrigger.addAction(() => {
    if (GetSpellAbilityId() !== UNSUMMON_ABILITY_ID) return;
    if (!isInGameplay()) return;
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
