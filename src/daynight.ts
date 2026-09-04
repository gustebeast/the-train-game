import { Timer } from 'w3ts';
import { createTimer } from './timers';
import { getHumanPlayers, getWorldBounds } from './util';
import { isChallengeArmed } from './challenges';
import { CH_NIGHT_BLACKOUT } from './challengeList';

/**
 * The day/night cycle, driven by us rather than by the game clock.
 *
 * The clock is frozen (SetTimeOfDayScale 0) and the map sits in permanent day.
 * Once per round a single night event fires at a random point between
 * NIGHT_EARLIEST and NIGHT_LATEST, lasts NIGHT_DURATION, and then returns to
 * day. Nothing else moves the clock, so "is it night" is always something this
 * module decided.
 *
 * Night always drops allied vision: you see what your own units see, not what
 * your team sees. The Blackout challenge goes further and masks the whole map,
 * leaving only what your units are looking at right now.
 */

/** Noon. Every board that is not running a night sits here, so the lobbies
 *  and the boss arena use this rather than repeating the number. */
export const DAY_TIME = 12;
const NIGHT_TIME = 0;
/** Night lasts five minutes. */
const NIGHT_DURATION = 300;
/** Night starts somewhere in this window, measured from the round's start. */
const NIGHT_EARLIEST = 60;
const NIGHT_LATEST = 600;

let night = false;
/** The pending "start night" timer, so victory can cancel it. */
let nightStart: Timer | null = null;
/** The pending "end night" timer. */
let nightEnd: Timer | null = null;
/** One blackout modifier per player, alive only while the challenge is running. */
let blackout: fogmodifier[] = [];

export function isNight(): boolean {
  return night;
}

function cancelTimer(t: Timer | null): null {
  if (t != null) {
    t.pause();
    t.destroy();
  }
  return null;
}

/** Share or unshare vision between every pair of human players. */
function setAlliedVision(shared: boolean): void {
  const players = getHumanPlayers();
  for (const a of players) {
    for (const b of players) {
      if (a.handle === b.handle) continue;
      SetPlayerAlliance(a.handle, b.handle, ALLIANCE_SHARED_VISION, shared);
    }
  }
}

/** How far apart the explored-state samples are taken, in world units. Fine
 *  enough to preserve the shape of what was explored, coarse enough that a
 *  whole map is a few hundred probes. */
const SAMPLE_STEP = 192;

/** Everything each player had explored when the blackout began. */
interface ExploredRow { y: number; x1: number; x2: number; }
let exploredByPlayer: Array<{ p: player; rows: ExploredRow[] }> = [];

/** Record what a player has explored, as merged horizontal runs.
 *
 *  Runs rather than points because restoring means creating a fog modifier per
 *  region, and one per sample point would be hundreds of handles; merging each
 *  row into spans usually collapses that to a handful. */
function captureExplored(p: player): ExploredRow[] {
  const world = getWorldBounds();
  const minX = GetRectMinX(world);
  const maxX = GetRectMaxX(world);
  const minY = GetRectMinY(world);
  const maxY = GetRectMaxY(world);
  const rows: ExploredRow[] = [];
  for (let y = minY; y <= maxY; y += SAMPLE_STEP) {
    let runStart: number | null = null;
    for (let x = minX; x <= maxX + SAMPLE_STEP; x += SAMPLE_STEP) {
      // "Explored" is anything not still black: currently visible counts too.
      const explored = x <= maxX && !IsMaskedToPlayer(x, y, p);
      if (explored && runStart == null) {
        runStart = x;
      } else if (!explored && runStart != null) {
        rows.push({ y, x1: runStart, x2: x - SAMPLE_STEP });
        runStart = null;
      }
    }
  }
  return rows;
}

/** Re-mark those runs as explored, by flashing visibility over them.
 *
 *  A VISIBLE modifier that is started and then stopped leaves the area in the
 *  explored-but-not-visible state, which is exactly what it looked like before
 *  the blackout. The stop has to happen on a later frame -- start and stop in
 *  the same frame and the engine never registers the reveal. */
function restoreExplored(): void {
  const flashes: fogmodifier[] = [];
  for (const entry of exploredByPlayer) {
    for (const row of entry.rows) {
      const r = Rect(row.x1 - SAMPLE_STEP, row.y - SAMPLE_STEP,
                     row.x2 + SAMPLE_STEP, row.y + SAMPLE_STEP);
      const mod = CreateFogModifierRect(entry.p, FOG_OF_WAR_VISIBLE, r, false, false);
      if (mod != null) {
        FogModifierStart(mod);
        flashes.push(mod);
      }
      RemoveRect(r);
    }
  }
  exploredByPlayer = [];
  if (flashes.length === 0) return;
  const t = createTimer();
  t.start(0.1, false, () => {
    for (const mod of flashes) {
      FogModifierStop(mod);
      DestroyFogModifier(mod);
    }
  });
}

/** Mask the entire map for every player.
 *
 *  `afterUnits = false` is load-bearing: it puts the modifier UNDER unit vision,
 *  so a unit still lights its own surroundings and the blackout covers only
 *  everything else. With true the screen goes black even under your own
 *  peasants, which is not the challenge.
 *
 *  Masking is NOT a harmless overlay -- it wipes what the player had explored,
 *  so lifting it at dawn leaves the map black rather than grey. (Measured: a
 *  point explored before the blackout came back masked afterwards.) Hence the
 *  capture here and the restore at dawn. */
function startBlackout(): void {
  if (blackout.length > 0) return;
  const world = getWorldBounds();
  exploredByPlayer = [];
  for (const p of getHumanPlayers()) {
    exploredByPlayer.push({ p: p.handle, rows: captureExplored(p.handle) });
    const mod = CreateFogModifierRect(p.handle, FOG_OF_WAR_MASKED, world, false, false);
    if (mod != null) {
      FogModifierStart(mod);
      blackout.push(mod);
    }
  }
}

function stopBlackout(): void {
  if (blackout.length === 0) return;
  for (const mod of blackout) {
    FogModifierStop(mod);
    DestroyFogModifier(mod);
  }
  blackout = [];
  restoreExplored();
}

/** Exported for the automated fog test, which needs night on demand rather
 *  than waiting out a random 1-10 minute timer. */
export function beginNight(): void {
  if (night) return;
  night = true;
  SetTimeOfDay(NIGHT_TIME);
  setAlliedVision(false);
  if (isChallengeArmed(CH_NIGHT_BLACKOUT)) startBlackout();
  print('|cff8080ffNight falls.|r You can no longer see through your allies.');
  nightEnd = cancelTimer(nightEnd);
  const t = createTimer();
  t.start(NIGHT_DURATION, false, () => endNight());
  nightEnd = t;
}

/** Return to day. Safe to call when it is already day, which is what lets
 *  victory call it without checking. */
export function endNight(): void {
  nightEnd = cancelTimer(nightEnd);
  if (!night) return;
  night = false;
  stopBlackout();
  setAlliedVision(true);
  SetTimeOfDay(DAY_TIME);
  print('|cffffff80Dawn breaks.|r Allied vision is restored.');
}

/** Freeze the clock, once, at map init.
 *
 *  The freeze used to live only in startDayNightForRound, which was fine while
 *  the map booted straight into a round -- that call happened at init and the
 *  clock never moved again. The map now boots into the start lobby, so nothing
 *  froze the clock until the player started playing, and every lobby before
 *  that ran a normal day/night cycle: stopDayNight set the time to noon and the
 *  engine promptly carried on from there.
 *
 *  Called from main, so the clock is stopped before anything else can show a
 *  sky. Everything after this only moves time deliberately. */
export function initDayNight(): void {
  SetTimeOfDayScale(0);
  SetTimeOfDay(DAY_TIME);
}

/** Start a round: freeze the clock at day and schedule this round's night. */
export function startDayNightForRound(): void {
  nightStart = cancelTimer(nightStart);
  nightEnd = cancelTimer(nightEnd);
  stopBlackout();
  night = false;
  SetTimeOfDayScale(0); // the clock only moves when we move it
  SetTimeOfDay(DAY_TIME);
  setAlliedVision(true);

  const delay = GetRandomInt(NIGHT_EARLIEST, NIGHT_LATEST);
  const t = createTimer();
  t.start(delay, false, () => beginNight());
  nightStart = t;
}

/** The round has been won (the last track is down).
 *
 *  Cancels a night that has not happened yet -- a round that is already over
 *  should not suddenly go dark -- and ends one already running, so the victory
 *  lap is not run in the dark. */
export function cancelNightForVictory(): void {
  nightStart = cancelTimer(nightStart);
  endNight();
}

/** Full stop, for leaving gameplay by any route (victory, defeat, inter-round lobby). */
export function stopDayNight(): void {
  nightStart = cancelTimer(nightStart);
  cancelNightForVictory();
  // Re-assert the freeze rather than only setting the hour: this is the call
  // every lobby makes on the way in, and a lobby is precisely where the clock
  // was found running.
  SetTimeOfDayScale(0);
  SetTimeOfDay(DAY_TIME);
}
