import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { Players } from 'w3ts/globals';
import { registerTest, TestReporter } from './testKit';
import {
  measureFieldedForce, setCampForTest, getCampDamageScale,
} from '../creeps';
import { CREEP_CAMPS } from '../creepCamps';
import { HeroData, setRosterForTest, spawnHeroes, getChosenHeroCount, hasHeroes, getChosenHeroData } from '../heroes';
import { setMercsForTest, spawnMercWithHeroes, buyMercContract, hasActiveMerc } from '../mercenary';
import {
  getDPSCheckStatus, getDPSStation, startDPSCheck, stopDPSCheck, setDPSLayoutForTest, resetDPSLayoutForTest,
  setDPSOwnerLimitForTest, RIGGED_SECONDS,
} from '../dpsCheck';
import { getDPSCheckPlayers, getNeutralAggressive, toggleDPSVision } from '../teams';
import { getHumanPlayers, forEachUnitOfPlayer, forEachGroundItem, forEachDestructable } from '../util';
import { loadInterRoundLobby, beginNewRun, loadTerrain } from '../terrain/load';
import { gameState } from '../state';
import { CAGE_RAW } from '../sharedData';
import { purchaseSummonUpgrade } from '../summonUpgrade';

/**
 * The DPS check (dpsCheck.ts): copies of the party fighting the round's
 * camp out beyond the board's wall, first rigged and then for real, until the
 * cage is broken. Nothing about it is visible if it goes wrong -- it just
 * scales the camp off a bad number -- so these hold it to what it must do.
 *
 * Most run it beside the inter-round lobby, started by hand: a round's train
 * moves, and a long test would end in a crash. dpsround checks that a round
 * starts it for real. Waits are on the check itself -- its phase, its fights.
 */

/** Long enough for a lobby to load and the check to field its opening. */
const START_WAIT = 5;
/** Nearer the board than this, a fight could be heard from it: the keep-out
 *  wall stands at +-1664 and its cells reach +-1728. */
const KEEP_OUT_Y = 1600;

function level5(type: string, skills: ReadonlyArray<string>): HeroData {
  const s: Record<string, number> = {};
  s[skills[0]] = 2;
  s[skills[1]] = 2;
  s[skills[2]] = 1;
  return { typeId: FourCC(type), xp: 400, skills: s, items: [],
    tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
}

const FAR_SEER = level5(Units.FarSeer, [Abilities.FeralSpirit, Abilities.ChainLightning, Abilities.FarSight]);
const PRIESTESS = level5(Units.PriestessOfTheMoon, [Abilities.SearingArrows, Abilities.TrueshotAura, Abilities.Scout]);

/** A roster filler with more XP than the level 5 pair, so a round never
 *  picks it over them. */
const VETERAN: HeroData = { ...level5(Units.Paladin, [Abilities.HolyLight, Abilities.DevotionAura, Abilities.DivineShield]), xp: 800 };

/** gnoll assassins x2, overseer, warden: four creeps. */
const FIELD_CAMP = 217;

function countItems(): number {
  let n = 0;
  forEachGroundItem(() => { n += 1; });
  return n;
}

function checkUnits(): unit[] {
  const out: unit[] = [];
  for (const p of getDPSCheckPlayers()) forEachUnitOfPlayer(p.handle, u => { out.push(u); });
  return out;
}

/** Every creep owned by neutral aggressive beyond the keep-out wall. */
function rowCreeps(): unit[] {
  const out: unit[] = [];
  forEachUnitOfPlayer(getNeutralAggressive().handle, u => {
    if (Math.abs(GetUnitY(u)) > KEEP_OUT_Y) out.push(u);
  });
  return out;
}

function phaseIs(p: string): () => boolean {
  return () => getDPSCheckStatus().phase === p;
}

// --- Fields, measures, fights ------------------------------------------------

/**
 * One check, start to the first round of real fights, with a fixed party --
 * Far Seer and Priestess at level 5 and an Ogre Lord -- against a fixed camp,
 * so the counts are exact.
 *
 * - The opening fields every station: two heroes and a mercenary each, all the
 *   check player's, and a whole camp each; nothing nearer the board than the
 *   keep-out wall.
 * - The opening ends in a positive scale and an empty field: no rigged unit or
 *   dropped item outlives it.
 * - Real fights then finish -- a result each, the party leashed to its own
 *   station, no hero's items left on the ground.
 */
function runDPSFields(t: TestReporter): void {
  beginNewRun();
  t.expectTrue('heroesPicked', hasHeroes());
  t.expect('chosenThisRound', getChosenHeroCount(), 2);
  setRosterForTest([FAR_SEER, PRIESTESS]);
  setMercsForTest([FourCC('nogl')]);
  setCampForTest(FIELD_CAMP);
  loadInterRoundLobby();
  startDPSCheck();
  const itemsBefore = countItems();
  let casts = 0;
  const castTrig = CreateTrigger()!;
  for (const p of getDPSCheckPlayers()) TriggerRegisterPlayerUnitEvent(castTrig, p.handle, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
  TriggerAddAction(castTrig, () => { casts += 1; });

  t.waitFor('openingFielded', phaseIs('rigged'), START_WAIT, () => t.after(1, () => {
    const s = getDPSCheckStatus();
    const camp = CREEP_CAMPS[FIELD_CAMP];
    let heroes = 0;
    let mercs = 0;
    let nearBoard = 0;
    for (const u of checkUnits()) {
      if (IsUnitType(u, UNIT_TYPE_HERO)) heroes += 1;
      else if (GetUnitTypeId(u) === FourCC('nogl')) mercs += 1;
      if (Math.abs(GetUnitY(u)) < KEEP_OUT_Y) nearBoard += 1;
    }
    t.expect('heroesFielded', heroes, s.stations * 2);
    t.expect('mercsFielded', mercs, s.stations);
    t.expect('creepsFielded', rowCreeps().length, s.stations * camp.creeps.length);
    t.expect('checkUnitsNearBoard', nearBoard, 0);
    t.expect('mercsOwnedByHumans', measureFieldedForce().mercsOwnedByHumans, 0);

    t.waitFor('openingEnds', phaseIs('fights'), RIGGED_SECONDS + 5, () => {
      const after = getDPSCheckStatus();
      t.report('riggedScale', after.riggedScale);
      t.report('castsInOpening', casts);
      if (after.riggedScale <= 0) t.fail('riggedScale', 'must be positive');
      if (casts < s.stations) t.fail('castsInOpening', 'expected every station to have cast');
      t.expect('itemsLeftByOpening', countItems() - itemsBefore, 0);

      t.waitFor('firstFights', () => getDPSCheckStatus().fightsFinished >= s.stations, 150, () => {
        const st = getDPSCheckStatus();
        const margins: string[] = [];
        for (const o of st.observations) {
          margins.push(string.format('x%.2f:%+d', Math.exp(o.x), R2I(o.margin * 100)));
          if (o.margin < -1 || o.margin > 1) t.fail('margin', 'outside -1..1');
        }
        t.report('results', margins.join(' '));
        t.report('scale', st.scale);
        if (st.scale <= 0) t.fail('scale', 'must be positive');
        // Leashed: every unit of ours near some station.
        let strays = 0;
        for (const u of checkUnits()) {
          let nearest = 1e12;
          for (let i = 0; i < st.stations; i++) {
            const p = getDPSStation(i);
            nearest = Math.min(nearest, (GetUnitX(u) - p.x) ** 2 + (GetUnitY(u) - p.y) ** 2);
          }
          if (nearest > 900 * 900) strays += 1;
        }
        t.expect('unitsAwayFromAnyStation', strays, 0);
        t.expect('itemsLeftByFights', countItems() - itemsBefore, 0);
        DestroyTrigger(castTrig);
        t.done();
      });
    });
  }));
}

registerTest('dpsfields', runDPSFields, 240);

// --- Out of sight ------------------------------------------------------------

/**
 * The check is fought out of sight, for everybody, unless asked for: -viewdps
 * hands vision to whoever asks, and only them. Checked by the alliance flag
 * and by asking the engine whether any of its units is visible to a human.
 */
function runDPSVision(t: TestReporter): void {
  const dps = getDPSCheckPlayers()[getDPSCheckPlayers().length - 1].handle;
  const humans = getHumanPlayers();
  const me = humans[0];
  const sharing = (p: player): boolean => GetPlayerAlliance(dps, p, ALLIANCE_SHARED_VISION);
  t.expect('nobodySeesByDefault', humans.filter(p => sharing(p.handle)).length, 0);
  t.expectTrue('toggleOn', toggleDPSVision(me.handle));
  t.expectTrue('watcherSees', sharing(me.handle));
  t.expectFalse('toggleOff', toggleDPSVision(me.handle));

  beginNewRun();
  loadInterRoundLobby();
  startDPSCheck();
  t.waitFor('fielded', phaseIs('rigged'), START_WAIT, () => t.after(1, () => {
    let fielded = 0;
    let seen = 0;
    for (const u of [...checkUnits(), ...rowCreeps()]) {
      if (IsUnitType(u, UNIT_TYPE_DEAD)) continue;
      fielded += 1;
      if (humans.some(p => IsUnitVisible(u, p.handle))) seen += 1;
    }
    t.report('unitsFielded', fielded);
    if (fielded === 0) t.fail('unitsFielded', 'nothing to look for');
    t.expect('unitsSeenByAHuman', seen, 0);
    t.done();
  }));
}

registerTest('dpsvision', runDPSVision);

// --- A round starts it; the cage or any board stops it -----------------------

/**
 * - A round loading starts the check, against that round's camp.
 * - Any other board stops it and clears the field.
 * - Breaking the round's cage once the opening is done stops it, leaves a
 *   scale set, and clears the field.
 */
function runDPSRound(t: TestReporter): void {
  beginNewRun();
  // Without Summon Heroes a round fields no heroes, and there is nothing to
  // measure.
  purchaseSummonUpgrade();
  // All four slots: a round fields the two with least XP, and an empty slot
  // has none.
  setRosterForTest([FAR_SEER, PRIESTESS, VETERAN, VETERAN]);
  setMercsForTest([FourCC('nogl')]);
  setCampForTest(FIELD_CAMP);
  loadTerrain(gameState.round);
  t.report('heroesChosen', getChosenHeroData().length);
  t.waitFor('roundStartsIt', phaseIs('rigged'), START_WAIT, () => t.after(1, () => {
    t.expect('creepsForThisCamp', rowCreeps().length, CREEP_CAMPS[FIELD_CAMP].creeps.length * getDPSCheckStatus().stations);

    loadInterRoundLobby();
    t.after(1, () => {
      t.expect('phaseAfterLobby', getDPSCheckStatus().phase, 'idle');
      t.expect('checkUnitsAfterLobby', checkUnits().length, 0);
      t.expect('rowCreepsAfterLobby', rowCreeps().length, 0);

      loadTerrain(gameState.round);
      t.waitFor('fightsBegin', phaseIs('fights'), RIGGED_SECONDS + 5, () => t.after(3, () => {
        let cage: destructable | null = null;
        forEachDestructable(d => { if (GetDestructableTypeId(d) === FourCC(CAGE_RAW)) cage = d; });
        if (cage == null) { t.fail('cage', 'no cage on the round board'); t.done(); return; }
        KillDestructable(cage);
        t.after(1, () => {
          t.expect('phaseAfterCage', getDPSCheckStatus().phase, 'idle');
          t.report('scaleAfterCage', getCampDamageScale());
          if (getCampDamageScale() <= 0) t.fail('scaleAfterCage', 'no scale left set');
          t.expect('checkUnitsAfterCage', checkUnits().length, 0);
          t.expect('rowCreepsAfterCage', rowCreeps().length, 0);
          t.done();
        });
      }));
    });
  }));
}

registerTest('dpsround', runDPSRound, 90);

// --- What a mercenary does to the scaling ------------------------------------

/**
 * A mercenary raises the camp's HP: it is pegged to the fielded force's, and
 * counting the mercenary raises that. Reported, so a change lands measured.
 */
function runForceScale(t: TestReporter): void {
  beginNewRun();
  t.expectTrue('mercHired', buyMercContract() && hasActiveMerc());
  spawnHeroes([Players[0]], 0, 0);
  spawnMercWithHeroes(0, -96, [Players[0].id]);
  t.after(0.5, () => {
    const f = measureFieldedForce();
    t.expect('mercs', f.mercs, 1);
    const hpPct = f.heroEHP > 0 ? (f.heroEHP + f.mercEHP) / f.heroEHP * 100 : 0;
    t.report('campHPPercentOfBefore', hpPct);
    if (hpPct <= 100) t.fail('campHPPercentOfBefore', 'a mercenary must raise camp HP');
    t.done();
  });
}

registerTest('forcescale', runForceScale);

// --- Balance: does it converge, and on what? ---------------------------------

/**
 * Balance harness, excluded from the sweep ('bf...'): run the check on a
 * party until it calls itself converged, and report how long that took and
 * where it settled. The fights near the end ARE the validation: at the
 * settled scale they should come out near the target, a narrow camp win.
 */
interface ConvergeCase { name: string; heroes: HeroData[]; mercs: string[]; camp: number }

function hero(type: string, xp: number, skills: Array<[string, number]>, items: string[] = []): HeroData {
  const s: Record<string, number> = {};
  for (const [id, n] of skills) s[id] = n;
  return { typeId: FourCC(type), xp, skills: s, items: items.map(id => ({ id: FourCC(id), charges: 0 })),
    tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
}

const CONVERGE_CASES: ConvergeCase[] = [
  {
    // The user's save: both level 2, Draenei Harbinger and Wildkin, camp 90.
    name: 'user', camp: 90, mercs: ['ndrh', 'nowb'], heroes: [
      hero(Units.PriestessOfTheMoon, 189, [[Abilities.SearingArrows, 1]]),
      hero(Units.FarSeer, 189, [[Abilities.ChainLightning, 1], [Abilities.FeralSpirit, 1]], ['rin1', 'wswd']),
    ],
  },
  {
    name: 'bmlich', camp: 217, mercs: [], heroes: [
      hero(Units.Blademaster, 300, [[Abilities.CriticalStrike, 2], [Abilities.WindWalk, 1], [Abilities.MirrorImage, 1]]),
      hero(Units.Lich, 300, [[Abilities.FrostNova, 2], [Abilities.FrostArmor, 1], [Abilities.DarkRitual, 1]]),
    ],
  },
  {
    name: 'tcdr', camp: 387, mercs: ['nogl', 'nfsh'], heroes: [
      hero(Units.TaurenChieftain, 500, [[Abilities.WarStomp, 2], [Abilities.Shockwave, 2], [Abilities.EnduranceAura, 2]]),
      hero(Units.DarkRanger, 500, [[Abilities.Silence, 2], [Abilities.BlackArrow, 2], [Abilities.LifeDrain, 2]]),
    ],
  },
];
const CONVERGE_CAP = 480;

for (const c of CONVERGE_CASES) {
  registerTest('bfconverge' + c.name, (t: TestReporter) => {
    beginNewRun();
    setRosterForTest(c.heroes);
    setMercsForTest(c.mercs.map(id => FourCC(id)));
    setCampForTest(c.camp);
    loadInterRoundLobby();
    startDPSCheck();
    const marks: string[] = [];
    let lastMark = 0;
    const watch = (): void => {
      const s = getDPSCheckStatus();
      if (s.elapsed - lastMark >= 30) {
        lastMark = s.elapsed;
        marks.push(string.format('%ds:x%.2f(%d)', R2I(s.elapsed), s.scale, s.fightsFinished));
      }
      if (s.phase === 'done' || s.elapsed >= CONVERGE_CAP) {
        t.report('converged', s.phase === 'done' ? 1 : 0);
        t.report('seconds', s.elapsed);
        t.report('riggedScale', s.riggedScale);
        t.report('scale', s.scale);
        t.report('error', s.centerError);
        t.report('fights', s.fightsFinished);
        t.report('trace', marks.join(' '));
        // The last two dozen finished fights, scale and margin.
        const fin = s.observations.filter(o => o.weight >= 1);
        const tail = fin.slice(-24);
        let sum = 0;
        for (const o of tail) sum += o.margin;
        t.report('tailMeanMarginPct', tail.length > 0 ? R2I(sum / tail.length * 100) : 0);
        t.report('tail', tail.map(o => string.format('x%.2f:%+d', Math.exp(o.x), R2I(o.margin * 100))).join(' '));
        t.done();
        return;
      }
      t.after(1, watch);
    };
    t.after(1, watch);
  }, CONVERGE_CAP + 60);
}

// --- Balance: which station layout? ------------------------------------------

/**
 * Balance harness ('bf...', out of the sweep): the same party and camp run
 * under different station layouts, to see whether more, tighter stations
 * settle the answer sooner without the fights leaking into each other or the
 * AI spreading itself thin. Reports the estimate every 30 s, the stray count
 * (unit-ticks spent nearer another station than its own) and casts per
 * station in the opening.
 */
interface Layout {
  name: string; stations: Array<{ x: number; y: number }>;
  approach: number; leash: number; angles: number[];
}

function row(y: number, n: number, spacing: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * spacing, y });
  return out;
}

const ALONG = [0, 25, -25, 180, 155, 205];
const ACROSS = [90, 270, 65, 115, 245, 295];

const LAYOUTS: Layout[] = [
  { name: 'a12', stations: [...row(-2400, 6, 1000), ...row(2650, 6, 1000)], approach: 450, leash: 500, angles: ALONG },
  { name: 'b16', stations: [...row(-2400, 8, 750), ...row(2650, 8, 750)], approach: 450, leash: 375, angles: ACROSS },
  { name: 'c20', stations: [...row(-2400, 10, 600), ...row(2650, 10, 600)], approach: 400, leash: 300, angles: ACROSS },
  // Today's spacing, approached from above and below -- the game's layout
  // since the layout runs found it strays far less for the same answer.
  { name: 'a12x', stations: [...row(-2400, 6, 1000), ...row(2650, 6, 1000)], approach: 450, leash: 500, angles: ACROSS },
  {
    name: 'd24', stations: [...row(-2400, 10, 600), ...row(2150, 7, 850), ...row(3150, 7, 850)],
    approach: 400, leash: 300, angles: ACROSS,
  },
];
const LAYOUT_CAP = 300;

for (const layout of LAYOUTS) {
  for (const c of CONVERGE_CASES) {
    if (c.name === 'tcdr') continue;
    registerTest('bflayout' + layout.name + c.name, (t: TestReporter) => {
      setDPSLayoutForTest(layout.stations, layout.approach, layout.leash, layout.angles);
      beginNewRun();
      setRosterForTest(c.heroes);
      setMercsForTest(c.mercs.map(id => FourCC(id)));
      setCampForTest(c.camp);
      loadInterRoundLobby();
      let casts = 0;
      const castTrig = CreateTrigger()!;
      for (const p of getDPSCheckPlayers()) TriggerRegisterPlayerUnitEvent(castTrig, p.handle, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
      TriggerAddAction(castTrig, () => { if (getDPSCheckStatus().phase === 'rigged') casts += 1; });
      startDPSCheck();
      const marks: string[] = [];
      let lastMark = 0;
      const watch = (): void => {
        const s = getDPSCheckStatus();
        if (s.elapsed - lastMark >= 30) {
          lastMark = s.elapsed;
          marks.push(string.format('%d:x%.2f/%d/%.2f', R2I(s.elapsed), s.scale, s.fightsFinished,
            s.centerError < 100 ? s.centerError : 9.99));
        }
        if (s.phase === 'done' || s.elapsed >= LAYOUT_CAP) {
          DestroyTrigger(castTrig);
          t.report('stations', s.stations);
          t.report('converged', s.phase === 'done' ? 1 : 0);
          t.report('seconds', s.elapsed);
          t.report('scale', s.scale);
          t.report('fights', s.fightsFinished);
          t.report('fightsPerMinute', s.fightsFinished / s.elapsed * 60);
          t.report('openingCastsPerStation', casts / s.stations);
          t.report('strayTicks', s.strayTicks);
          t.report('trace', marks.join(' '));
          stopDPSCheck();
          resetDPSLayoutForTest();
          t.done();
          return;
        }
        t.after(1, watch);
      };
      t.after(1, watch);
    }, LAYOUT_CAP + 60);
  }
}

// --- Balance: how many stations can one AI run? ------------------------------

/**
 * Balance harness ('bf...', out of the sweep): one AI, 3 to 18 stations, all
 * 1000 apart and approached across, so only the count changes. Above 12 the
 * extra stations go in a second row in the tall top band. Runs only the
 * rigged opening -- everything alive throughout, so casts are comparable --
 * three times per count, and reports casts per station and the opening's
 * scale. A count the AI cannot keep up with shows as fewer casts per station
 * and a weaker party (a lower scale).
 */
const AI_LOAD_SLOTS: Array<{ x: number; y: number }> = [
  ...row(-2400, 6, 1000), ...row(2200, 6, 1000), ...row(3150, 6, 1000),
];
const AI_LOAD_COUNTS = [3, 6, 9, 12, 15, 18];
const AI_LOAD_REPEATS = 3;
const MKPAL: ConvergeCase = {
  name: 'mkpal', camp: 217, mercs: ['nogl'], heroes: [
    hero(Units.MountainKing, 300, [[Abilities.StormBolt, 2], [Abilities.ThunderClap, 1], [Abilities.Bash, 1]]),
    hero(Units.Paladin, 300, [[Abilities.HolyLight, 2], [Abilities.DevotionAura, 1], [Abilities.DivineShield, 1]]),
  ],
};

for (const c of [CONVERGE_CASES[0], MKPAL]) {
  for (const n of AI_LOAD_COUNTS) {
    registerTest('bfaiload' + c.name + tostring(n), (t: TestReporter) => {
      // Spread across the slots rather than the first n, so a small count is
      // not all in one row.
      const stations: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) stations.push(AI_LOAD_SLOTS[Math.floor(i * AI_LOAD_SLOTS.length / n)]);
      setDPSLayoutForTest(stations, 400, 450, ACROSS);
      beginNewRun();
      setRosterForTest(c.heroes);
      setMercsForTest(c.mercs.map(id => FourCC(id)));
      setCampForTest(c.camp);
      loadInterRoundLobby();
      let casts = 0;
      const castTrig = CreateTrigger()!;
      for (const p of getDPSCheckPlayers()) TriggerRegisterPlayerUnitEvent(castTrig, p.handle, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
      TriggerAddAction(castTrig, () => { if (getDPSCheckStatus().phase === 'rigged') casts += 1; });
      const perStation: string[] = [];
      const scales: string[] = [];
      let sumPer = 0;
      let sumScale = 0;
      const rep = (k: number): void => {
        if (k >= AI_LOAD_REPEATS) {
          DestroyTrigger(castTrig);
          t.report('stations', n);
          t.report('castsPerStation', perStation.join(' '));
          t.report('meanCastsPerStation', sumPer / AI_LOAD_REPEATS);
          t.report('openingScales', scales.join(' '));
          t.report('meanOpeningScale', sumScale / AI_LOAD_REPEATS);
          resetDPSLayoutForTest();
          t.done();
          return;
        }
        casts = 0;
        startDPSCheck();
        t.waitFor('opening' + I2S(k), phaseIs('fights'), RIGGED_SECONDS + 5, () => {
          const s = getDPSCheckStatus();
          perStation.push(string.format('%.2f', casts / n));
          scales.push(string.format('%.2f', s.riggedScale));
          sumPer += casts / n;
          sumScale += s.riggedScale;
          stopDPSCheck();
          t.after(1, () => rep(k + 1));
        });
      };
      rep(0);
    }, 120);
  }
}

// --- Balance: the same 18 stations on one AI or on three ---------------------

/**
 * Balance harness ('bf...', out of the sweep): the game's own layout, with the
 * stations run by one check player or shared among all three. The rigged
 * opening only, three times over, as in bfaiload; also reports how many
 * casts came from each check player, so an AI that never casts shows.
 */
for (const c of [CONVERGE_CASES[0], MKPAL]) {
  for (const owners of [1, 3]) {
    registerTest('bfaiowners' + c.name + tostring(owners), (t: TestReporter) => {
      resetDPSLayoutForTest();
      setDPSOwnerLimitForTest(owners);
      beginNewRun();
      setRosterForTest(c.heroes);
      setMercsForTest(c.mercs.map(id => FourCC(id)));
      setCampForTest(c.camp);
      loadInterRoundLobby();
      const players = getDPSCheckPlayers();
      const byPlayer: number[] = players.map(() => 0);
      let casts = 0;
      const castTrig = CreateTrigger()!;
      for (const p of players) TriggerRegisterPlayerUnitEvent(castTrig, p.handle, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
      TriggerAddAction(castTrig, () => {
        if (getDPSCheckStatus().phase !== 'rigged') return;
        casts += 1;
        const owner = GetOwningPlayer(GetTriggerUnit()!);
        for (let i = 0; i < players.length; i++) if (players[i].handle === owner) byPlayer[i] += 1;
      });
      const perStation: string[] = [];
      const scales: string[] = [];
      let sumPer = 0;
      let sumScale = 0;
      let n = 0;
      const rep = (k: number): void => {
        if (k >= AI_LOAD_REPEATS) {
          DestroyTrigger(castTrig);
          t.report('stations', n);
          t.report('owners', owners);
          t.report('castsPerStation', perStation.join(' '));
          t.report('meanCastsPerStation', sumPer / AI_LOAD_REPEATS);
          t.report('openingScales', scales.join(' '));
          t.report('meanOpeningScale', sumScale / AI_LOAD_REPEATS);
          t.report('castsByPlayer', byPlayer.map(v => tostring(v)).join(' '));
          resetDPSLayoutForTest();
          t.done();
          return;
        }
        casts = 0;
        startDPSCheck();
        t.waitFor('opening' + tostring(k), phaseIs('fights'), RIGGED_SECONDS + 5, () => {
          const s = getDPSCheckStatus();
          n = s.stations;
          perStation.push(string.format('%.2f', casts / n));
          scales.push(string.format('%.2f', s.riggedScale));
          sumPer += casts / n;
          sumScale += s.riggedScale;
          stopDPSCheck();
          t.after(1, () => rep(k + 1));
        });
      };
      rep(0);
    }, 120);
  }
}
