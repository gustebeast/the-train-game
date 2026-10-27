import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { Players } from 'w3ts/globals';
import { registerTest, TestReporter } from './testKit';
import {
  measureFieldedForce, setCampForTest, getCampDamageScale,
} from '../creeps';
import { CREEP_CAMPS } from '../creepCamps';
import { HeroData, setRosterForTest, spawnHeroes, getChosenHeroCount, hasHeroes } from '../heroes';
import { setMercsForTest, spawnMercWithHeroes, buyMercContract, hasActiveMerc } from '../mercenary';
import { getDPSCheckStatus, getDPSStation, startDPSCheck, RIGGED_SECONDS } from '../dpsCheck';
import { getDPSCheckPlayer, getNeutralAggressive, toggleDPSVision } from '../teams';
import { getHumanPlayers, forEachUnitOfPlayer, forEachGroundItem, forEachDestructable } from '../util';
import { loadInterRoundLobby, beginNewRun, loadTerrain } from '../terrain/load';
import { gameState } from '../state';
import { CAGE_RAW } from '../sharedData';

/**
 * The DPS check (dpsCheck.ts): twelve copies of the party fighting the round's
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

/** gnoll assassins x2, overseer, warden: four creeps. */
const FIELD_CAMP = 217;

function countItems(): number {
  let n = 0;
  forEachGroundItem(() => { n += 1; });
  return n;
}

function checkUnits(): unit[] {
  const out: unit[] = [];
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => { out.push(u); });
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
  const check = getDPSCheckPlayer().handle;
  let casts = 0;
  const castTrig = CreateTrigger()!;
  TriggerRegisterPlayerUnitEvent(castTrig, check, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
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
  const dps = getDPSCheckPlayer().handle;
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
  setRosterForTest([FAR_SEER, PRIESTESS]);
  setMercsForTest([FourCC('nogl')]);
  setCampForTest(FIELD_CAMP);
  loadTerrain(gameState.round);
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
