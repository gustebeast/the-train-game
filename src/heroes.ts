import { MapPlayer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { gameState, isInGameplay } from './state';

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

/** Mapping of hero unit type (FourCC) → 4 learnable ability IDs (FourCC).
 *  Order: 3 regular abilities, then ultimate. */
const HERO_ABILITIES: Record<string, [string, string, string, string]> = {
  // Human
  [Units.Paladin]:       [Abilities.HolyLight, Abilities.DivineShield, Abilities.DevotionAura, Abilities.Resurrection],
  [Units.Archmage]:      [Abilities.Blizzard, Abilities.SummonWaterElemental, Abilities.BrillianceAura, Abilities.MassTeleport],
  [Units.MountainKing]:  [Abilities.StormBolt, Abilities.ThunderClap, Abilities.Bash, Abilities.Avatar],
  [Units.BloodMage]:     [Abilities.FlameStrike, Abilities.Banish, Abilities.SiphonMana, Abilities.Phoenix],
  // Orc
  [Units.Blademaster]:      [Abilities.WindWalk, Abilities.MirrorImage, Abilities.CriticalStrike, Abilities.Bladestorm],
  [Units.FarSeer]:           [Abilities.ChainLightning, Abilities.FarSight, Abilities.FeralSpirit, Abilities.Earthquake],
  [Units.TaurenChieftain]:   [Abilities.Shockwave, Abilities.WarStomp, Abilities.EnduranceAura, Abilities.Reincarnation],
  [Units.ShadowHunter]:      [Abilities.HealingWave, Abilities.Hex, Abilities.SerpentWard, Abilities.BigBadVoodoo],
  // Undead
  [Units.DeathKnight]: [Abilities.DeathCoil, Abilities.DeathPact, Abilities.UnholyAura, Abilities.AnimateDead],
  [Units.Lich]:        [Abilities.FrostNova, Abilities.FrostArmor, Abilities.DarkRitual, Abilities.DeathAndDecay],
  [Units.Dreadlord]:   [Abilities.CarrionSwarm, Abilities.Sleep, Abilities.VampiricAura, Abilities.Inferno],
  [Units.CryptLord]:   [Abilities.Impale, Abilities.SpikedCarapace, Abilities.CarrionBeetles, Abilities.LocustSwarm],
  // Night Elf
  [Units.DemonHunter]:         [Abilities.ManaBurn, Abilities.Immolation, Abilities.Evasion, Abilities.Metamorphosis],
  [Units.KeeperOfTheGrove]:    [Abilities.EntanglingRoots, Abilities.ForceOfNature, Abilities.ThornsAura, Abilities.Tranquility],
  [Units.PriestessOfTheMoon]:  [Abilities.Scout, Abilities.SearingArrows, Abilities.TrueshotAura, Abilities.Starfall],
  [Units.Warden]:              [Abilities.FanOfKnives, Abilities.Blink, Abilities.ShadowStrike, Abilities.Vengeance],
  // Tavern
  [Units.Beastmaster]:  [Abilities.SummonBear, Abilities.SummonQuilbeast, Abilities.SummonHawk, Abilities.Stampede],
  [Units.DarkRanger]:   [Abilities.Silence, Abilities.BlackArrow, Abilities.LifeDrain, Abilities.Charm],
  [Units.PitLord]:      [Abilities.RainOfFire, Abilities.HowlOfTerror, Abilities.CleavingAttack, Abilities.Doom],
  [Units.Tinker]:       [Abilities.PocketFactory, Abilities.ClusterRockets, Abilities.EngineeringUpgrade, Abilities.RoboGoblin],
  [Units.Firelord]:     [Abilities.SoulBurn, Abilities.SummonLavaSpawn, Abilities.Incinerate, Abilities.Volcano],
  [Units.Alchemist]:    [Abilities.HealingSpray, Abilities.ChemicalRage, Abilities.AcidBomb, Abilities.Transmute],
  [Units.Brewmaster]:   [Abilities.BreathOfFire, Abilities.DrunkenHaze, Abilities.DrunkenBrawler, Abilities.StormEarthAndFire],
  [Units.SeaWitch]:     [Abilities.ForkedLightning, Abilities.FrostArrows, Abilities.ManaShield, Abilities.Tornado],
};

/** Pre-computed FourCC lookup: hero typeId (int) → ability IDs (int[]). */
const heroAbilityIds = new Map<number, number[]>();
for (const [heroRaw, abilRaws] of Object.entries(HERO_ABILITIES)) {
  heroAbilityIds.set(FourCC(heroRaw), abilRaws.map(a => FourCC(a)));
}

/** Encode 4 ability levels as a single number: a0*1000 + a1*100 + a2*10 + a3. */
function encodeSkills(hero: Unit): number {
  const abilities = heroAbilityIds.get(hero.typeId);
  if (abilities == null) return 0;
  let encoded = 0;
  for (let i = 0; i < 4; i++) {
    const level = GetUnitAbilityLevel(hero.handle, abilities[i]);
    encoded += level * math.floor(10 ** (3 - i));
  }
  return encoded;
}

/** Decode a skill number and apply levels to a hero via SelectHeroSkill. */
function decodeAndApplySkills(hero: Unit, encoded: number): void {
  const abilities = heroAbilityIds.get(hero.typeId);
  if (abilities == null || encoded === 0) return;
  for (let i = 0; i < 4; i++) {
    const level = math.floor(encoded / 10 ** (3 - i)) % 10;
    for (let j = 0; j < level; j++) {
      SelectHeroSkill(hero.handle, abilities[i]);
    }
  }
}

/** Spawned hero unit references (populated when ability is used). */
let spawnedHeroes: Unit[] = [];

/** Whether heroes have been summoned this round. */
let heroesSpawned = false;

/** Select 2 heroes and store them in gameState.
 *  - If heroes were spawned this round, pick the 2 with the lowest XP
 *    (random if all tied), preserving their XP and skills.
 *  - Otherwise pick 2 at random with 0 XP. */
export function selectHeroes(): void {
  // Collect surviving hero data from spawned units
  const heroData: { typeId: number; xp: number; skills: number }[] = [];
  for (const hero of spawnedHeroes) {
    if (hero.handle != null && GetUnitTypeId(hero.handle) !== 0) {
      heroData.push({
        typeId: hero.typeId,
        xp: GetHeroXP(hero.handle),
        skills: encodeSkills(hero),
      });
    }
  }

  let chosen: { typeId: number; xp: number; skills: number }[];

  if (heroData.length < 2) {
    // No spawned heroes (game start or heroes never summoned) — pick 2 random
    const available = HERO_POOL.map(id => FourCC(id));
    const picked: { typeId: number; xp: number; skills: number }[] = [];
    for (let i = 0; i < 2 && available.length > 0; i++) {
      const idx = GetRandomInt(0, available.length - 1);
      picked.push({ typeId: available[idx], xp: 0, skills: 0 });
      available.splice(idx, 1);
    }
    chosen = picked;
  } else if (heroData.length === 2) {
    chosen = heroData;
  } else {
    // More than 2 heroes: pick the 2 with lowest XP
    heroData.sort((a, b) => a.xp - b.xp);
    const allSameXP = heroData.every(h => h.xp === heroData[0].xp);
    if (allSameXP) {
      for (let i = heroData.length - 1; i > 0; i--) {
        const j = GetRandomInt(0, i);
        [heroData[i], heroData[j]] = [heroData[j], heroData[i]];
      }
    }
    chosen = heroData.slice(0, 2);
  }

  gameState.hero1Type = chosen[0].typeId;
  gameState.hero1XP = chosen[0].xp;
  gameState.hero1Skills = chosen[0].skills;
  gameState.hero2Type = chosen[1].typeId;
  gameState.hero2XP = chosen[1].xp;
  gameState.hero2Skills = chosen[1].skills;
}

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

/** Spawn the 2 heroes from gameState at the given position. */
function spawnHeroes(owner: MapPlayer, x: number, y: number): void {
  const heroes = [
    { typeId: gameState.hero1Type, xp: gameState.hero1XP, skills: gameState.hero1Skills },
    { typeId: gameState.hero2Type, xp: gameState.hero2XP, skills: gameState.hero2Skills },
  ];
  for (const { typeId, xp, skills } of heroes) {
    if (typeId === 0) continue;
    const hero = Unit.create(owner, typeId, x, y, 270);
    if (hero != null) {
      spawnedHeroes.push(hero);
      if (xp > 0) SetHeroXP(hero.handle, xp, true);
      if (skills > 0) decodeAndApplySkills(hero, skills);
    }
  }
}

export function initHeroes(): void {
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
}
