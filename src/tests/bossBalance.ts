import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { BOSS_ADD_ID, BOSS_ID } from '../constants';
import { spawnBoss, stopBoss } from '../boss';
import { getDPSCheckPlayer } from '../teams';
import { registerTest, TestReporter } from './testKit';
import { loadBossBattlefield } from '../terrain/load';
import { PATH_BLOCKER_RAW } from '../terrain/constants';
import { forEachUnitOfPlayer, isAlive } from '../util';

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
    const bossDead = !isAlive(boss.handle);
    let alive = 0;
    for (const hero of heroes) {
      if (isAlive(hero.handle)) alive += 1;
    }
    let mercsAlive = 0;
    for (const merc of mercs) {
      if (isAlive(merc.handle)) mercsAlive += 1;
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


// --- Five fights at once, in the real arena and four copies of it ------------

/**
 * The same fight as runFight, but where it actually happens and five times over.
 *
 * runFight spawned the boss wherever the camera was -- the start lobby, open
 * ground with the players' peasants in meteor range -- whereas the real fight is
 * in the arena: a 9x9 floor sealed by lava. Confinement matters (the sparring
 * match measured 1.6x differently in a corner than on open ground), so this
 * loads the arena board and fights there.
 *
 * And one fight is one draw of a noisy AI, so it runs five: the arena itself,
 * and four more boxes of the same floor walled with the same blockers, two in
 * each walkable strip beyond the lava. The board's walkable area ends at grid
 * +-20 by +-10, which with the lava's ring at +-10 leaves exactly a 9x9 floor
 * and its walls twice over per strip.
 *
 * Each copy fights to a finish -- the boss or the whole party dead -- rather
 * than to a timer: the real fight has none, and the original tuning's closest
 * result was a timeout with two heroes still standing.
 *
 * Everything is attributed to the copy it was spawned in; summons and adds to
 * the nearest copy when first seen. A hit between two different copies is
 * counted as cross-talk -- the walls stop walking, not meteors or spells.
 */
const ARENA_COPIES: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [15, 5], [15, -5], [-15, 5], [-15, -5],
];
/** Hero, mercenary and boss places relative to a copy's centre, matching the
 *  arena template's. */
const REL_HERO_SPOTS: ReadonlyArray<readonly [number, number]> = [[-3, 2], [-3, 1], [-3, -1], [-3, -2]];
const REL_MERC_SPOTS: ReadonlyArray<readonly [number, number]> = [[-4, 1], [-4, -1]];
const REL_BOSS_SPOT: readonly [number, number] = [3, 0];
/** A safety net, not a rule: the real fight has no timer. */
const ARENA_FIGHT_CAP = 300;
const CELL = 128;

/** Wall the copies beyond the arena itself in with the arena's own blocker. */
function wallCopies(copies: ReadonlyArray<readonly [number, number]>): void {
  for (let c = 1; c < copies.length; c++) {
    const [cx, cy] = copies[c];
    for (let d = -5; d <= 5; d++) {
      for (const [gx, gy] of [[cx + d, cy - 5], [cx + d, cy + 5], [cx - 5, cy + d], [cx + 5, cy + d]]) {
        CreateDestructable(FourCC(PATH_BLOCKER_RAW), gx * CELL, gy * CELL, 0, 1, 0);
      }
    }
  }
}

function nearestArena(x: number, y: number): number {
  let best = 0;
  let bestD = 1e12;
  for (let i = 0; i < ARENA_COPIES.length; i++) {
    const dx = ARENA_COPIES[i][0] * CELL - x;
    const dy = ARENA_COPIES[i][1] * CELL - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function runArenaFights(comp: Comp, t: TestReporter,
  copies: ReadonlyArray<readonly [number, number]> = ARENA_COPIES): void {
  loadBossBattlefield();
  wallCopies(copies);
  const n = copies.length;
  const heroPlayer = getDPSCheckPlayer().handle;

  const home = new Map<number, number>();
  const copyOf = (u: unit): number => {
    const id = GetHandleId(u);
    let c = home.get(id);
    if (c == null) { c = nearestArena(GetUnitX(u), GetUnitY(u)); home.set(id, c); }
    return c;
  };

  const bosses: Unit[] = [];
  const heroes: Unit[][] = [];
  const mercs: Unit[][] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = copies[i];
    const boss = spawnBoss((cx + REL_BOSS_SPOT[0]) * CELL, (cy + REL_BOSS_SPOT[1]) * CELL);
    if (boss == null) { t.fail('boss' + I2S(i)!, 'did not spawn'); t.done(); return; }
    home.set(GetHandleId(boss.handle), i);
    bosses.push(boss);
    heroes.push([]);
    mercs.push([]);
    for (let h = 0; h < comp.heroes.length; h++) {
      const [rx, ry] = REL_HERO_SPOTS[h];
      const u = buildHero(comp.heroes[h], (cx + rx) * CELL, (cy + ry) * CELL);
      if (u == null) continue;
      home.set(GetHandleId(u.handle), i);
      heroes[i].push(u);
    }
    for (let m = 0; m < MERC_TYPES.length; m++) {
      const [rx, ry] = REL_MERC_SPOTS[m];
      const u = Unit.create(getDPSCheckPlayer(), FourCC(MERC_TYPES[m]), (cx + rx) * CELL, (cy + ry) * CELL, 0);
      if (u == null) continue;
      home.set(GetHandleId(u.handle), i);
      mercs[i].push(u);
    }
  }
  t.report('comp', comp.name);
  t.report('copies', n);
  t.report('bossHP', bosses[0].maxLife);

  const dealt: number[] = [];
  const taken: number[] = [];
  const casts: number[] = [];
  const result: string[] = [];
  const endAt: number[] = [];
  const bossLeftPct: number[] = [];
  const heroesLeft: number[] = [];
  const mercsLeft: number[] = [];
  for (let i = 0; i < n; i++) {
    dealt.push(0); taken.push(0); casts.push(0); result.push('');
    endAt.push(0); bossLeftPct.push(0); heroesLeft.push(0); mercsLeft.push(0);
  }
  let cross = 0;

  const bossPlayer = bosses[0].owner.handle;
  const trigs: trigger[] = [];
  const onBossSide = CreateTrigger()!;
  TriggerRegisterPlayerUnitEvent(onBossSide, bossPlayer, EVENT_PLAYER_UNIT_DAMAGED, undefined);
  TriggerAddAction(onBossSide, () => {
    const hit = GetTriggerUnit();
    const src = GetEventDamageSource();
    if (hit == null || src == null) return;
    if (copyOf(src) !== copyOf(hit)) { cross += GetEventDamage(); return; }
    if (GetUnitTypeId(hit) === BOSS_ID) dealt[copyOf(hit)] += GetEventDamage();
  });
  trigs.push(onBossSide);
  const onHeroSide = CreateTrigger()!;
  TriggerRegisterPlayerUnitEvent(onHeroSide, heroPlayer, EVENT_PLAYER_UNIT_DAMAGED, undefined);
  TriggerAddAction(onHeroSide, () => {
    const hit = GetTriggerUnit();
    const src = GetEventDamageSource();
    if (hit == null || src == null) return;
    if (copyOf(src) !== copyOf(hit)) { cross += GetEventDamage(); return; }
    taken[copyOf(hit)] += GetEventDamage();
  });
  trigs.push(onHeroSide);
  const onCast = CreateTrigger()!;
  TriggerRegisterPlayerUnitEvent(onCast, heroPlayer, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
  TriggerAddAction(onCast, () => {
    const u = GetTriggerUnit();
    if (u != null) casts[copyOf(u)] += 1;
  });
  trigs.push(onCast);

  for (let i = 0; i < n; i++) {
    for (const u of heroes[i]) IssueTargetOrder(u.handle, 'attack', bosses[i].handle);
    for (const u of mercs[i]) IssueTargetOrder(u.handle, 'attack', bosses[i].handle);
  }

  const alive = (u: Unit): boolean =>
    isAlive(u.handle);

  let elapsed = 0;
  const tick = Timer.create();
  tick.start(1.0, true, t.guard(() => {
    elapsed += 1;
    let open = 0;
    for (let i = 0; i < n; i++) {
      if (result[i] !== '') continue;
      const boss = bosses[i];
      const bossDead = !alive(boss);
      const h = heroes[i].filter(u => alive(u)).length;
      const m = mercs[i].filter(u => alive(u)).length;
      if (bossDead || (h === 0 && m === 0) || elapsed >= ARENA_FIGHT_CAP) {
        result[i] = bossDead ? 'HEROES' : (h === 0 && m === 0 ? 'BOSS' : 'CAP');
        endAt[i] = elapsed;
        bossLeftPct[i] = bossDead ? 0 : R2I(boss.life * 100 / boss.maxLife);
        heroesLeft[i] = h;
        mercsLeft[i] = m;
      } else {
        open += 1;
      }
    }
    if (open > 0) return;

    tick.destroy();
    stopBoss();
    for (const tr of trigs) DestroyTrigger(tr);
    for (let i = 0; i < n; i++) {
      const k = 'c' + I2S(i)! + '_';
      t.report(k + 'winner', result[i]);
      t.report(k + 'seconds', endAt[i]);
      t.report(k + 'bossHPLeftPct', bossLeftPct[i]);
      t.report(k + 'heroesLeft', heroesLeft[i]);
      t.report(k + 'mercsLeft', mercsLeft[i]);
      t.report(k + 'damageToBoss', dealt[i]);
      t.report(k + 'damageToParty', taken[i]);
      t.report(k + 'casts', casts[i]);
    }
    t.report('crossTalk', cross);
    // Clear the field for whatever runs next.
    forEachUnitOfPlayer(heroPlayer, u => RemoveUnit(u));
    forEachUnitOfPlayer(bossPlayer, u => RemoveUnit(u));
    t.done();
  }));
}

// Registered the same way as the single fights above, as 'bf' + name, and for
// the same reason: these are balance runs with no pass condition, about three
// minutes each, and the suite's documented sweep excludes 'bf' -- which is the
// only name the source scan sees here. Run them by name through
// Invoke-MapTests (e.g. -Tests bfarenamixed); run-test.ps1's preflight looks
// for the literal name and would need -SkipSelfTest.
//
// bfarenamixedsolo is the real arena alone, as the game fights it: the
// baseline the parallel copies were checked against before being trusted.
const ARENA_BUDGET = ARENA_FIGHT_CAP + 60;
const SOLO_ARENA: ReadonlyArray<readonly [number, number]> = [[0, 0]];
for (const comp of [MIXED_COMP, STUN_COMP, TAVERN_COMP, CASTER_COMP]) {
  registerTest('bf' + 'arena' + comp.name, (t: TestReporter) => runArenaFights(comp, t), ARENA_BUDGET);
}
registerTest('bf' + 'arenamixedsolo',
  (t: TestReporter) => runArenaFights(MIXED_COMP, t, SOLO_ARENA), ARENA_BUDGET);
