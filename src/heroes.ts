import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { isInGameplay } from './state';
import { registerSaveSegment } from './save';

const SUMMON_ABILITY_ID = FourCC(Abilities.Roar);
const PEASANT_ID = FourCC(Units.Peasant);

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
}

function emptyHero(): HeroData {
  return { typeId: 0, xp: 0, skills: {} };
}

/** The 4 heroes available across rounds. Persisted via save segments. */
const allHeroes: HeroData[] = [emptyHero(), emptyHero(), emptyHero(), emptyHero()];

/** Encode one hero's data as "t=FourCC;x=XP;abilId=level;...". */
function encodeHero(hero: HeroData): string {
  if (hero.typeId === 0) return '';
  const parts: string[] = [];
  parts.push('t=' + tostring(hero.typeId));
  parts.push('x=' + tostring(hero.xp));
  for (const [k, v] of Object.entries(hero.skills)) {
    if (v > 0) parts.push(k + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Decode "t=FourCC;x=XP;abilId=level;..." into a HeroData. */
function decodeHero(raw: string): HeroData {
  const hero = emptyHero();
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    if (key === 't') {
      hero.typeId = tonumber(val) ?? 0;
    } else if (key === 'x') {
      hero.xp = tonumber(val) ?? 0;
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

/** Indices into allHeroes for the 2 chosen this round. */
let chosenIndices: [number, number] = [0, 1];

/** Spawned hero units, parallel to chosenIndices. */
let spawnedHeroes: Unit[] = [];

/** Whether heroes have been summoned this round. */
let heroesSpawned = false;

/** Returns true if the 4 heroes have been initialized. */
export function hasHeroes(): boolean {
  return allHeroes[0].typeId !== 0;
}

// ---------------------------------------------------------------------------
// Hero selection
// ---------------------------------------------------------------------------

/** Pick 4 unique random heroes and populate allHeroes. Called once at game start. */
export function initRandomHeroes(): void {
  const available = [...HERO_POOL];
  for (let i = 0; i < 4; i++) {
    const idx = GetRandomInt(0, available.length - 1);
    allHeroes[i] = { typeId: FourCC(available[idx]), xp: 0, skills: {} };
    available.splice(idx, 1);
  }
}

/** Choose the 2 heroes with the lowest XP from the 4.
 *  If all XP is equal, pick 2 at random. Sets chosenIndices. */
export function chooseHeroes(): void {
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

const XP_PER_CREEP = 100;

/** Push XP from state → spawned hero units. */
function syncHeroXP(): void {
  for (let i = 0; i < spawnedHeroes.length; i++) {
    const hero = spawnedHeroes[i];
    if (hero.handle == null || GetUnitTypeId(hero.handle) === 0) continue;
    const dataIdx = chosenIndices[i];
    SetHeroXP(hero.handle, allHeroes[dataIdx].xp, true);
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

/** Remove the Summon Heroes ability from all peasants on the map. */
function removeSummonFromAllPeasants(): void {
  const g = CreateGroup()!;
  GroupEnumUnitsInRect(g, GetWorldBounds()!, null!);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null && GetUnitTypeId(u) === PEASANT_ID) {
      UnitRemoveAbility(u, SUMMON_ABILITY_ID);
    }
  });
  DestroyGroup(g);
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

/** Spawn the 2 chosen heroes at the given position. */
function spawnHeroes(owner: MapPlayer, x: number, y: number): void {
  for (const idx of chosenIndices) {
    const data = allHeroes[idx];
    if (data.typeId === 0) continue;
    const hero = Unit.create(owner, data.typeId, x, y, 270);
    if (hero != null) {
      spawnedHeroes.push(hero);
      if (data.xp > 0) SetHeroXP(hero.handle, data.xp, true);
      applySpells(hero, data.skills);
    }
  }
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
    removeSummonFromAllPeasants();
  });

  // Award XP to both heroes when a creep dies
  const killTrigger = Trigger.create();
  killTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  killTrigger.addAction(() => {
    if (spawnedHeroes.length === 0) return;
    const dying = GetTriggerUnit();
    if (dying == null || GetOwningPlayer(dying) !== Player(PLAYER_NEUTRAL_AGGRESSIVE)) return;
    for (const idx of chosenIndices) {
      allHeroes[idx].xp += XP_PER_CREEP;
    }
    syncHeroXP();
  });

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
}
