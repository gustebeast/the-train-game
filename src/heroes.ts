import { MapPlayer, Timer, Trigger, Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { isInGameplay } from './state';
import { registerSaveSegment } from './save';
import { log } from './debug';
import { SUMMON_ABILITY_ID } from './constants';

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
    parts.push('it=' + hero.items.map(id => tostring(id)).join(','));
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

// Register save segments h1–h4
for (let i = 0; i < 4; i++) {
  const idx = i;
  registerSaveSegment('h' + (idx + 1),
    () => encodeHero(allHeroes[idx]),
    (raw) => { allHeroes[idx] = decodeHero(raw); },
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
);

/** Spawned hero units, parallel to chosenIndices. */
let spawnedHeroes: Unit[] = [];

/** Whether heroes have been summoned this round. */
let heroesSpawned = false;

/** Callback invoked after heroes are summoned (with a 1-frame delay). */
let onHeroesSpawnedCallback: ((heroes: Unit[]) => void) | null = null;

/** Register a callback to run after heroes are summoned. */
export function onHeroesSpawned(cb: (heroes: Unit[]) => void): void {
  onHeroesSpawnedCallback = cb;
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
    allHeroes[i] = { typeId: FourCC(available[idx]), xp: 0, skills: {}, items: [], tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
    available.splice(idx, 1);
  }
  chooseHeroes();
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
    for (let i = indices.length - 1; i > 0; i--) {
      const j = GetRandomInt(0, i);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
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
  for (let i = 0; i < spawnedHeroes.length; i++) {
    const hero = spawnedHeroes[i];
    if (hero.handle == null || GetUnitTypeId(hero.handle) === 0) continue;
    const dataIdx = chosenIndices[i];
    const current = GetHeroXP(hero.handle);
    const target = allHeroes[dataIdx].xp;
    const delta = target - current;
    if (delta > 0) {
      AddHeroXP(hero.handle, delta, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-round lifecycle
// ---------------------------------------------------------------------------

/** Reset per-round hero state. Called at the start of each round. */
export function resetHeroState(): void {
  heroesSpawned = false;
  spawnedHeroes = [];
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

/** Spawn the 2 chosen heroes at the given position. Populates spawnedHeroes.
 *  Fires onHeroesSpawnedCallback after one frame. */
export function spawnHeroes(owner: MapPlayer, x: number, y: number): void {
  for (const idx of chosenIndices) {
    const data = allHeroes[idx];
    if (data.typeId === 0) continue;
    const hero = Unit.create(owner, data.typeId, x, y, 270);
    if (hero != null) {
      spawnedHeroes.push(hero);
      if (data.xp > 0) SetHeroXP(hero.handle, data.xp, true);
      applySpells(hero, data.skills);
      // Give saved items
      for (const itemId of data.items) {
        UnitAddItem(hero.handle, CreateItem(itemId, hero.x, hero.y)!);
      }
    }
  }
  // Wait one frame for hero stats (XP/skills) to finalize, then apply tome bonuses and notify
  const t = Timer.create();
  t.start(0, false, () => {
    t.destroy();
    // Apply tome bonuses after level-up stat gains have resolved
    for (let i = 0; i < spawnedHeroes.length; i++) {
      const data = allHeroes[chosenIndices[i]];
      const h = spawnedHeroes[i].handle;
      if (data.tomeStr !== 0) SetHeroStr(h, GetHeroStr(h, false) + data.tomeStr, true);
      if (data.tomeAgi !== 0) SetHeroAgi(h, GetHeroAgi(h, false) + data.tomeAgi, true);
      if (data.tomeInt !== 0) SetHeroInt(h, GetHeroInt(h, false) + data.tomeInt, true);
      if (data.tomeHP !== 0) {
        BlzSetUnitMaxHP(h, BlzGetUnitMaxHP(h) + data.tomeHP);
        SetUnitState(h, UNIT_STATE_LIFE, BlzGetUnitMaxHP(h));
      }
    }
    if (onHeroesSpawnedCallback != null) onHeroesSpawnedCallback(spawnedHeroes);
  });
}

// ---------------------------------------------------------------------------
// Item state tracking
// ---------------------------------------------------------------------------

/** Snapshot the current inventory of all spawned heroes into persistent state. */
function snapshotHeroItems(): void {
  for (let i = 0; i < spawnedHeroes.length; i++) {
    const h = spawnedHeroes[i].handle;
    const dataIdx = chosenIndices[i];
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

/** Write the persistent item state over each spawned hero's inventory.
 *  Should be a no-op if state and inventory are already in sync. */
export function syncHeroItems(): void {
  for (let i = 0; i < spawnedHeroes.length; i++) {
    const h = spawnedHeroes[i].handle;
    const dataIdx = chosenIndices[i];
    const savedItems = allHeroes[dataIdx].items;

    // Read current inventory
    const currentItems: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const it = UnitItemInSlot(h, slot);
      currentItems.push(it != null ? GetItemTypeId(it) : 0);
    }

    // Check if they already match (no-op fast path)
    const savedSorted = [...savedItems].sort();
    const currentSorted = currentItems.filter(id => id !== 0).sort();
    if (savedSorted.length === currentSorted.length && savedSorted.every((v, j) => v === currentSorted[j])) {
      return;
    }

    // Remove all current items
    for (let slot = 0; slot < 6; slot++) {
      const it = UnitItemInSlot(h, slot);
      if (it != null) RemoveItem(it);
    }
    // Add saved items
    for (const itemId of savedItems) {
      UnitAddItem(h, CreateItem(itemId, GetUnitX(h), GetUnitY(h))!);
    }
  }
}

/** Get the spawned hero units. */
export function getSpawnedHeroes(): Unit[] {
  return spawnedHeroes;
}

/** Find which spawned hero index (0 or 1) a unit belongs to, or -1. */
function spawnedIndexOf(unitHandle: unit): number {
  for (let i = 0; i < spawnedHeroes.length; i++) {
    if (spawnedHeroes[i].handle === unitHandle) return i;
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

    spawnHeroes(caster.owner, caster.x, caster.y);
    UnitRemoveAbility(caster.handle, SUMMON_ABILITY_ID);
  });

  // XP is granted by the creep camp system via scaleCreepStats / creep death triggers.
  // Native WC3 auto-XP is suspended on heroes when they spawn (see spawnHeroes).

  // Track hero skill learns
  const skillTrigger = Trigger.create();
  skillTrigger.registerAnyUnitEvent(EVENT_PLAYER_HERO_SKILL);
  skillTrigger.addAction(() => {
    const learner = GetTriggerUnit();
    if (learner == null) return;
    const spawnIdx = spawnedIndexOf(learner);
    if (spawnIdx < 0) return;
    const dataIdx = chosenIndices[spawnIdx];
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
    const spawnIdx = spawnedIndexOf(u);
    if (spawnIdx < 0) return;

    if (picked != null) {
      const bonus = TOME_BONUSES[GetItemTypeId(picked)];
      if (bonus != null) {
        const dataIdx = chosenIndices[spawnIdx];
        allHeroes[dataIdx].tomeStr += bonus.str ?? 0;
        allHeroes[dataIdx].tomeAgi += bonus.agi ?? 0;
        allHeroes[dataIdx].tomeInt += bonus.int ?? 0;
        allHeroes[dataIdx].tomeHP += bonus.hp ?? 0;
        log('Tome consumed: ' + GetItemName(picked) + ' str+' + (bonus.str ?? 0) + ' agi+' + (bonus.agi ?? 0) + ' int+' + (bonus.int ?? 0) + ' hp+' + (bonus.hp ?? 0));
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
    const spawnIdx = spawnedIndexOf(u);
    if (spawnIdx < 0) return;
    snapshotHeroItems();
  });
}
