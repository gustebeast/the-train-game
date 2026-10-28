import { Timer, Trigger, Unit } from 'w3ts';
import {
  getCampData, getCampDPSAdvantage, setCampDamageScale, getCampDamageScale,
  spawnCampCopy, spawnUnscaledCampCopy, onCageBroken,
} from './creeps';
import { HeroData, getChosenHeroData, spawnHeroFromData } from './heroes';
import { MercData, getLivingMercData, spawnMercFromData } from './mercenary';
import { isChallengeArmed } from './challenges';
import { CH_TOUGH_CAMP } from './challengeList';
import { getDPSCheckPlayer, getNeutralAggressive } from './teams';
import { forEachUnitOfPlayer, forEachInventoryItem, isAlive, unitExists, removeUnitsSummonsFirst } from './util';

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
 * loads. Twelve copies of the party fight at once, each against its own copy
 * of the camp:
 *
 *   1. RIGGED OPENING (RIGGED_SECONDS). Every unit is rigged so nothing dies,
 *      and HP lost is counted both ways. The ratio is the party's damage
 *      against the camp's, everything alive and every spell cast -- an upper
 *      bound on the party, and a first guess at the scale, ready seconds into
 *      the round.
 *
 *   2. REAL FIGHTS, for as long as there is time. Real HP, the camp scaled as a
 *      round scales it, each station at its own damage scale spread around the
 *      current best guess, and each approaching from its own side. A finished
 *      fight is a point -- scale tried, margin won or lost by -- and a line
 *      through the points says where the margin crosses the target. The next
 *      fights are spread round that, narrower as the answer firms up, so twelve
 *      fights at a time test twelve scales at a time.
 *
 * It stops when the cage is broken -- banking how the long-running unfinished
 * fights stand -- or once the answer has stopped moving (isConverged). Any
 * board load ends it (spawn.ts clearBoard).
 *
 * Every unit of ours belongs to the one check player: it is the only slot the
 * map makes a computer, and an AI in any other slot never casts.
 */

// --- Where the fights happen -------------------------------------------------

/**
 * Twelve stations: six in a row below the board and six above, 1000 apart.
 *
 * The board's edge is y +-1344 and its wall a cell beyond; a second, full-width
 * wall at y +-1664 (spawn.ts) keeps every fight further out than a test fight
 * the user could not hear from the board (about 500 out). The rows' ground
 * runs from there to the map edge: y -1728..-3072 below, 1728..3584 above.
 */
const ROW_YS: ReadonlyArray<number> = [-2400, 2650];
const STATION_XS: ReadonlyArray<number> = [-2500, -1500, -500, 500, 1500, 2500];
let STATIONS: ReadonlyArray<{ x: number; y: number }> = (() => {
  const out: Array<{ x: number; y: number }> = [];
  for (const y of ROW_YS) for (const x of STATION_XS) out.push({ x, y });
  return out;
})();
/** How far from its camp a party starts. */
let APPROACH = 450;
/** Sides a party may come in from, in degrees: from above or below, across the
 *  row, drawn afresh every fight so which unit gets hit first varies
 *  independently of the scale being tried. Across rather than along it:
 *  measured, coming in along the row put parties beside the next station and
 *  units strayed there three to six times as often, for the same answer. */
let APPROACH_ANGLES: ReadonlyArray<number> = [90, 270, 65, 115, 245, 295];
/** How far a unit may wander from its station before it is sent back: half
 *  the spacing, so no fight drifts into its neighbour's, and beyond APPROACH,
 *  so a party is not walked onto its camp before the camp is down. */
let LEASH = 500;

// --- Timing ------------------------------------------------------------------

/** How long the rigged opening runs. */
export const RIGGED_SECONDS = 10;
/** How long an unfinished fight must have run for its lead to count when
 *  the cage breaks. Measured: the side ahead at 10 s won 81% of fights, at
 *  20 s 95%. */
const MIN_BANKED_SECONDS = 10;
/** A safety net: a fight still going after this long is called on its lead. */
const FIGHT_CAP = 120;
const TICK = 0.5;
/** The HP every unit is rigged to in the opening (the camp shares it). */
const RIG_HP = 99999;

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

type Phase = 'idle' | 'rigged' | 'fights' | 'done';
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
  beginRigged();
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
  if (phase === 'rigged' && riggedWatching && now() - riggedStart >= MIN_BANKED_SECONDS) {
    // Found before the opening was over: what it has seen is still a better
    // guess than the units' own stats.
    endRigged();
  } else if (phase === 'fights') {
    for (const f of fights) {
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
  stopDPSCheck();
}

export function initDPSCheck(): void {
  // Creeps dying in the check would level its heroes mid-fight.
  SetPlayerHandicapXP(getDPSCheckPlayer().handle, 0);
  // A hero or mercenary dying drops what it carries: take it first. Items are
  // the check's own copies, but on the ground they would be anybody's.
  deathTrig = Trigger.create();
  TriggerRegisterPlayerUnitEvent(deathTrig.handle, getDPSCheckPlayer().handle, EVENT_PLAYER_UNIT_DEATH, undefined);
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
 *  check player, and return it. */
function fieldParty(i: number, angle: number): Unit[] {
  const st = STATIONS[i];
  const x = st.x + APPROACH * Cos(angle * bj_DEGTORAD);
  const y = st.y + APPROACH * Sin(angle * bj_DEGTORAD);
  const check = getDPSCheckPlayer();
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
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => {
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
  rigged = [];
  for (let i = 0; i < fights.length; i++) fights[i] = null;
}

/** Keep every unit of the check's at its own station; anything new is a
 *  summon, a charmed creep or an illusion, and belongs where it appeared. */
function leash(): void {
  forEachUnitOfPlayer(getDPSCheckPlayer().handle, u => {
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

// --- 1. The rigged opening -----------------------------------------------------

interface Watched {
  unit: unit; lastHP: number;
  /** One of our summons, keeping its own HP; see sampleRigged. */
  summon: boolean;
  /** A creep already taken out of the fight and credited. */
  out: boolean;
}

let rigged: Watched[] = [];
let riggedCreepHPLost = 0;
let riggedOurHPLost = 0;
let riggedStart = 0;
/** One party's natural HP and one camp's, for crediting a creep taken out
 *  outright (Charm, Transmute) with what it would have had in a round. */
let partyHP = 0;
let campHP = 0;
const naturalHP = new Map<number, number>();
/** False until the opening's units are rigged and being watched. */
let riggedWatching = false;

function beginRigged(): void {
  phase = 'rigged';
  rigged = [];
  riggedWatching = false;
  riggedCreepHPLost = 0;
  riggedOurHPLost = 0;
  naturalHP.clear();
  for (let i = 0; i < STATIONS.length; i++) {
    fieldParty(i, randomAngle());
    noteCreeps(i, spawnUnscaledCampCopy(STATIONS[i].x, STATIONS[i].y));
  }
  // Rigged on the next tick, once tome bonuses (a frame after a hero spawns)
  // have landed: rigging first would read them as damage.
}

function rigAndWatch(): void {
  const check = getDPSCheckPlayer().handle;
  const creeps: unit[] = [];
  forEachUnitOfPlayer(getNeutralAggressive().handle, u => {
    if (ourCreeps.has(GetHandleId(u))) creeps.push(u);
  });
  partyHP = 0;
  let n = 0;
  forEachUnitOfPlayer(check, u => {
    if (home.get(GetHandleId(u)) === 0) partyHP += BlzGetUnitMaxHP(u);
  });
  campHP = 0;
  for (const c of creeps) {
    naturalHP.set(GetHandleId(c), BlzGetUnitMaxHP(c));
    if (home.get(GetHandleId(c)) === 0) { campHP += BlzGetUnitMaxHP(c); n += 1; }
  }
  const share = Math.max(1, Math.floor(RIG_HP / Math.max(1, n)));
  for (const c of creeps) {
    BlzSetUnitMaxHP(c, share);
    SetUnitState(c, UNIT_STATE_LIFE, share);
    BlzSetUnitWeaponIntegerField(c, UNIT_WEAPON_IF_ATTACK_ATTACK_TYPE, 0, 5);
    SetUnitInvulnerable(c, false);
    rigged.push({ unit: c, lastHP: share, summon: false, out: false });
  }
  forEachUnitOfPlayer(check, u => {
    BlzSetUnitMaxHP(u, RIG_HP);
    SetUnitState(u, UNIT_STATE_LIFE, RIG_HP);
    rigged.push({ unit: u, lastHP: RIG_HP, summon: false, out: false });
    const i = home.get(GetHandleId(u));
    if (i != null) IssuePointOrder(u, 'attack', STATIONS[i].x, STATIONS[i].y);
  });
  riggedStart = now();
  riggedWatching = true;
}

/** Bank the HP each side has lost since the last look.
 *
 *  HP lost rather than damage events, because HP is what has already had
 *  armour taken out and healing put back -- what the fight actually cost.
 *  Our summons and illusions keep their own HP and may die, as in a round:
 *  rigged, a Blademaster's Mirror Images soaked 70% of the camp's damage for
 *  the whole match and read the camp as twice as strong as it was. A creep
 *  that leaves the fight outright (killed through its pool, so transmuted, or
 *  charmed) is credited once with the HP it would have had in a round. */
function sampleRigged(): void {
  const creepOwner = getNeutralAggressive().handle;
  const check = getDPSCheckPlayer().handle;
  for (const w of rigged) {
    if (w.out || !unitExists(w.unit)) continue;
    const hp = GetUnitState(w.unit, UNIT_STATE_LIFE);
    if (ourCreeps.has(GetHandleId(w.unit))) {
      if (hp <= 0.405 || GetOwningPlayer(w.unit) !== creepOwner) {
        riggedCreepHPLost += campHP > 0
          ? (naturalHP.get(GetHandleId(w.unit)) ?? 0) * partyHP / campHP : 0;
        w.out = true;
        continue;
      }
      riggedCreepHPLost += w.lastHP - hp;
    } else {
      riggedOurHPLost += w.lastHP - hp;
    }
    w.lastHP = hp;
  }
  // New on our side: a summon or illusion (its own HP), or a charmed creep
  // (rigged, as it is now part of the force).
  forEachUnitOfPlayer(check, u => {
    for (const w of rigged) if (w.unit === u) return;
    const summon = IsUnitType(u, UNIT_TYPE_SUMMONED) || IsUnitIllusion(u);
    if (!summon) {
      BlzSetUnitMaxHP(u, RIG_HP);
      SetUnitState(u, UNIT_STATE_LIFE, RIG_HP);
    }
    rigged.push({ unit: u, lastHP: GetUnitState(u, UNIT_STATE_LIFE), summon, out: false });
  });
}

/** The rigged opening's answer: the scale at which the camp would deal the
 *  party's own damage back, times the advantage. */
let riggedScale = 0;

function endRigged(): void {
  sampleRigged();
  const t = now() - riggedStart;
  riggedScale = riggedOurHPLost > 0 && t > 0
    ? riggedCreepHPLost / riggedOurHPLost * getCampDPSAdvantage()
    : getCampDPSAdvantage();
  if (riggedScale <= 0) riggedScale = getCampDPSAdvantage();
  clearField();
  center = Math.log(riggedScale);
  spread = START_SPREAD;
  setCampDamageScale(riggedScale);
  phase = 'fights';
  for (let i = 0; i < STATIONS.length; i++) fights[i] = null;
}

// --- 2. Real fights ------------------------------------------------------------

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

const fights: Array<Fight | null> = [];
for (let i = 0; i < STATIONS.length; i++) fights.push(null);

function startFight(i: number): void {
  const scale = Math.exp(nextX());
  fights[i] = {
    station: i, scale, force: fieldParty(i, randomAngle()), creeps: [], started: now(),
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
    // The party has had its frame: measure it and put its camp down.
    f.creeps = spawnCampCopy(STATIONS[f.station].x, STATIONS[f.station].y, f.force, f.scale);
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
  if (partyUp && campUp && t < FIGHT_CAP) return;
  if (!campUp) record(f.scale, hpShare(f.force, f.forceMax), 1);
  else if (!partyUp) record(f.scale, -hpShare(campStanding(f), f.campMax), 1);
  else record(f.scale, lead(f), 0.5);
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
const START_SPREAD = 0.35;
const MIN_SPREAD = 0.06;
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
  riggedScale = 0;
  generation = 0;
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
    if (slope >= 0) {
      // Noise swamping the trend: stay put and keep sampling wide.
      centerError = Infinity;
      spread = START_SPREAD;
    } else {
      const crossing = mx + (target - my) / slope;
      let rss = 0;
      for (const o of near) rss += o.weight * (o.margin - (my + slope * (o.x - mx))) ** 2;
      const dof = Math.max(1, near.length - 2);
      const sigma = Math.sqrt(rss / sw * near.length / dof);
      centerError = sigma / -slope * Math.sqrt(1 / near.length + (crossing - mx) ** 2 / (sxx / sw * near.length));
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
  if (isConverged()) phase = 'done';
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
  if (phase === 'rigged') {
    if (!riggedWatching) { rigAndWatch(); return; }
    sampleRigged();
    if (now() - riggedStart >= RIGGED_SECONDS) endRigged();
    return;
  }
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
  if (riggedScale > 0) lines.push('Rigged opening: camp damage x' + string.format('%.2f', riggedScale));
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
  riggedScale: number; scale: number; bracketed: boolean; centerError: number;
  observations: ReadonlyArray<Observation>;
} {
  return {
    phase, elapsed: now(), stations: STATIONS.length, strayTicks,
    fightsFinished: observations.filter(o => o.weight >= 1).length,
    riggedScale, scale: getCampDamageScale(), bracketed, centerError, observations,
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
  fights.length = 0;
  for (let i = 0; i < STATIONS.length; i++) fights.push(null);
}

/** For tests: where station i stands. */
export function getDPSStation(i: number): { x: number; y: number } {
  return STATIONS[i];
}
