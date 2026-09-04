import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { BOSS_ADD_ID, BOSS_ID } from './constants';
import { spawnBoss, stopBoss } from './boss';
import { getDPSCheckPlayer } from './teams';
import { registerTest, TestReporter } from './testkit';

/**
 * Balance harness for the final boss.
 *
 * Four heroes at level 10 with every ability learned and six items each, set
 * against the boss, with damage counted in both directions. One registered test
 * per composition -- `-test bfstun`, `-test bfcaster` and so on -- because the
 * harness takes no arguments.
 *
 * The heroes belong to the DPS-check player, which already runs the melee AI
 * (see teams.ts). That AI is what casts their spells: it is not a good player,
 * but it is the only automated one available, so every number here is a FLOOR
 * rather than a best case. A human microing the same fight should do better,
 * which is the direction the final tuning has to lean.
 *
 * Every composition also fields the two mercenaries the party actually brings
 * to this fight -- an Ogre Lord as the ideal one (the heaviest body and
 * hardest hitter in the Lordaeron Summer pool, with an aura and a bash) and a
 * Forest Troll High Priest as the good one (heals and inner fire, the most
 * useful support in the pool). They spawn at base stats, which is what
 * mercenaries have: only camp creeps are scaled.
 *
 * Read `heroesAlive` with care when a Paladin is in the composition: Divine
 * Shield can leave him standing alone and invulnerable long after the fight is
 * decided, so the count says "not a wipe" when it effectively was one. The
 * damage totals are the honest measure.
 */

/** How long a fight is allowed to run before it is called a loss. */
const FIGHT_SECONDS = 150;
/** Distance between the heroes' spawn and the boss. */
const ENGAGE_RANGE = 400;

/** The mercenaries every party brings: one ideal, one good. */
const MERC_TYPES: ReadonlyArray<string> = ['nogl', 'nfsh'];

/** Item ladders, by what a hero actually wants. Two ideal, two good, two
 *  decent, per the balance brief -- good items, but not a best case. */
const ITEMS = {
  /** Strength melee: damage and bulk. */
  str: [Items.ClawsOfAttackPlus15, Items.BeltOfGiantStrengthPlus6,
    Items.RingOfProtectionPlus5, Items.GlovesOfHaste,
    Items.BootsOfSpeed, Items.RingOfRegeneration],
  /** Agility melee: damage and attack speed. */
  agi: [Items.ClawsOfAttackPlus15, Items.GlovesOfHaste,
    Items.OrbOfFrost, Items.RingOfProtectionPlus4,
    Items.BootsOfSpeed, Items.RingOfRegeneration],
  /** Intelligence caster: mana to keep casting, and enough health to survive
   *  being looked at. */
  int: [Items.SobiMask, Items.PeriaptOfVitality,
    Items.CircletOfNobility, Items.MedallionOfCourage,
    Items.BootsOfSpeed, Items.RingOfRegeneration],
};

interface HeroSpec {
  type: string;
  /** The three normal abilities, each taken to level 3. */
  skills: ReadonlyArray<string>;
  /** The ultimate, taken once. */
  ultimate: string;
  items: ReadonlyArray<string>;
}

const MOUNTAIN_KING: HeroSpec = {
  type: Units.MountainKing, items: ITEMS.str,
  skills: [Abilities.StormBolt, Abilities.ThunderClap, Abilities.Bash],
  ultimate: Abilities.Avatar,
};
const TAUREN_CHIEFTAIN: HeroSpec = {
  type: Units.TaurenChieftain, items: ITEMS.str,
  skills: [Abilities.WarStomp, Abilities.EnduranceAura, Abilities.Shockwave],
  ultimate: Abilities.Reincarnation,
};
const PALADIN: HeroSpec = {
  type: Units.Paladin, items: ITEMS.int,
  skills: [Abilities.HolyLight, Abilities.DevotionAura, Abilities.DivineShield],
  ultimate: Abilities.Resurrection,
};
const BLADEMASTER: HeroSpec = {
  type: Units.Blademaster, items: ITEMS.agi,
  skills: [Abilities.CriticalStrike, Abilities.WindWalk, Abilities.MirrorImage],
  ultimate: Abilities.Bladestorm,
};
const ARCHMAGE: HeroSpec = {
  type: Units.Archmage, items: ITEMS.int,
  skills: [Abilities.Blizzard, Abilities.BrillianceAura, Abilities.SummonWaterElemental],
  ultimate: Abilities.MassTeleport,
};
const LICH: HeroSpec = {
  type: Units.Lich, items: ITEMS.int,
  skills: [Abilities.FrostNova, Abilities.FrostArmor, Abilities.DarkRitual],
  ultimate: Abilities.DeathAndDecay,
};
const FAR_SEER: HeroSpec = {
  type: Units.FarSeer, items: ITEMS.int,
  skills: [Abilities.ChainLightning, Abilities.FarSight, Abilities.FeralSpirit],
  ultimate: Abilities.Earthquake,
};
const KEEPER: HeroSpec = {
  type: Units.KeeperOfTheGrove, items: ITEMS.int,
  skills: [Abilities.EntanglingRoots, Abilities.ForceOfNature, Abilities.ThornsAura],
  ultimate: Abilities.Tranquility,
};
const CRYPT_LORD: HeroSpec = {
  type: Units.CryptLord, items: ITEMS.str,
  skills: [Abilities.Impale, Abilities.SpikedCarapace, Abilities.CarrionBeetles],
  ultimate: Abilities.LocustSwarm,
};
const DEATH_KNIGHT: HeroSpec = {
  type: Units.DeathKnight, items: ITEMS.str,
  skills: [Abilities.DeathCoil, Abilities.DeathPact, Abilities.UnholyAura],
  ultimate: Abilities.AnimateDead,
};
const DEMON_HUNTER: HeroSpec = {
  type: Units.DemonHunter, items: ITEMS.agi,
  skills: [Abilities.ManaBurn, Abilities.Immolation, Abilities.Evasion],
  ultimate: Abilities.Metamorphosis,
};
const PIT_LORD: HeroSpec = {
  type: Units.PitLord, items: ITEMS.str,
  skills: [Abilities.RainOfFire, Abilities.HowlOfTerror, Abilities.CleavingAttack],
  ultimate: Abilities.Doom,
};
const PRIESTESS: HeroSpec = {
  type: Units.PriestessOfTheMoon, items: ITEMS.agi,
  skills: [Abilities.Scout, Abilities.SearingArrows, Abilities.TrueshotAura],
  ultimate: Abilities.Starfall,
};

const WARDEN: HeroSpec = {
  type: Units.Warden, items: ITEMS.agi,
  skills: [Abilities.FanOfKnives, Abilities.ShadowStrike, Abilities.Blink],
  ultimate: Abilities.Vengeance,
};
const BEASTMASTER: HeroSpec = {
  type: Units.Beastmaster, items: ITEMS.str,
  skills: [Abilities.SummonBear, Abilities.SummonQuilbeast, Abilities.SummonHawk],
  ultimate: Abilities.Stampede,
};
const DARK_RANGER: HeroSpec = {
  type: Units.DarkRanger, items: ITEMS.agi,
  skills: [Abilities.Silence, Abilities.BlackArrow, Abilities.LifeDrain],
  ultimate: Abilities.Charm,
};
const SHADOW_HUNTER: HeroSpec = {
  type: Units.ShadowHunter, items: ITEMS.int,
  skills: [Abilities.HealingWave, Abilities.Hex, Abilities.SerpentWard],
  ultimate: Abilities.BigBadVoodoo,
};
const BLOOD_MAGE: HeroSpec = {
  type: Units.BloodMage, items: ITEMS.int,
  skills: [Abilities.FlameStrike, Abilities.Banish, Abilities.SiphonMana],
  ultimate: Abilities.Phoenix,
};
const DREADLORD: HeroSpec = {
  type: Units.Dreadlord, items: ITEMS.str,
  skills: [Abilities.CarrionSwarm, Abilities.Sleep, Abilities.VampiricAura],
  ultimate: Abilities.Inferno,
};
const FIRELORD: HeroSpec = {
  type: Units.Firelord, items: ITEMS.int,
  skills: [Abilities.SoulBurn, Abilities.SummonLavaSpawn, Abilities.Incinerate],
  ultimate: Abilities.Volcano,
};
const ALCHEMIST: HeroSpec = {
  type: Units.Alchemist, items: ITEMS.str,
  skills: [Abilities.HealingSpray, Abilities.ChemicalRage, Abilities.AcidBomb],
  ultimate: Abilities.Transmute,
};
const BREWMASTER: HeroSpec = {
  type: Units.Brewmaster, items: ITEMS.str,
  skills: [Abilities.BreathOfFire, Abilities.DrunkenHaze, Abilities.DrunkenBrawler],
  ultimate: Abilities.StormEarthAndFire,
};
const SEA_WITCH: HeroSpec = {
  type: Units.SeaWitch, items: ITEMS.agi,
  skills: [Abilities.ForkedLightning, Abilities.FrostArrows, Abilities.ManaShield],
  ultimate: Abilities.Tornado,
};
const TINKER: HeroSpec = {
  type: Units.Tinker, items: ITEMS.str,
  skills: [Abilities.PocketFactory, Abilities.ClusterRockets, Abilities.EngineeringUpgrade],
  ultimate: Abilities.RoboGoblin,
};

interface Comp { name: string; heroes: ReadonlyArray<HeroSpec> }

/** Lockdown: two stuns and a slow, with a healer and a damage dealer. */
const STUN_COMP: Comp = { name: 'stun', heroes: [MOUNTAIN_KING, TAUREN_CHIEFTAIN, PALADIN, BLADEMASTER] };
/** Nukes and control, thin on health. */
const CASTER_COMP: Comp = { name: 'caster', heroes: [ARCHMAGE, LICH, FAR_SEER, KEEPER] };
/** Bodies and sustain rather than burst. */
const TANK_COMP: Comp = { name: 'tank', heroes: [CRYPT_LORD, DEATH_KNIGHT, DEMON_HUNTER, PIT_LORD] };
/** Deliberately poor: the composition the brief expects to struggle. */
const WEAK_COMP: Comp = { name: 'weak', heroes: [PRIESTESS, ARCHMAGE, KEEPER, PALADIN] };

/** Maximum lockdown: three separate stuns plus a damage-reduction howl. */
const LOCK_COMP: Comp = { name: 'lock', heroes: [MOUNTAIN_KING, TAUREN_CHIEFTAIN, CRYPT_LORD, PIT_LORD] };
/** Pure damage, no healing and no control. */
const DPS_COMP: Comp = { name: 'dps', heroes: [BLADEMASTER, DEMON_HUNTER, WARDEN, DARK_RANGER] };
/** Heals and buffs around one damage dealer. */
const SUPPORT_COMP: Comp = { name: 'support', heroes: [PALADIN, SHADOW_HUNTER, ARCHMAGE, BLADEMASTER] };
/** Summons soak the boss while their owners plink at it. */
const SUMMON_COMP: Comp = { name: 'summon', heroes: [BEASTMASTER, FIRELORD, DREADLORD, DEATH_KNIGHT] };
/** A stun, a heal, a damage dealer and a nuker -- one of each role. */
const MIXED_COMP: Comp = { name: 'mixed', heroes: [MOUNTAIN_KING, PALADIN, BLADEMASTER, BLOOD_MAGE] };
/** The tavern heroes, which the pool can roll just as easily. */
const TAVERN_COMP: Comp = { name: 'tavern', heroes: [ALCHEMIST, BREWMASTER, SEA_WITCH, TINKER] };

function buildHero(spec: HeroSpec, x: number, y: number): Unit | null {
  const u = Unit.create(getDPSCheckPlayer(), FourCC(spec.type), x, y, 0);
  if (u == null) return null;
  SetHeroLevel(u.handle, 10, false);
  // Three points in each normal ability and one in the ultimate: exactly the
  // ten a level 10 hero has.
  for (const skill of spec.skills) {
    for (let i = 0; i < 3; i++) SelectHeroSkill(u.handle, FourCC(skill));
  }
  SelectHeroSkill(u.handle, FourCC(spec.ultimate));
  for (const item of spec.items) UnitAddItemById(u.handle, FourCC(item));
  return u;
}

function runFight(comp: Comp, t: TestReporter): void {
  const bossX = GetCameraTargetPositionX();
  const bossY = GetCameraTargetPositionY();
  const boss = spawnBoss(bossX, bossY);
  if (boss == null) { t.fail('boss', 'did not spawn'); t.done(); return; }

  const heroes: Unit[] = [];
  for (let i = 0; i < comp.heroes.length; i++) {
    // A short arc west of the boss, so all four are in reach at once.
    const hx = bossX - ENGAGE_RANGE;
    const hy = bossY + (i - 1.5) * 96;
    const hero = buildHero(comp.heroes[i], hx, hy);
    if (hero == null) { t.fail('hero' + I2S(i)!, 'did not spawn'); continue; }
    heroes.push(hero);
  }
  // The two mercenaries, a step behind the heroes.
  const mercs: Unit[] = [];
  for (let i = 0; i < MERC_TYPES.length; i++) {
    const merc = Unit.create(getDPSCheckPlayer(), FourCC(MERC_TYPES[i]),
      bossX - ENGAGE_RANGE - 96, bossY + (i === 0 ? 96 : -96), 0);
    if (merc != null) mercs.push(merc);
  }

  t.report('comp', comp.name);
  t.report('heroCount', heroes.length);
  t.report('mercCount', mercs.length);
  for (let i = 0; i < mercs.length; i++) {
    t.report('m' + I2S(i)! + 'Name', GetUnitName(mercs[i].handle)!);
  }
  for (let i = 0; i < heroes.length; i++) {
    t.report('h' + I2S(i)! + 'Name', GetUnitName(heroes[i].handle)!);
    t.report('h' + I2S(i)! + 'HP', heroes[i].maxLife);
    t.report('h' + I2S(i)! + 'Items', UnitInventorySize(heroes[i].handle));
  }
  t.report('bossHP', boss.maxLife);

  // Damage in both directions, counted from the engine's own events rather than
  // sampled health -- regeneration, healing and lifesteal would all corrupt a
  // before/after reading.
  let dealtToBoss = 0;
  let takenByParty = 0;
  let addsKilled = 0;
  const heroPlayer = getDPSCheckPlayer().handle;
  const bossPlayer = boss.owner.handle;

  const onBossSide = Trigger.create();
  TriggerRegisterPlayerUnitEvent(onBossSide.handle, bossPlayer, EVENT_PLAYER_UNIT_DAMAGED, undefined);
  onBossSide.addAction(() => {
    const hit = GetTriggerUnit();
    if (hit == null || GetUnitTypeId(hit) !== BOSS_ID) return;
    dealtToBoss += GetEventDamage();
  });

  const onHeroSide = Trigger.create();
  TriggerRegisterPlayerUnitEvent(onHeroSide.handle, heroPlayer, EVENT_PLAYER_UNIT_DAMAGED, undefined);
  onHeroSide.addAction(() => {
    // Everything the party fields, not just the heroes -- a mercenary soaking
    // a meteor is damage the boss spent, and leaving it out would read as the
    // boss doing less than it does.
    if (GetTriggerUnit() == null) return;
    takenByParty += GetEventDamage();
  });

  const onDeath = Trigger.create();
  TriggerRegisterPlayerUnitEvent(onDeath.handle, bossPlayer, EVENT_PLAYER_UNIT_DEATH, undefined);
  onDeath.addAction(() => {
    const dead = GetDyingUnit();
    if (dead != null && GetUnitTypeId(dead) === BOSS_ADD_ID) addsKilled += 1;
  });

  for (const hero of heroes) IssueTargetOrder(hero.handle, 'attack', boss.handle);
  for (const merc of mercs) IssueTargetOrder(merc.handle, 'attack', boss.handle);

  let elapsed = 0;
  let addsSeen = 0;
  const tick = Timer.create();
  tick.start(1.0, true, () => {
    elapsed += 1;
    const bossDead = GetUnitTypeId(boss.handle) === 0 || IsUnitType(boss.handle, UNIT_TYPE_DEAD);
    let alive = 0;
    for (const hero of heroes) {
      if (GetUnitTypeId(hero.handle) !== 0 && !IsUnitType(hero.handle, UNIT_TYPE_DEAD)) alive += 1;
    }
    let mercsAlive = 0;
    for (const merc of mercs) {
      if (GetUnitTypeId(merc.handle) !== 0 && !IsUnitType(merc.handle, UNIT_TYPE_DEAD)) mercsAlive += 1;
    }
    // Count the adds standing right now, so "how many were on the field" is
    // visible even when none of them died.
    let standing = 0;
    const g = CreateGroup()!;
    GroupEnumUnitsInRange(g, bossX, bossY, 1500, undefined);
    ForGroup(g, () => {
      const e = GetEnumUnit();
      if (e != null && GetUnitTypeId(e) === BOSS_ADD_ID) standing += 1;
    });
    DestroyGroup(g);
    if (standing > addsSeen) addsSeen = standing;

    if (bossDead || (alive === 0 && mercsAlive === 0) || elapsed >= FIGHT_SECONDS) {
      tick.destroy();
      stopBoss();
      t.report('outcome', bossDead ? 'HEROES WIN' : (alive === 0 && mercsAlive === 0 ? 'WIPE' : 'TIMEOUT'));
      t.report('seconds', elapsed);
      t.report('heroesAlive', alive);
      t.report('mercsAlive', mercsAlive);
      t.report('damageToBoss', dealtToBoss);
      t.report('bossHPLeft', bossDead ? 0 : boss.life);
      t.report('damageToParty', takenByParty);
      t.report('partyDPS', dealtToBoss / elapsed);
      t.report('bossDPS', takenByParty / elapsed);
      t.report('addsPeak', addsSeen);
      t.report('addsKilled', addsKilled);
      t.done();
    }
  });
}

for (const comp of [STUN_COMP, CASTER_COMP, TANK_COMP, WEAK_COMP,
  LOCK_COMP, DPS_COMP, SUPPORT_COMP, SUMMON_COMP, MIXED_COMP, TAVERN_COMP]) {
  // A fight runs to FIGHT_SECONDS before it calls the outcome, so its budget
  // has to clear that with room for the setup either side of it.
  registerTest('bf' + comp.name, (t: TestReporter) => runFight(comp, t), FIGHT_SECONDS + 60);
}
