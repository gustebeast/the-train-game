import { Timer, Trigger, Unit } from 'w3ts';
import {
  getCampData, getCampDPSAdvantage, setCampDamageScale, getCampDamageScale,
  spawnUnscaledCampCopy, scaleCampCopy, getStatDPS, onCageBroken,
} from './creeps';
import { HeroData, getChosenHeroData, spawnHeroFromData } from './heroes';
import { MercData, getLivingMercData, spawnMercFromData } from './mercenary';
import { isChallengeArmed } from './challenges';
import { CH_TOUGH_CAMP } from './challengeList';
import { getDPSCheckPlayers, getNeutralAggressive } from './teams';
import { MapPlayer } from 'w3ts';
import { forEachUnitOfPlayer, forEachInventoryItem, isAlive, removeUnitsSummonsFirst } from './util';

/**
 * The DPS check: how hard the next camp should hit, found by fighting it.
 *
 * The goal is a camp that an AI-controlled copy of the party JUST BARELY loses
 * to, on average. A human plays the party better than the check player's AI
 * does, so a camp the AI narrowly loses to is one the players narrowly beat.
 * What the check tunes is the multiplier on the camp's damage; its HP is always
 * pegged to the party's raw HP (creeps.ts roundScaleFactors).
 *
 * It runs out of sight in two rows of fight stations -- one below the board,
 * one above, beyond the wall that rings it (spawn.ts wallBoard) -- from the
 * moment a round loads until its cage is broken, so all the time the players
 * spend working towards the camp goes into the answer. Nothing it measures
 * changes in that time: the party and the camp are settled when the round
 * loads. Eighteen copies of the party fight at once, each against its own copy
 * of the camp:
 *
 *   - A FIRST GUESS, from the units' own attack damage -- times what the
 *     last round learned about how far that estimate is off for this run's
 *     parties (learnedRatio), or the advantage when nothing has been learned.
 *     It is only a starting point, so the first fights are spread wide round
 *     it: about x0.5 to x2 cold, x0.8 to x1.3 warm.
 *
 *   - REAL FIGHTS, for as long as there is time. Real HP, the camp scaled as a
 *     round scales it, each station at its own damage scale spread around the
 *     current best guess, and each approaching from its own side. A finished
 *     fight is a point -- scale tried, margin won or lost by -- and an S-shaped
 *     curve through the points says where the margin crosses the target. A
 *     fight already lopsided at 20 s is called there, so the stations spend
 *     their time on the close ones. The next fights are spread round the
 *     crossing, narrower as the answer firms up, so eighteen fights at a time
 *     test eighteen scales at a time.
 *
 * There used to be a rigged opening -- nobody could die, HP lost counted both
 * ways -- for the first guess. It was right for some parties and far off for
 * others (x0.7 for a Blademaster and Lich whose answer was about x2: rigged,
 * its Mirror Images soaked the camp), and a far-off guess cost minutes.
 *
 * It stops when the cage is broken -- banking how the long-running unfinished
 * fights stand -- or once the answer has stopped moving (isConverged). Any
 * board load ends it (spawn.ts clearBoard).
 *
 * Every unit of ours belongs to one of the check players (teams.ts), which
 * share the stations out: only a slot the map makes a computer runs an AI
 * that casts, and one AI casts less per station the more it runs.
 */

// --- Where the fights happen -------------------------------------------------

/**
 * Eighteen stations, 1000 apart: a row of six below the board and two rows of
 * six in the taller band above.
 *
 * The board's edge is y +-1344 and its wall a cell beyond; a second, full-width
 * wall at y +-1664 (spawn.ts) keeps every fight further out than a test fight
 * the user could not hear from the board (about 500 out). The rows' ground
 * runs from there to the map edge: y -1728..-3072 below, 1728..3584 above.
 */
const ROW_YS: ReadonlyArray<number> = [-2400, 2200, 3150];
const STATION_XS: ReadonlyArray<number> = [-2500, -1500, -500, 500, 1500, 2500];
let STATIONS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const out: Array<{ x: number; y: number }> = [];
  for (const y of ROW_YS) for (const x of STATION_XS) out.push({ x, y });
  return out;
})();
/** How far from its camp a party starts. */
let APPROACH = 400;
/** Sides a party may come in from, in degrees: from above or below, across the
 *  row, drawn afresh every fight so which unit gets hit first varies
 *  independently of the scale being tried. Across rather than along it:
 *  measured, coming in along the row put parties beside the next station and
 *  units strayed there three to six times as often, for the same answer. */
let APPROACH_ANGLES: ReadonlyArray<number> = [90, 270, 65, 115, 245, 295];
/** How far a unit may wander from its station before it is sent back: half
 *  the spacing, so no fight drifts into its neighbour's, and beyond APPROACH,
 *  so a party is not walked onto its camp before the camp is down. */
let LEASH = 450;

// --- Timing ------------------------------------------------------------------

/** How long an unfinished fight must have run for its lead to count when
 *  the cage breaks. Measured: the side ahead at 10 s won 81% of fights, at
 *  20 s 95%. */
const MIN_BANKED_SECONDS = 10;
/** A safety net: a fight still going after this long is called on its lead. */
const FIGHT_CAP = 120;
const TICK = 0.5;
/** A fight this far from the target this long in is called on its lead:
 *  measured, the side ahead at 20 s went on to win 95% of fights. */
const CALL_SECONDS = 20;
const CALL_MARGIN = 0.35;

// --- The target ----------------------------------------------------------------

/** The margin the check aims for: the camp wins with this share of its HP
 *  left. Negative is a camp win. */
const TARGET_MARGIN = -0.1;
/** With the Tough Creep Camp challenge armed: a clear camp win. */
const TOUGH_TARGET_MARGIN = -0.35;

function targetMargin(): number {
  return isChallengeArmed(CH_TOUGH_CAMP) ? TOUGH_TARGET_MARGIN : TARGET_MARGIN;
}

// --- State -------------------------------------------------------------------

type Phase = 'idle' | 'fights' | 'done';
let phase: Phase = 'idle';
/** The party being measured, as it was when the check began. */
let heroes: HeroData[] = [];
let mercs: MercData[] = [];

/** Runs from the start of the check; its elapsed time is the check's clock. */
let clock: Timer | null = null;
let ticker: Timer | null = null;
let deathTrig: Trigger | null = null;

function now(): number {
  return clock != null ? clock.elapsed : 0;
}

/** The computer player that runs station i: the stations are dealt out in
 *  turn, so each AI's share is spread over every row. */
function stationOwner(i: number): MapPlayer {
  const players = getDPSCheckPlayers();
  const n = ownerLimit > 0 ? Math.min(ownerLimit, players.length) : players.length;
  return players[i % n];
}

/** For tests: run the stations on only the first n check players (0: all). */
let ownerLimit = 0;
export function setDPSOwnerLimitForTest(n: number): void {
  ownerLimit = n;
}

/** Every unit any check player owns. */
function forEachCheckUnit(cb: (this: void, u: unit) => void): void {
  for (const p of getDPSCheckPlayers()) forEachUnitOfPlayer(p.handle, cb);
}

/** Which station each of the check's units belongs to, by handle id: recorded
 *  when it is first seen, beside its own camp. Summons included. */
const home = new Map<number, number>();
/** Handle ids of every creep the check has put down. */
const ourCreeps = new Set<number>();

// --- Starting and stopping ---------------------------------------------------

/** Begin measuring this round's party against this round's camp. Called as
 *  the round loads; anything already running is thrown away. */
export function startDPSCheck(): void {
  stopDPSCheck();
  heroes = getChosenHeroData().map(h => copyHero(h));
  mercs = getLivingMercData().map(m => ({ typeId: m.typeId, items: m.items.map(it => ({ id: it.id, charges: it.charges })) }));
  resetEstimate();
  strayTicks = 0;
  // Last round's answer is not this round's.
  setCampDamageScale(0);
  if (heroes.length === 0 || getCampData() == null) return;

  // untracked: the check's clock; it owns it (stopDPSCheck).
  clock = Timer.create();
  clock.start(1e6, false, () => undefined);
  // untracked: the check owns it (stopDPSCheck).
  ticker = Timer.create();
  // A fight's end could come from death events, but the leash and the HP
  // sampling cannot.
  // periodic: watches the fights -- who is still standing, HP lost in the opening, and leashing.
  ticker.start(TICK, true, () => tick());
  phase = 'fights';
}

/** Stop and take everything off the field. The answer found so far stays set
 *  (creeps.ts), for the round it was measured for. */
export function stopDPSCheck(): void {
  if (phase === 'idle') return;
  clearField();
  if (ticker != null) { ticker.destroy(); ticker = null; }
  if (clock != null) { clock.destroy(); clock = null; }
  phase = 'idle';
}

function copyHero(h: HeroData): HeroData {
  const skills: Record<string, number> = {};
  for (const [k, v] of pairs(h.skills)) skills[k] = v;
  return {
    typeId: h.typeId, xp: h.xp, skills, items: h.items.map(it => ({ id: it.id, charges: it.charges })),
    tomeStr: h.tomeStr, tomeAgi: h.tomeAgi, tomeInt: h.tomeInt, tomeHP: h.tomeHP,
  };
}

/** Bank the unfinished fights as they stand, fix the answer, and stop. The
 *  round's cage has broken: its camp is about to be scaled. */
function finish(): void {
  if (phase === 'fights') {
    for (let i = 0; i < STATIONS.length; i++) {
      const f = fights[i];
      if (f == null || f.creeps.length === 0) continue;
      const t = now() - f.started;
      // Under ten seconds, who is ahead says too little: in real fights cut
      // short, the side ahead at 5 s went on to win only 71% of the time.
      if (t < MIN_BANKED_SECONDS) continue;
      // And even after that it is a weaker witness than who won.
      record(f.scale, lead(f), 0.3 * Math.min(1, t / 20));
    }
    refit(generation);
  }
  learn();
  stopDPSCheck();
}

export function initDPSCheck(): void {
  // Creeps dying in the check would level its heroes mid-fight.
  for (const p of getDPSCheckPlayers()) SetPlayerHandicapXP(p.handle, 0);
  // A hero or mercenary dying drops what it carries: take it first. Items are
  // the check's own copies, but on the ground they would be anybody's.
  deathTrig = Trigger.create();
  for (const p of getDPSCheckPlayers()) {
    TriggerRegisterPlayerUnitEvent(deathTrig.handle, p.handle, EVENT_PLAYER_UNIT_DEATH, undefined);
  }
  deathTrig.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null) return;
    const carried: item[] = [];
    forEachInventoryItem(u, it => { carried.push(it); });
    for (const it of carried) RemoveItem(it);
  });
  onCageBroken(() => finish());
}

// --- Fielding ----------------------------------------------------------------

/** Put one copy of the party down at `angle` from station `i`, owned by the
 *  station's check player, and return it. */
function fieldParty(i: number, angle: number): Unit[] {
  const st = STATIONS[i];
  const x = st.x + APPROACH * Cos(angle * bj_DEGTORAD);
  const y = st.y + APPROACH * Sin(angle * bj_DEGTORAD);
  const check = stationOwner(i);
  const force: Unit[] = [];
  for (const h of heroes) {
    const u = spawnHeroFromData(h, check, x, y);
    if (u != null) force.push(u);
  }
  for (let m = 0; m < mercs.length; m++) {
    const u = spawnMercFromData(mercs[m], check, x + m * 96, y - 96);
    if (u != null) force.push(u);
  }
  for (const u of force) home.set(GetHandleId(u.handle), i);
  return force;
}

function noteCreeps(i: number, creeps: Unit[]): void {
  for (const c of creeps) {
    ourCreeps.add(GetHandleId(c.handle));
    home.set(GetHandleId(c.handle), i);
  }
}

function attack(units: Unit[], i: number): void {
  const st = STATIONS[i];
  for (const u of units) IssuePointOrder(u.handle, 'attack', st.x, st.y);
}

function randomAngle(): number {
  return APPROACH_ANGLES[GetRandomInt(0, APPROACH_ANGLES.length - 1)];
}

/** Remove one station's units -- party, summons, camp -- or every station's. */
function clearStation(i: number | null): void {
  const units: unit[] = [];
  forEachCheckUnit(u => {
    if (i == null || home.get(GetHandleId(u)) === i) units.push(u);
  });
  forEachUnitOfPlayer(getNeutralAggressive().handle, u => {
    const id = GetHandleId(u);
    if (ourCreeps.has(id) && (i == null || home.get(id) === i)) units.push(u);
  });
  for (const u of units) {
    const id = GetHandleId(u);
    home.delete(id);
    ourCreeps.delete(id);
  }
  removeUnitsSummonsFirst(units);
}

function clearField(): void {
  clearStation(null);
  home.clear();
  ourCreeps.clear();
  for (let i = 0; i < STATIONS.length; i++) fights[i] = null;
}

/** Keep every unit of the check's at its own station; anything new is a
 *  summon, a charmed creep or an illusion, and belongs where it appeared. */
function leash(): void {
  forEachCheckUnit(u => {
    if (!isAlive(u)) return;
    const id = GetHandleId(u);
    let i = home.get(id);
    if (i == null) {
      i = nearestStation(GetUnitX(u), GetUnitY(u));
      home.set(id, i);
    }
    const st = STATIONS[i];
    const dx = GetUnitX(u) - st.x;
    const dy = GetUnitY(u) - st.y;
    if (dx * dx + dy * dy > LEASH * LEASH) IssuePointOrder(u, 'attack', st.x, st.y);
    if (nearestStation(GetUnitX(u), GetUnitY(u)) !== i) strayTicks += 1;
  });
}

/** Unit-ticks spent nearer another station than its own: how much the
 *  fights leak into each other. Diagnostics, for choosing a layout. */
let strayTicks = 0;

function nearestStation(x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < STATIONS.length; i++) {
    const d = (STATIONS[i].x - x) ** 2 + (STATIONS[i].y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// --- Real fights -----------------------------------------------------------------

interface Fight {
  station: number;
  scale: number;
  force: Unit[];
  /** Empty until the camp is put down, a tick after the party. */
  creeps: Unit[];
  started: number;
  /** The step the guess was on when this fight was launched; see refit. */
  generation: number;
  /** Each side's full HP when the fight began: the share of it still
   *  standing is the margin. Kept, because a corpse that decays takes its
   *  max HP with it. */
  forceMax: number;
  campMax: number;
}

/** Each station's fight, by station index, or null between fights.
 *
 *  Index it by station and loop over STATIONS.length, never over this: in Lua
 *  a null is a hole, and the length of a list with holes is whatever border
 *  the runtime finds first. Clearing the field by its length stopped early
 *  and left the last two stations' fights standing into the next check, which
 *  "finished" them at once with nonsense and dragged the guess to x0.05. */
const fights: Array<Fight | null> = [];

function startFight(i: number): void {
  fights[i] = {
    station: i, scale: 0, force: fieldParty(i, randomAngle()), creeps: [], started: now(),
    generation, forceMax: 0, campMax: 0,
  };
}

function maxHP(units: Unit[]): number {
  let max = 0;
  for (const u of units) max += BlzGetUnitMaxHP(u.handle);
  return max;
}

/** The share of `max` the living ones among `units` still have. */
function hpShare(units: Unit[], max: number): number {
  let life = 0;
  for (const u of units) {
    if (isAlive(u.handle)) life += GetUnitState(u.handle, UNIT_STATE_LIFE);
  }
  return max > 0 ? life / max : 0;
}

/** Creeps still fighting for the camp: alive, and not charmed away. */
function campStanding(f: Fight): Unit[] {
  const owner = getNeutralAggressive().handle;
  return f.creeps.filter(c => isAlive(c.handle) && GetOwningPlayer(c.handle) === owner);
}

/** Party HP share minus camp HP share: who is ahead, and by how much. */
function lead(f: Fight): number {
  return hpShare(f.force, f.forceMax) - hpShare(campStanding(f), f.campMax);
}

function watchFight(f: Fight): void {
  if (f.creeps.length === 0) {
    // The party has had its frame (tome bonuses land a frame after a hero
    // spawns): measure it, put its camp down, and pick the scale to try.
    f.creeps = spawnUnscaledCampCopy(STATIONS[f.station].x, STATIONS[f.station].y);
    if (!guessed) firstGuess(f.force, f.creeps);
    f.scale = Math.exp(nextX());
    f.generation = generation;
    scaleCampCopy(f.creeps, f.force, f.scale);
    f.forceMax = maxHP(f.force);
    f.campMax = maxHP(f.creeps);
    noteCreeps(f.station, f.creeps);
    attack(f.force, f.station);
    f.started = now();
    return;
  }
  const partyUp = f.force.some(u => isAlive(u.handle));
  const campUp = campStanding(f).length > 0;
  const t = now() - f.started;
  const ahead = partyUp && campUp ? lead(f) : 0;
  const decided = t >= CALL_SECONDS && Math.abs(ahead - targetMargin()) >= CALL_MARGIN;
  if (partyUp && campUp && t < FIGHT_CAP && !decided) return;
  if (!campUp) record(f.scale, hpShare(f.force, f.forceMax), 1);
  else if (!partyUp) record(f.scale, -hpShare(campStanding(f), f.campMax), 1);
  // Called early: counted as finished, a little lighter -- its lead is a
  // smaller number than the margin it was heading for, though on the right
  // side of the target.
  else if (decided) record(f.scale, ahead, 0.8);
  else record(f.scale, ahead, 0.5);
  clearStation(f.station);
  fights[f.station] = null;
  refit(f.generation);
}

// --- The estimate --------------------------------------------------------------

interface Observation { x: number; margin: number; weight: number }

/** Every fight's result: x is the log of the damage scale it was fought at. */
let observations: Observation[] = [];
/** The current best guess, as the log of the damage scale, and how far either
 *  side of it the next fights are spread. */
let center = 0;
let spread = 0;
/** How wide the next fights are spread, in log scale: a step's width, the
 *  first guess's with nothing learned (about x0.5 to x2) and with something
 *  learned (about x0.8 to x1.3), and the narrowest once the answer is firm. */
const START_SPREAD = 0.35;
const COLD_SPREAD = 0.7;
const WARM_SPREAD = 0.25;
const MIN_SPREAD = 0.06;
/** Whether the first guess has been made; see firstGuess. */
let guessed = false;
/** The party's and the camp's own attack damage, as the first fight found
 *  them: what an answer is carried to the next round in (learn). */
let partyStatDPS = 0;
let campStatDPS = 0;
/**
 * What the last check learned: its answer as a multiple of the units'-own-
 * damage estimate -- the scale the camp needed, over the scale that would
 * have matched the party's attack damage. Spells, summons, auras and armour
 * are what make it differ from 1, and they change little from one round to
 * the next, so it is a far better first guess than the advantage. Null until
 * a check has found something.
 */
let learnedRatio: number | null = null;
/** The first guess this check made, and whether it came from learning. */
let firstScale = 0;
let firstWasWarm = false;
/** Diagnostics: how many units the first guess was made from. */
let firstForce = 0;
let firstCamp = 0;
/** The guess after each finished fight, for telling when it has settled. */
let history: number[] = [];
/** Counts the guess's unbracketed steps: a step waits for a fight launched
 *  since the last one, so steps cannot pile up on results from before it. */
let generation = 0;
/** Standard error of the guess, from the fit; Infinity before there is one. */
let centerError = Infinity;
let bracketed = false;
/** Offsets, in spreads, for the next fights: a shuffled full set at a time, so
 *  every batch tries the whole bracket. */
let offsets: number[] = [];

function resetEstimate(): void {
  observations = [];
  history = [];
  offsets = [];
  center = 0;
  spread = START_SPREAD;
  centerError = Infinity;
  bracketed = false;
  generation = 0;
  guessed = false;
  partyStatDPS = 0;
  campStatDPS = 0;
  firstScale = 0;
  firstWasWarm = false;
}

/** The first guess, from the first fight's units: the scale at which the
 *  camp's attack damage matches the party's, times the learned ratio or, with
 *  nothing learned, the advantage. */
function firstGuess(force: Unit[], creeps: Unit[]): void {
  guessed = true;
  partyStatDPS = getStatDPS(force);
  campStatDPS = getStatDPS(creeps);
  firstForce = force.length;
  firstCamp = creeps.length;
  const estimate = campStatDPS > 0 ? partyStatDPS / campStatDPS : 1;
  const ratio = learnedRatio ?? getCampDPSAdvantage();
  center = Math.log(Math.max(0.05, estimate * ratio));
  spread = learnedRatio != null ? WARM_SPREAD : COLD_SPREAD;
  firstScale = Math.exp(center);
  firstWasWarm = learnedRatio != null;
  setCampDamageScale(Math.exp(center));
}

/** Keep this check's answer, as a ratio to the estimate, for the next. Only an
 *  answer with results on both sides of the target -- anything else is a
 *  direction, not an answer. */
function learn(): void {
  if (!bracketed || partyStatDPS <= 0 || campStatDPS <= 0) return;
  learnedRatio = Math.exp(center) * campStatDPS / partyStatDPS;
}

/** For tests: what breaking the cage does -- bank, learn, stop. */
export function finishDPSCheckForTest(): void {
  finish();
}

/** For tests: forget what earlier checks learned. */
export function resetDPSLearningForTest(): void {
  learnedRatio = null;
}

/** For tests: what earlier checks learned (see learnedRatio). */
export function getDPSLearnedRatio(): number | null {
  return learnedRatio;
}

function nextX(): number {
  if (offsets.length === 0) {
    const set = [-1, -0.6, -0.2, 0.2, 0.6, 1];
    for (let i = set.length - 1; i > 0; i--) {
      const j = GetRandomInt(0, i);
      const tmp = set[i]; set[i] = set[j]; set[j] = tmp;
    }
    offsets = set;
  }
  return center + spread * (offsets.pop() ?? 0);
}

function record(scale: number, margin: number, weight: number): void {
  observations.push({ x: Math.log(scale), margin, weight });
}

/**
 * Fit a line through the results near the current guess -- margin against
 * the log of the scale -- and move the guess to where it crosses the target.
 *
 * Near, because far from the crossing margins saturate (a party crushed at
 * twice the right scale is not crushed twice as hard) and would flatten the
 * line. Until the results straddle the target there is no crossing to find,
 * so the guess steps a whole spread the way they point instead.
 */
function refit(fromGeneration: number): void {
  const target = targetMargin();
  const near = observations.filter(o => Math.abs(o.x - center) <= 3 * Math.max(spread, 0.15));
  const above = near.some(o => o.margin > target);
  const below = near.some(o => o.margin < target);
  bracketed = above && below;
  // Too few to go on: the first fights to finish are the quickest, not a
  // fair sample of the bracket. Wait for half a round of stations.
  if (near.length < STATIONS.length / 2) return;
  if (!bracketed) {
    // Party winning everywhere: the camp needs to hit harder, and vice versa.
    // To the furthest scale tried, not a spread past it: the next fights are
    // spread a whole spread either side anyway. Stepping past it on every
    // finished fight compounded while the next batch was still out -- a
    // Blademaster and Lich went x0.75 to x3.1 in a minute, then took two more
    // to come back to x2.
    // And only on a fight launched since the last step: until one finishes
    // there is no news about where the last step went.
    if (fromGeneration < generation) return;
    let edge = near[0].x;
    for (const o of near) edge = above ? Math.max(edge, o.x) : Math.min(edge, o.x);
    center = above ? Math.max(center, edge) : Math.min(center, edge);
    spread = START_SPREAD;
    centerError = Infinity;
    generation += 1;
  } else {
    let sw = 0; let sx = 0; let sy = 0;
    for (const o of near) { sw += o.weight; sx += o.weight * o.x; sy += o.weight * o.margin; }
    const mx = sx / sw;
    const my = sy / sw;
    let sxx = 0; let sxy = 0;
    for (const o of near) {
      sxx += o.weight * (o.x - mx) ** 2;
      sxy += o.weight * (o.x - mx) * (o.margin - my);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const curve = fitCurve(observations, target);
    if (slope >= 0 && curve == null) {
      // Noise swamping the trend: stay put and keep sampling wide.
      centerError = Infinity;
      spread = START_SPREAD;
    } else {
      // The crossing from the S-shaped curve when it fits, the line's when not.
      const crossing = curve ?? mx + (target - my) / slope;
      // Uncertainty from the line near the crossing: how far the results
      // scatter about it, over how steep it is.
      let rss = 0;
      for (const o of near) rss += o.weight * (o.margin - (my + slope * (o.x - mx))) ** 2;
      const dof = Math.max(1, near.length - 2);
      const sigma = Math.sqrt(rss / sw * near.length / dof);
      centerError = slope < 0
        ? sigma / -slope * Math.sqrt(1 / near.length + (crossing - mx) ** 2 / (sxx / sw * near.length))
        : Infinity;
      // Never further than a spread past the results in hand.
      let lo = near[0].x; let hi = near[0].x;
      for (const o of near) { lo = Math.min(lo, o.x); hi = Math.max(hi, o.x); }
      // And no more than half a spread per result: the first fits, on a
      // handful of points either side, swung the guess 60% too far.
      const reach = Math.max(lo - spread, Math.min(hi + spread, crossing));
      center = Math.max(center - spread / 2, Math.min(center + spread / 2, reach));
      spread = Math.max(MIN_SPREAD, Math.min(START_SPREAD, 2 * centerError));
    }
  }
  history.push(center);
  setCampDamageScale(Math.exp(center));
  if (isConverged()) {
    phase = 'done';
    learn();
  }
}

/** How many of the latest results the curve is fitted to. */
const CURVE_RESULTS = 150;

/** Lua 5.3 has no math.tanh. */
function tanh(v: number): number {
  if (v > 20) return 1;
  if (v < -20) return -1;
  const e = Math.exp(2 * v);
  return (e - 1) / (e + 1);
}

/**
 * Fit margin = a + c * tanh(s * (x - x0)) to every result and return where it
 * crosses the target, or null when it does not fit or does not cross.
 *
 * S-shaped because margins are: they flatten out far from the crossing -- a
 * party crushed at twice the right scale cannot lose by more than everything
 * -- and some parties win or lose big with little in between (a Mountain King
 * and Paladin swung +-60 at the same scale). A line only fits near the
 * crossing; this uses every result. Found by trying steepnesses and centres on
 * a grid, each with its height and level by least squares.
 */
function fitCurve(all: ReadonlyArray<Observation>, target: number): number | null {
  // The latest results: they are the ones near where the guess now stands,
  // and the fit's cost grows with how many it reads.
  const obs = all.length > CURVE_RESULTS ? all.slice(all.length - CURVE_RESULTS) : all;
  if (obs.length < 8) return null;
  let lo = obs[0].x; let hi = obs[0].x;
  for (const o of obs) { lo = Math.min(lo, o.x); hi = Math.max(hi, o.x); }
  if (hi - lo < 0.05) return null;
  let best: { a: number; c: number; s: number; x0: number; rss: number } | null = null;
  for (const steep of [1.5, 3, 6, 12]) {
    for (let x0 = lo; x0 <= hi; x0 += 0.025) {
      let sw = 0; let sf = 0; let sy = 0; let sff = 0; let sfy = 0;
      for (const o of obs) {
        const f = tanh(steep * (o.x - x0));
        sw += o.weight; sf += o.weight * f; sy += o.weight * o.margin;
        sff += o.weight * f * f; sfy += o.weight * f * o.margin;
      }
      const det = sw * sff - sf * sf;
      if (det <= 1e-9) continue;
      const c = (sw * sfy - sf * sy) / det;
      const a = (sy - c * sf) / sw;
      if (c >= 0) continue;   // a harder camp must not help the party
      let rss = 0;
      for (const o of obs) rss += o.weight * (o.margin - (a + c * tanh(steep * (o.x - x0)))) ** 2;
      if (best == null || rss < best.rss) best = { a, c, s: steep, x0, rss };
    }
  }
  if (best == null) return null;
  const r = (target - best.a) / best.c;
  if (r <= -0.999 || r >= 0.999) return null;
  return best.x0 + 0.5 * Math.log((1 + r) / (1 - r)) / best.s;
}

/** Fights a station must have finished before the answer may be called. */
function minFights(): number {
  return 3 * STATIONS.length;
}
/** How many guesses in a row must agree. */
const SETTLED_GUESSES = 12;
/** How closely, in log scale (0.03 is about 3%). */
const SETTLED_WITHIN = 0.03;

/**
 * Whether the answer has stopped moving.
 *
 * Careful not to call it early: every one of these must hold. Enough finished
 * fights that each station has fought three times; results on both sides of
 * the target, with the trend the right way round; a fitted uncertainty under
 * 3%; and the last twelve guesses all within 3% of where it now stands --
 * a whole round of stations' worth of results that did not move it.
 */
function isConverged(): boolean {
  const finished = observations.filter(o => o.weight >= 1).length;
  if (finished < minFights() || !bracketed) return false;
  if (!(centerError < SETTLED_WITHIN)) return false;
  if (history.length < SETTLED_GUESSES) return false;
  for (let i = history.length - SETTLED_GUESSES; i < history.length; i++) {
    if (Math.abs(history[i] - center) > SETTLED_WITHIN) return false;
  }
  return true;
}

// --- The tick ------------------------------------------------------------------

function tick(): void {
  leash();
  for (let i = 0; i < STATIONS.length; i++) {
    const f = fights[i];
    if (f != null) watchFight(f);
    else if (phase === 'fights') startFight(i);
  }
}

// --- Reporting -------------------------------------------------------------------

/** Where the check stands, for -dpsnumbers. */
export function getDPSCheckReport(): string[] {
  const lines: string[] = [];
  const finished = observations.filter(o => o.weight >= 1);
  lines.push('DPS check: ' + phase + ', ' + I2S(R2I(now())) + 's');
  if (learnedRatio != null) lines.push('Started from last round: x' + string.format('%.2f', learnedRatio) + ' of the estimate');
  lines.push('Fights finished: ' + I2S(finished.length) + (bracketed ? ', target bracketed' : ''));
  const scale = getCampDamageScale();
  lines.push(scale > 0
    ? '=> camp damage x' + string.format('%.2f', scale)
      + (centerError < Infinity ? ' (+-' + I2S(R2I(centerError * 100)) + '%)' : '')
    : '=> no measurement; the estimate stands in');
  const recent = finished.slice(-6).map(o => string.format('x%.2f:%+d', Math.exp(o.x), R2I(o.margin * 100)));
  if (recent.length > 0) lines.push('Last: ' + recent.join(' '));
  return lines;
}

/** For tests: the check's state, read from outside. */
export function getDPSCheckStatus(): {
  phase: Phase; elapsed: number; stations: number; fightsFinished: number; strayTicks: number;
  firstScale: number; warm: boolean; scale: number; bracketed: boolean; centerError: number;
  partyStatDPS: number; campStatDPS: number; firstForce: number; firstCamp: number;
  observations: ReadonlyArray<Observation>;
} {
  return {
    phase, elapsed: now(), stations: STATIONS.length, strayTicks,
    fightsFinished: observations.filter(o => o.weight >= 1).length,
    firstScale, warm: firstWasWarm, scale: getCampDamageScale(), bracketed, centerError, observations,
    partyStatDPS, campStatDPS, firstForce, firstCamp,
  };
}

/** For tests: replace the layout -- where the stations stand, how far out a
 *  party starts, how far a unit may stray. Only between checks. */
export function setDPSLayoutForTest(
  stations: ReadonlyArray<{ x: number; y: number }>, approach: number, leash: number,
  angles: ReadonlyArray<number>,
): void {
  stopDPSCheck();
  STATIONS = stations;
  APPROACH_ANGLES = angles;
  APPROACH = approach;
  LEASH = leash;
  for (let i = 0; i < Math.max(STATIONS.length, 64); i++) fights[i] = null;
}

const DEFAULT_LAYOUT = { stations: STATIONS, approach: APPROACH, leash: LEASH, angles: APPROACH_ANGLES };

/** For tests: back to the game's own layout, on every check player. */
export function resetDPSLayoutForTest(): void {
  setDPSLayoutForTest(DEFAULT_LAYOUT.stations, DEFAULT_LAYOUT.approach, DEFAULT_LAYOUT.leash, DEFAULT_LAYOUT.angles);
  ownerLimit = 0;
}

/** For tests: where station i stands. */
export function getDPSStation(i: number): { x: number; y: number } {
  return STATIONS[i];
}
