import { Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { registerTest, TestReporter } from './testKit';
import {
  getSparringStatus, setCampForTest, cancelSparringMatch, getSparringSecondsToMinimum,
  getDPSMeasured, spawnScaledCampForTest, getCampDPSAdvantage, getCampData, getDPSSampleBreakdown,
} from '../creeps';
import { HeroData, setRosterForTest, getChosenHeroData, spawnHeroFromData } from '../heroes';
import { setMercsForTest, getLivingMercData, spawnMercFromData } from '../mercenary';
import { getDPSCheckPlayer } from '../teams';
import { forEachUnitOfPlayer, isAlive, removeUnitsSummonsFirst } from '../util';
import { loadInterRoundLobby, beginNewRun } from '../terrain/load';

/**
 * Balance harness for camp scaling: does the scaled camp actually beat the
 * party it was scaled against, and by how much?
 *
 * Runs the lobby's sparring match for its minimum ten seconds -- the shortest
 * a player can make it by readying up at once -- then fights the camp FOR REAL
 * six times over: real HP, scaled exactly as a round scales it, against copies
 * of the same party, all fought by the check player's AI. Each copy fights to a
 * finish and reports the winner and how much of the winner was left.
 *
 * Registered as 'bf...' so the sweep leaves it out: it is a measurement, not a
 * pass/fail check.
 */

const START_WAIT = 5;
/** A safety net; a real camp fight has no timer. */
const BATTLE_CAP = 150;
const TICK = 0.5;
/** Same places as the sparring copies, out in the side strips. */
const COPIES: ReadonlyArray<{ x: number; y: number; approach: number }> = [
  { x: -1984, y: -950, approach: 210 },
  { x: -1984, y: 0, approach: 0 },
  { x: -1984, y: 950, approach: 150 },
  { x: 2048, y: -950, approach: 330 },
  { x: 2048, y: 0, approach: 180 },
  { x: 2048, y: 950, approach: 30 },
];
const APPROACH = 512;
const LEASH = 700;

function hero(type: string, xp: number, skills: Record<string, number>, items: string[] = []): HeroData {
  return {
    typeId: FourCC(type), xp, skills, items: items.map(id => ({ id: FourCC(id), charges: 0 })),
    tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0,
  };
}

interface BattleComp { name: string; heroes: HeroData[]; mercs: string[]; camp: number }

function sk(pairs: Array<[string, number]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of pairs) out[id] = n;
  return out;
}

const COMPS: BattleComp[] = [
  // The user's save: both level 2, Draenei Harbinger and Wildkin, camp 90.
  {
    name: 'user', camp: 90, mercs: ['ndrh', 'nowb'], heroes: [
      hero(Units.PriestessOfTheMoon, 189, sk([[Abilities.SearingArrows, 1]])),
      hero(Units.FarSeer, 189, sk([[Abilities.ChainLightning, 1], [Abilities.FeralSpirit, 1]]), ['rin1', 'wswd']),
    ],
  },
  {
    name: 'usernomerc', camp: 90, mercs: [], heroes: [
      hero(Units.PriestessOfTheMoon, 189, sk([[Abilities.SearingArrows, 1]])),
      hero(Units.FarSeer, 189, sk([[Abilities.ChainLightning, 1], [Abilities.FeralSpirit, 1]]), ['rin1', 'wswd']),
    ],
  },
  {
    name: 'mkpal', camp: 217, mercs: ['nogl'], heroes: [
      hero(Units.MountainKing, 300, sk([[Abilities.StormBolt, 2], [Abilities.ThunderClap, 1], [Abilities.Bash, 1]])),
      hero(Units.Paladin, 300, sk([[Abilities.HolyLight, 2], [Abilities.DevotionAura, 1], [Abilities.DivineShield, 1]])),
    ],
  },
  {
    name: 'bmlich', camp: 217, mercs: [], heroes: [
      hero(Units.Blademaster, 300, sk([[Abilities.CriticalStrike, 2], [Abilities.WindWalk, 1], [Abilities.MirrorImage, 1]])),
      hero(Units.Lich, 300, sk([[Abilities.FrostNova, 2], [Abilities.FrostArmor, 1], [Abilities.DarkRitual, 1]])),
    ],
  },
  {
    name: 'tcdr', camp: 387, mercs: ['nogl', 'nfsh'], heroes: [
      hero(Units.TaurenChieftain, 500, sk([[Abilities.WarStomp, 2], [Abilities.Shockwave, 2], [Abilities.EnduranceAura, 2]])),
      hero(Units.DarkRanger, 500, sk([[Abilities.Silence, 2], [Abilities.BlackArrow, 2], [Abilities.LifeDrain, 2]])),
    ],
  },
];

interface Copy {
  cx: number; cy: number;
  force: Unit[];
  creeps: Unit[];
  /** Positive: the party won with this share of its HP left. Negative: the
   *  camp won with this share left. Null while undecided. */
  margin: number | null;
  seconds: number;
}

function hpShare(units: Unit[]): number {
  let life = 0;
  let max = 0;
  for (const u of units) {
    max += BlzGetUnitMaxHP(u.handle);
    if (isAlive(u.handle)) life += GetUnitState(u.handle, UNIT_STATE_LIFE);
  }
  return max > 0 ? life / max : 0;
}

function anyAlive(units: Unit[]): boolean {
  return units.some(u => isAlive(u.handle));
}

interface Variant { suffix: string; dps: number | null; ehp: number; fullMatch: boolean; rawHP: boolean }

function runBattle(comp: BattleComp, v: Variant, t: TestReporter): void {
  const dpsAdvantage = v.dps ?? getCampDPSAdvantage();
  const ehpMultiplier = v.ehp;
  beginNewRun();
  setRosterForTest(comp.heroes);
  setMercsForTest(comp.mercs.map(id => FourCC(id)));
  setCampForTest(comp.camp);
  loadInterRoundLobby();
  const check = getDPSCheckPlayer();

  t.waitFor('matchStarts', () => getSparringStatus().timer, START_WAIT, () => {
    const ended = (): boolean => v.fullMatch
      ? !getSparringStatus().timer
      : getSparringSecondsToMinimum() === 0;
    t.waitFor('matchMeasured', ended, 40, () => {
      if (!v.fullMatch) cancelSparringMatch();
      const b = getDPSSampleBreakdown();
      t.report('fullMatch', v.fullMatch ? 1 : 0);
      t.report('rawHP', v.rawHP ? 1 : 0);
      t.report('creepHPLost', b.creepHPLost);
      t.report('ourHPLost', b.ourHPLost);
      t.report('summonHPLost', b.summonHPLost);
      const m = getDPSMeasured();
      const camp = getCampData();
      t.report('comp', comp.name);
      t.report('camp', comp.camp);
      t.report('campLevel', camp != null ? camp.level : -1);
      t.report('dpsAdvantage', dpsAdvantage);
      t.report('ehpMultiplier', ehpMultiplier);
      t.report('measuredOurDPS', m.heroDPS);
      t.report('measuredCreepDPS', m.creepDPS);

      // Engine XP from the creeps would level the heroes mid-fight.
      SetPlayerHandicapXP(check.handle, 0);
      t.after(0.5, () => {
        const heroes = getChosenHeroData();
        const mercs = getLivingMercData();
        const copies: Copy[] = [];
        for (const c of COPIES) {
          const hx = c.x + APPROACH * Cos(c.approach * bj_DEGTORAD);
          const hy = c.y + APPROACH * Sin(c.approach * bj_DEGTORAD);
          const force: Unit[] = [];
          for (const h of heroes) {
            const u = spawnHeroFromData(h, check, hx, hy);
            if (u != null) force.push(u);
          }
          for (let i = 0; i < mercs.length; i++) {
            const u = spawnMercFromData(mercs[i], check, hx + i * 96, hy - 96);
            if (u != null) force.push(u);
          }
          copies.push({ cx: c.x, cy: c.y, force, creeps: [], margin: null, seconds: 0 });
        }
        // A frame for tome and item bonuses before the force is measured.
        t.after(0.5, () => {
          for (let i = 0; i < copies.length; i++) {
            const cp = copies[i];
            const scaled = spawnScaledCampForTest(cp.cx, cp.cy, cp.force, dpsAdvantage, ehpMultiplier, v.rawHP);
            cp.creeps = scaled.creeps;
            if (i === 0) {
              t.report('dpsScale', scaled.dpsScale);
              t.report('ehpScale', scaled.ehpScale);
              let fhp = 0;
              for (const u of cp.force) fhp += BlzGetUnitMaxHP(u.handle);
              let chp = 0;
              for (const u of cp.creeps) chp += BlzGetUnitMaxHP(u.handle);
              t.report('forceHP', fhp);
              t.report('campHP', chp);
            }
            for (const u of cp.force) IssuePointOrder(u.handle, 'attack', cp.cx, cp.cy);
          }
          let elapsed = 0;
          const tick = (): void => {
            elapsed += TICK;
            let open = 0;
            for (const cp of copies) {
              if (cp.margin != null) continue;
              const partyUp = anyAlive(cp.force);
              const campUp = anyAlive(cp.creeps);
              if (!campUp || !partyUp || elapsed >= BATTLE_CAP) {
                cp.seconds = elapsed;
                cp.margin = !campUp ? hpShare(cp.force) : (!partyUp ? -hpShare(cp.creeps) : 0);
                for (const u of [...cp.force, ...cp.creeps]) {
                  if (isAlive(u.handle)) PauseUnit(u.handle, true);
                }
                continue;
              }
              open += 1;
              for (const u of cp.force) {
                if (!isAlive(u.handle)) continue;
                const dx = GetUnitX(u.handle) - cp.cx;
                const dy = GetUnitY(u.handle) - cp.cy;
                if (dx * dx + dy * dy > LEASH * LEASH || GetUnitCurrentOrder(u.handle) === 0) {
                  IssuePointOrder(u.handle, 'attack', cp.cx, cp.cy);
                }
              }
            }
            if (open > 0) { t.after(TICK, tick); return; }

            let partyWins = 0;
            let campWins = 0;
            let sum = 0;
            const margins: number[] = [];
            for (let i = 0; i < copies.length; i++) {
              const cp = copies[i];
              const mg = cp.margin ?? 0;
              if (mg > 0) partyWins += 1;
              else if (mg < 0) campWins += 1;
              sum += mg;
              margins.push(mg);
              t.report('copy' + I2S(i) + 'Margin', R2I(mg * 100));
              t.report('copy' + I2S(i) + 'Seconds', cp.seconds);
            }
            margins.sort((a, b) => a - b);
            t.report('partyWins', partyWins);
            t.report('campWins', campWins);
            t.report('meanMarginPct', R2I(sum / copies.length * 100));
            t.report('medianMarginPct', R2I((margins[2] + margins[3]) / 2 * 100));

            for (const cp of copies) {
              for (const u of cp.creeps) if (u.handle != null) RemoveUnit(u.handle);
            }
            const all: unit[] = [];
            forEachUnitOfPlayer(check.handle, u => { all.push(u); });
            removeUnitsSummonsFirst(all);
            SetPlayerHandicapXP(check.handle, 1);
            t.done();
          };
          t.after(TICK, tick);
        });
      });
    });
  });
}

/** Damage advantages to try, by name suffix: '' is whatever the game uses now. */
const VARIANTS: Variant[] = [
  { suffix: '', dps: null, ehp: 1, fullMatch: false, rawHP: false },
  { suffix: 'full', dps: null, ehp: 1, fullMatch: true, rawHP: false },
  { suffix: 'raw', dps: null, ehp: 1, fullMatch: false, rawHP: true },
];

for (const comp of COMPS) {
  for (const v of VARIANTS) {
    registerTest('bfcb' + comp.name + v.suffix,
      (t: TestReporter) => runBattle(comp, v, t),
      BATTLE_CAP + 60);
  }
}
