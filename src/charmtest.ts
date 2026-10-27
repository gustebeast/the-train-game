import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { registerTest, TestReporter } from './testkit';
import { beginNewRun, loadInterRoundLobby, loadTerrain, loadBossBattlefield, loadStartLobby } from './terrain/load';
import { HeroData, setRosterForTest, getSpawnedHeroes } from './heroes';
import { startBossFight, setBossArenaCallbacks, getBossArenaCallbacks } from './bossArena';
import { setMercsForTest, spawnMercFromData, spawnMercWithHeroes, getSpawnedMercUnits, removeSpawnedMercUnits } from './mercenary';
import { CREEP_CAMPS } from './creepCamps';
import {
  setCampForTest, getCampOrigin, getSparringStatus, getDpsMeasured, dpsSampleBreakdown,
  SPARRING_DURATION,
} from './creeps';
import { getDPSCheckPlayer } from './teams';
import { purchaseSummonUpgrade } from './summonUpgrade';
import { CAGE_RAW } from './sharedData';
import { PEASANT_ID, SUMMON_ABILITY_ID, UNSUMMON_ABILITY_ID, BOSS_ID, BOSS_ADD_ID, BOSS_KEY_ITEM_ID } from './constants';
import { gameState, isInGameplay } from './state';
import { getHumanPlayers, forEachUnitOfPlayer } from './util';

/**
 * Charm and Transmute against a creep camp.
 *
 * Both take a creep out of the fight without the usual death: Charm hands it to
 * the caster's owner alive, Transmute kills it outright. The camp's own logic
 * only ever looked at deaths, so each needs checking -- in a real round, where
 * "camp defeated" grants Unsummon Heroes, the Tough Camp challenge and the
 * Strange Key; and in the sparring match, where a creep changing sides or
 * losing all of its rigged HP at once lands straight in the measurement.
 *
 * Level 6, so both ultimates are learned. The camp is kobolds (two Kobolds and a
 * Kobold Geomancer): both spells refuse creeps above level 5.
 */
const KOBOLD_CAMP = 11;
/** XP for level 6 on this map's table, which is 100 per level (900 is the
 *  level 10 cap). The standard table's 2000 put these heroes at the cap,
 *  where no kill could pay them anything. */
const LEVEL_6_XP = 500;

function level6(type: string, skills: ReadonlyArray<string>, ultimate: string): HeroData {
  const s: Record<string, number> = {};
  s[skills[0]] = 2;
  s[skills[1]] = 2;
  s[skills[2]] = 1;
  s[ultimate] = 1;
  return { typeId: FourCC(type), xp: LEVEL_6_XP, skills: s, items: [],
    tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
}

const ALCHEMIST = level6(Units.Alchemist,
  [Abilities.HealingSpray, Abilities.ChemicalRage, Abilities.AcidBomb], Abilities.Transmute);
const DARK_RANGER = level6(Units.DarkRanger,
  [Abilities.Silence, Abilities.BlackArrow, Abilities.LifeDrain], Abilities.Charm);

function findCage(): destructable | null {
  let cage: destructable | null = null;
  EnumDestructablesInRect(GetWorldBounds()!, undefined, () => {
    const d = GetEnumDestructable()!;
    if (GetDestructableTypeId(d) === FourCC(CAGE_RAW) && GetWidgetLife(d) > 0) cage = d;
  });
  return cage;
}

/** Living creeps near the camp, by neutral aggressive. */
function campCreeps(): unit[] {
  const out: unit[] = [];
  const o = getCampOrigin();
  if (o == null) return out;
  const g = CreateGroup()!;
  GroupEnumUnitsInRange(g, o.x, o.y, 600, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit()!;
    if (GetOwningPlayer(u) !== Player(PLAYER_NEUTRAL_AGGRESSIVE)) return;
    if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
    out.push(u);
  });
  DestroyGroup(g);
  return out;
}

// --- In a real round --------------------------------------------------------

/** A full four-hero roster for a round. A round fields the two LEAST
 *  experienced heroes, so a roster of just the two wanted left the two empty
 *  slots -- at 0 XP -- to be picked, and nobody came. The other two sit at
 *  far more XP, so the Alchemist and Dark Ranger are the pair fielded. */
const ROUND_ROSTER: HeroData[] = [
  ALCHEMIST, DARK_RANGER,
  { ...ALCHEMIST, typeId: FourCC(Units.Paladin), xp: 50000, skills: {} },
  { ...ALCHEMIST, typeId: FourCC(Units.MountainKing), xp: 50000, skills: {} },
];

/** The human peasant nearest a point: looked up fresh each time, because units
 *  a board stands up straight after loading can be replaced within a frame --
 *  holding the first handle found is what broke the first version of this. */
function peasantNear(x: number, y: number): unit | null {
  const me = getHumanPlayers()[0];
  let best: unit | null = null;
  let bestD = 1e12;
  forEachUnitOfPlayer(me.handle, u => {
    if (GetUnitTypeId(u) !== PEASANT_ID) return;
    const d = (GetUnitX(u) - x) ** 2 + (GetUnitY(u) - y) ** 2;
    if (d < bestD) { bestD = d; best = u; }
  });
  return best;
}

function itemsNear(x: number, y: number, r: number): number {
  let n = 0;
  EnumItemsInRect(GetWorldBounds()!, undefined, () => {
    const it = GetEnumItem()!;
    if ((GetItemX(it) - x) ** 2 + (GetItemY(it) - y) ** 2 <= r * r) n += 1;
  });
  return n;
}

function heroXP(): number {
  let xp = 0;
  for (const h of getSpawnedHeroes()) xp += GetHeroXP(h.handle);
  return xp;
}

/** Break the cage, summon the party with the peasant, and hand back the cage
 *  position -- or null, having failed the test, if any of it did not happen. */
function startCampFight(t: TestReporter, then: (cx: number, cy: number) => void): void {
  t.after(0.5, () => {
    const cage = findCage();
    if (cage == null) { t.fail('setup', 'no cage'); t.done(); return; }
    const cx = GetDestructableX(cage);
    const cy = GetDestructableY(cage);
    const p = peasantNear(cx, cy);
    if (p == null) { t.fail('setup', 'no peasant'); t.done(); return; }
    SetUnitPosition(p, cx - 150, cy);
    KillDestructable(cage);
    t.after(0.5, () => {
      const q = peasantNear(cx, cy);
      if (q == null || GetUnitAbilityLevel(q, SUMMON_ABILITY_ID) === 0) {
        t.fail('summonGranted', 'breaking the cage did not hand a peasant Summon Heroes');
        t.done();
        return;
      }
      let casts = 0;
      const cast = CreateTrigger()!;
      TriggerRegisterUnitEvent(cast, q, EVENT_UNIT_SPELL_EFFECT);
      TriggerAddAction(cast, () => { casts += 1; });
      t.report('summonOrderAccepted', IssueImmediateOrder(q, 'roar') ? 1 : 0);
      t.report('inGameplayAtSummon', isInGameplay() ? 1 : 0);
      t.after(2, () => {
        DestroyTrigger(cast);
        t.report('summonSpellEffects', casts);
        if (getSpawnedHeroes().length === 0) { t.fail('summon', 'no heroes came'); t.done(); return; }
        then(cx, cy);
      });
    });
  });
}

/**
 * Charm and Transmute in a real round, as the base game has them: Charm takes
 * the creep and gives nothing else -- no XP, no drops -- while Transmute is a
 * kill. Either way the creep is out of the camp, so the camp is beaten once
 * every creep is dead or charmed, and the peasants get Unsummon Heroes; and
 * unsummoning takes the charmed creep away with the heroes.
 */
function runCharmCamp(t: TestReporter): void {
  beginNewRun();
  // Summon Heroes is greyed out until its upgrade is bought from the shop.
  purchaseSummonUpgrade();
  setRosterForTest(ROUND_ROSTER);
  setMercsForTest([]);
  setCampForTest(KOBOLD_CAMP);
  loadTerrain(gameState.round);

  startCampFight(t, (cx, cy) => {
    let alch: unit | null = null;
    let dr: unit | null = null;
    for (const h of getSpawnedHeroes()) {
      SetUnitState(h.handle, UNIT_STATE_MANA, 1000);
      SetUnitInvulnerable(h.handle, true);
      if (GetUnitTypeId(h.handle) === FourCC(Units.Alchemist)) alch = h.handle;
      if (GetUnitTypeId(h.handle) === FourCC(Units.DarkRanger)) dr = h.handle;
    }
    const creeps = campCreeps();
    expect(t, 'campCreeps', creeps.length, 3);
    if (alch == null || dr == null || creeps.length < 3) { t.fail('cast', 'missing a hero or a creep'); t.done(); return; }
    const alchemist: unit = alch;
    const charmed = creeps[0];
    const transmuted = creeps[1];
    // Which drops the camp would leave if every creep but the charmed one died.
    const camp = CREEP_CAMPS[KOBOLD_CAMP];
    let dropsExpected = 0;
    for (const c of camp.creeps) dropsExpected += c.itemDrops != null ? c.itemDrops.length : 0;
    for (const c of camp.creeps) {
      if (FourCC(c.id) === GetUnitTypeId(charmed) && c.itemDrops != null) {
        dropsExpected -= c.itemDrops.length;
        break;
      }
    }
    const itemsBefore = itemsNear(cx, cy, 700);
    const xpBefore = heroXP();
    expect(t, 'charmOrdered', IssueTargetOrder(dr, 'charm', charmed) ? 1 : 0, 1);

    t.after(3, () => {
      expect(t, 'charmedNowOurs', GetOwningPlayer(charmed) === getHumanPlayers()[0].handle ? 1 : 0, 1);
      expect(t, 'charmPaysNoXP', heroXP() - xpBefore, 0);
      // Inherited from the mercenary types' object data, and stripped at spawn.
      expect(t, 'charmedHasNoInventory', UnitInventorySize(charmed), 0);
      // Who the transmuted creep belongs to as it dies: the camp pays XP only
      // for a creep that died as the camp's.
      const deathWatch = CreateTrigger()!;
      TriggerRegisterUnitEvent(deathWatch, transmuted, EVENT_UNIT_DEATH);
      TriggerAddAction(deathWatch, () => {
        t.report('transmutedOwnerAtDeath', GetPlayerId(GetOwningPlayer(GetTriggerUnit()!)));
        DestroyTrigger(deathWatch);
      });
      t.report('creepOwnerId', GetPlayerId(Player(PLAYER_NEUTRAL_AGGRESSIVE)!));
      expect(t, 'transmuteOrdered', IssueTargetOrder(alchemist, 'transmute', transmuted) ? 1 : 0, 1);

      t.after(3, () => {
        expect(t, 'transmutedDead', GetWidgetLife(transmuted) <= 0.405 ? 1 : 0, 1);
        t.report('xpFromTransmute', heroXP() - xpBefore);
        if (heroXP() - xpBefore <= 0) t.fail('xpFromTransmute', 'a kill should pay XP');
        // Finish the rest as the fight would.
        const xpBeforeKills = heroXP();
        for (const c of campCreeps()) KillUnit(c);

        t.after(2, () => {
          t.report('xpFromKills', heroXP() - xpBeforeKills);
          for (const h of getSpawnedHeroes()) {
            const nm = GetUnitName(h.handle) ?? '?';
            t.report('level_' + nm, GetHeroLevel(h.handle));
            t.report('xp_' + nm, GetHeroXP(h.handle));
          }
          expect(t, 'dropsOnlyFromTheKilled', itemsNear(cx, cy, 700) - itemsBefore, dropsExpected);
          const p = peasantNear(cx, cy);
          expect(t, 'campCountsAsBeaten', p != null && GetUnitAbilityLevel(p, UNSUMMON_ABILITY_ID) > 0 ? 1 : 0, 1);
          if (p != null) IssueImmediateOrder(p, 'roar');

          t.after(2, () => {
            expect(t, 'charmedGoneAfterUnsummon', GetUnitTypeId(charmed) === 0 ? 1 : 0, 1);
            expect(t, 'heroesGoneAfterUnsummon', getSpawnedHeroes().length, 0);
            t.done();
          });
        });
      });
    });
  });
}

registerTest('charmcamp', runCharmCamp);

/**
 * The Strange Key keys off the camp being beaten, however it was beaten: a
 * flawless level 3 clear leaves it where the cage stood even if a creep was
 * charmed rather than killed.
 *
 * Level 3 camps are mostly beyond Charm's level 5 limit, so the charm is done
 * the way Charm does it -- the creep changes owner -- which is all the camp
 * logic can see of it anyway. The party is two mercenaries strong and kept
 * invulnerable, because the key also asks for both contracts and nobody lost.
 */
const LEVEL3_CAMP = 417;   // granite golem, two rock trolls

function runCharmKey(t: TestReporter): void {
  beginNewRun();
  purchaseSummonUpgrade();
  setRosterForTest(ROUND_ROSTER);
  setMercsForTest([FourCC('nogl'), FourCC('nfsh')]);
  setCampForTest(LEVEL3_CAMP);
  loadTerrain(gameState.round);

  startCampFight(t, (cx, cy) => {
    // The whole party, mercenaries included: the key is forfeit if ANY of it
    // dies, and an unprotected mercenary against a level 3 camp can, in the
    // seconds a summon takes -- which is what failed this test in a batch.
    for (const h of getSpawnedHeroes()) SetUnitInvulnerable(h.handle, true);
    for (const m of getSpawnedMercUnits()) SetUnitInvulnerable(m.handle, true);
    t.report('mercsFielded', getSpawnedMercUnits().length);
    t.report('mercsAliveAtClear', getSpawnedMercUnits().filter(m => GetWidgetLife(m.handle) > 0.405).length);
    const creeps = campCreeps();
    expect(t, 'campCreeps', creeps.length, CREEP_CAMPS[LEVEL3_CAMP].creeps.length);
    if (creeps.length < 2) { t.done(); return; }
    SetUnitOwner(creeps[0], getHumanPlayers()[0].handle, true);
    for (let i = 1; i < creeps.length; i++) KillUnit(creeps[i]);
    t.after(1.5, () => {
      let keys = 0;
      EnumItemsInRect(GetWorldBounds()!, undefined, () => {
        const it = GetEnumItem()!;
        if (GetItemTypeId(it) !== BOSS_KEY_ITEM_ID) return;
        if ((GetItemX(it) - cx) ** 2 + (GetItemY(it) - cy) ** 2 <= 200 * 200) keys += 1;
      });
      expect(t, 'keyAtCageAfterCharmedClear', keys, 1);
      t.done();
    });
  });
}

registerTest('charmkey', runCharmKey);



// --- In the sparring match ----------------------------------------------------

/** The six-copy match with this party, left to the AI: does it cast either
 *  ultimate, and what does each do to the two HP-lost totals? Sampled every
 *  second so a jump shows when it happens, not just in the final number. */
function runCharmSparring(t: TestReporter): void {
  beginNewRun();
  setRosterForTest([ALCHEMIST, DARK_RANGER]);
  setMercsForTest([]);
  setCampForTest(KOBOLD_CAMP);
  loadInterRoundLobby();

  const check = getDPSCheckPlayer().handle;
  const casts = new Map<string, number>();
  const castTimes: string[] = [];
  const trig = CreateTrigger()!;
  TriggerRegisterPlayerUnitEvent(trig, check, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
  TriggerAddAction(trig, () => {
    const name = GetObjectName(GetSpellAbilityId()) ?? '?';
    casts.set(name, (casts.get(name) ?? 0) + 1);
    if (GetSpellAbilityId() === FourCC(Abilities.Charm) || GetSpellAbilityId() === FourCC(Abilities.Transmute)) {
      castTimes.push(name + '@' + tostring(R2I(getSparringStatus().elapsed * 10) / 10));
    }
  });

  let lastCreep = 0;
  let lastOurs = 0;
  for (let s = 1; s <= 29; s++) {
    t.after(1 + s, () => {
      const b = dpsSampleBreakdown();
      const k = s < 10 ? '0' + tostring(s) : tostring(s);
      // Per-second change in each total: a spell's effect shows as a spike.
      t.report('dCreepLost' + k, b.creepHPLost - lastCreep);
      t.report('dOurLost' + k, b.ourHPLost - lastOurs);
      lastCreep = b.creepHPLost;
      lastOurs = b.ourHPLost;
      let charmedNow = 0;
      forEachUnitOfPlayer(check, u => {
        if (!IsUnitType(u, UNIT_TYPE_HERO) && GetUnitLevel(u) > 0
          && (GetUnitTypeId(u) === FourCC('nkob') || GetUnitTypeId(u) === FourCC('nkog'))) {
          charmedNow += 1;
        }
      });
      t.report('charmedHeld' + k, charmedNow);
    });
  }
  // Once the match is over, which it decides for itself -- having first
  // begun: right after the lobby loads it has not started, and "not running"
  // would read as already over.
  t.waitFor('matchStarts', () => getSparringStatus().timer, 5, () => t.waitFor('matchEnds', () => !getSparringStatus().timer, SPARRING_DURATION + 5, () => {
    DestroyTrigger(trig);
    const cn: string[] = [];
    casts.forEach((v, n) => cn.push(n + '=' + tostring(v)));
    t.report('casts', cn.join(' '));
    t.report('ultimateCasts', castTimes.join(' '));
    const m = getDpsMeasured();
    t.report('heroDPSPerCopy', m.heroDPS);
    t.report('creepDPSPerCopy', m.creepDPS);
    const ratio = m.creepDPS > 0 ? m.heroDPS / m.creepDPS : 0;
    t.report('ratio', ratio);
    const b = dpsSampleBreakdown();
    t.report('creepsTakenOutEarly', b.removals);
    t.report('creditedForThem', b.removalCredit);
    // Before the fix this party measured -1055 DPS and a ratio of -115: a
    // charmed creep's rigging read as damage dealt in reverse.
    if (m.heroDPS <= 0) t.fail('heroDPSPerCopy', 'must be positive');
    if (ratio <= 0 || ratio > 50) t.fail('ratio', 'outside anything a real party produces');
    t.done();
  }));
}

registerTest('charmspar', runCharmSparring);

function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

// --- In the boss fight ------------------------------------------------------

/**
 * A charmed Lesser Infernal must not hold the boss fight open.
 *
 * The arena decides its ending by looking: victory when no boss or lesser
 * infernal is left standing, defeat when nothing the players own is. Both were
 * written before Charm was considered -- the first matched infernals by TYPE
 * whoever owned them, the second counted ANY unit a player owns -- so a
 * charmed infernal would stall victory after the boss died, and keep a wiped
 * party "standing", for up to the infernal's three-minute life either way.
 *
 * The real endings are swapped for spies for the duration and put back after,
 * so the test sees which fired, and when, without leaving the board.
 */
const MOUNTAIN_KING = level6(Units.MountainKing,
  [Abilities.StormBolt, Abilities.ThunderClap, Abilities.Bash], Abilities.Avatar);
const PALADIN = level6(Units.Paladin,
  [Abilities.HolyLight, Abilities.DevotionAura, Abilities.DivineShield], Abilities.Resurrection);

function runCharmBoss(t: TestReporter, ending: 'win' | 'lose'): void {
  beginNewRun();
  setRosterForTest([DARK_RANGER, MOUNTAIN_KING, PALADIN, ALCHEMIST]);
  setMercsForTest([]);
  loadBossBattlefield();
  const real = getBossArenaCallbacks();
  let fired = '';
  let survivorInfernals = -1;
  let survivorCount = -1;
  let firedAt = 0;
  let clock = 0;
  setBossArenaCallbacks(
    () => { if (fired === '') { fired = 'defeat'; firedAt = clock; } },
    (survivors: unit[]) => {
      if (fired !== '') return;
      fired = 'victory';
      firedAt = clock;
      // Survivors are who may take the exit circle out to the victory lobby
      // (trophies are only handed out there): a charmed infernal must not be
      // one of them.
      survivorInfernals = survivors.filter(u => GetUnitTypeId(u) === BOSS_ADD_ID).length;
      survivorCount = survivors.length;
    },
  );
  let finished = false;
  const restore = (): void => {
    finished = true;
    if (real.defeat != null && real.victory != null) setBossArenaCallbacks(real.defeat, real.victory);
  };
  startBossFight();

  const humans = getHumanPlayers();
  const ours = (u: unit): boolean => humans.some(h => h.handle === GetOwningPlayer(u));
  let dr: unit | null = null;
  for (const h of getSpawnedHeroes()) {
    // Out of the boss's reach while an infernal is waited for and charmed.
    SetUnitInvulnerable(h.handle, true);
    SetUnitState(h.handle, UNIT_STATE_MANA, 1000);
    if (GetUnitTypeId(h.handle) === FourCC(Units.DarkRanger)) dr = h.handle;
  }
  if (dr == null) { t.fail('setup', 'no Dark Ranger'); restore(); t.done(); return; }
  const ranger: unit = dr;

  let boss: unit | null = null;
  let add: unit | null = null;
  const find = (): void => {
    forEachUnitOfPlayer(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, u => {
      if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
      if (GetUnitTypeId(u) === BOSS_ID) boss = u;
      if (GetUnitTypeId(u) === BOSS_ADD_ID && add == null) add = u;
    });
  };

  // Wait for the boss to call an infernal down, then charm it.
  let charmed = false;
  const step = (): void => {
    if (finished) return;
    clock += 0.5;
    if (!charmed) {
      find();
      if (add != null) {
        charmed = true;
        t.report('addAppearedAt', clock);
        t.report('charmOrdered', IssueTargetOrder(ranger, 'charm', add) ? 1 : 0);
      } else if (clock > 30) {
        t.fail('add', 'no lesser infernal within 30s'); restore(); t.done(); return;
      }
      t.after(0.5, step);
      return;
    }
    t.after(0.5, step);
  };
  t.after(0.5, step);

  // Once charmed: end the fight one way or the other, and see which ending
  // fires and how quickly.
  const decide = (): void => {
    if (add == null || GetOwningPlayer(add) === Player(PLAYER_NEUTRAL_AGGRESSIVE)) {
      if (clock > 40) { t.fail('charm', 'infernal never changed hands'); restore(); t.done(); return; }
      t.after(0.5, decide);
      return;
    }
    expect(t, 'addCharmedToPlayer', ours(add) ? 1 : 0, 1);
    const at = clock;
    if (ending === 'win') {
      if (boss != null) KillUnit(boss);
    } else {
      for (const h of getSpawnedHeroes()) { SetUnitInvulnerable(h.handle, false); KillUnit(h.handle); }
      // Anything else the party fields but the charmed infernal.
      for (const p of humans) {
        forEachUnitOfPlayer(p.handle, u => {
          if (u !== add && !IsUnitType(u, UNIT_TYPE_DEAD) && GetUnitTypeId(u) !== PEASANT_ID) KillUnit(u);
        });
      }
    }
    t.after(4, () => {
      const want = ending === 'win' ? 'victory' : 'defeat';
      t.report('ending', fired === '' ? 'none' : fired);
      t.report('secondsToEnding', fired === '' ? -1 : firedAt - at);
      if (fired !== want) t.fail('ending', 'expected ' + want + ' within 4s, got ' + (fired === '' ? 'nothing' : fired));
      if (ending === 'win') {
        t.report('survivors', survivorCount);
        expect(t, 'charmedInfernalNotASurvivor', survivorInfernals, 0);
      }
      restore();
      t.done();
    });
  };
  t.after(1, decide);
}

registerTest('charmbosswin', t => runCharmBoss(t, 'win'));
registerTest('charmbosslose', t => runCharmBoss(t, 'lose'));

/**
 * A mercenary has a working inventory, picks items up off the ground, and keeps
 * them between fields.
 *
 * Object data used to bake an inventory onto 33 creep types, on the belief that
 * one added at runtime holds nothing. That was wrong -- measured, a type that
 * never had it baked gets six working slots -- so the baking went, taking with
 * it the inventory every camp creep of those types carried (a charmed one could
 * pick up anything). The inventory now comes only from spawnMercFromData, so
 * this first checks one type each side of the old list for six slots, then
 * walks the whole path a round does: fielded with the heroes, ordered onto an item lying on
 * the ground, put away at the round's end (which snapshots its kit), fielded
 * again -- the item must come back with it. Then it dies, and the item must
 * not land on the ground: a dead mercenary's kit waits for its replacement.
 *
 * A furbolg, a type that never had an inventory in object data.
 */
function runMercKeepsItems(t: TestReporter): void {
  loadStartLobby();
  t.after(0.5, () => {
    const me = getHumanPlayers()[0];
    // Six working slots, for a type the old list covered and one it did not.
    for (const [label, type] of [['ogreLord', 'nogl'], ['furbolg', 'nfrl']] as Array<[string, string]>) {
      const u = spawnMercFromData({ typeId: FourCC(type), items: [] }, me, 0, 0);
      if (u == null) { t.fail(label, 'did not spawn'); continue; }
      expect(t, label + '_slots', UnitInventorySize(u.handle), 6);
      RemoveUnit(u.handle);
    }
    setMercsForTest([FourCC('nfrl')]);
    const x = -1984;
    const y = 0;
    spawnMercWithHeroes(x, y, [me.id]);
    const first = getSpawnedMercUnits();
    expect(t, 'fielded', first.length, 1);
    if (first.length === 0) { t.done(); return; }
    const merc = first[0].handle;
    expect(t, 'slots', UnitInventorySize(merc), 6);
    const item = CreateItem(FourCC('rst1'), x + 200, y)!;
    IssueTargetOrder(merc, 'smart', item);

    t.after(4, () => {
      expect(t, 'pickedUp', UnitHasItem(merc, item) ? 1 : 0, 1);
      // Put away as a round's end does: kit snapshotted, unit removed.
      removeSpawnedMercUnits();
      t.after(0.5, () => {
        spawnMercWithHeroes(x, y, [me.id]);
        const again = getSpawnedMercUnits();
        expect(t, 'fieldedAgain', again.length, 1);
        if (again.length === 0) { t.done(); return; }
        const back = again[0].handle;
        let kept = 0;
        for (let i = 0; i < UnitInventorySize(back); i++) {
          const it = UnitItemInSlot(back, i);
          if (it != null && GetItemTypeId(it) === FourCC('rst1')) kept += 1;
        }
        expect(t, 'itemKeptBetweenFields', kept, 1);

        // And on death the item stays with the slot, not on the ground.
        const bx = GetUnitX(back);
        const by = GetUnitY(back);
        KillUnit(back);
        t.after(1, () => {
          let lying = 0;
          EnumItemsInRect(GetWorldBounds()!, undefined, () => {
            const it = GetEnumItem()!;
            if (GetItemTypeId(it) !== FourCC('rst1')) return;
            if ((GetItemX(it) - bx) ** 2 + (GetItemY(it) - by) ** 2 <= 300 * 300) lying += 1;
          });
          expect(t, 'noDropOnDeath', lying, 0);
          t.done();
        });
      });
    });
  });
}

registerTest('mercitems', runMercKeepsItems);

/**
 * Unsummoning takes the heroes' summons away with them.
 *
 * A summon cannot be removed once its summoner has been, and the unsummon
 * sweep removed heroes and summons in one pass, in no set order -- so a Far
 * Seer's wolves could outlive the unsummon and wander the board as the
 * player's until their timer ran out. The sweep now removes summons first.
 */
function runUnsummonSummons(t: TestReporter): void {
  beginNewRun();
  purchaseSummonUpgrade();
  const seer: HeroData = { ...ALCHEMIST, typeId: FourCC(Units.FarSeer), xp: 400,
    skills: { [Abilities.FeralSpirit]: 2 } };
  setRosterForTest([seer, ALCHEMIST, ROUND_ROSTER[2], ROUND_ROSTER[3]]);
  setMercsForTest([]);
  setCampForTest(KOBOLD_CAMP);
  loadTerrain(gameState.round);

  const me = getHumanPlayers()[0].handle;
  const summonsOfMine = (): number => {
    let n = 0;
    forEachUnitOfPlayer(me, u => { if (IsUnitType(u, UNIT_TYPE_SUMMONED) && GetUnitTypeId(u) !== 0) n += 1; });
    return n;
  };

  startCampFight(t, (cx, cy) => {
    let farSeer: unit | null = null;
    for (const h of getSpawnedHeroes()) {
      SetUnitInvulnerable(h.handle, true);
      SetUnitState(h.handle, UNIT_STATE_MANA, 1000);
      if (GetUnitTypeId(h.handle) === FourCC(Units.FarSeer)) farSeer = h.handle;
    }
    if (farSeer == null) { t.fail('setup', 'no Far Seer fielded'); t.done(); return; }
    t.expect('feralSpiritOrdered', IssueImmediateOrder(farSeer, 'spiritwolf') ? 1 : 0, 1);
    t.waitFor('wolvesArrive', () => summonsOfMine() >= 2, 5, () => {
      t.report('summonsBeforeUnsummon', summonsOfMine());
      for (const c of campCreeps()) KillUnit(c);
      t.waitFor('unsummonGranted', () => {
        const p = peasantNear(cx, cy);
        return p != null && GetUnitAbilityLevel(p, UNSUMMON_ABILITY_ID) > 0;
      }, 3, () => {
        IssueImmediateOrder(peasantNear(cx, cy)!, 'roar');
        t.waitFor('heroesGone', () => getSpawnedHeroes().length === 0, 3, () => {
          t.after(0.5, () => {
            t.expect('summonsLeftAfterUnsummon', summonsOfMine(), 0);
            t.done();
          });
        });
      });
    });
  });
}

registerTest('unsummonsummons', runUnsummonSummons);
