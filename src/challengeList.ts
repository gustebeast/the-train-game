import { defineChallenge, completeChallenge, isChallengeArmed } from './challenges';
import { getHumanPlayers } from './util';
import { placedTracks } from './track/state';
import { TRACK_SIZE } from './track/constants';

/**
 * The challenge catalogue: definitions plus the counters they display.
 *
 * Each one is completed by the system that can actually observe its condition
 * (track/build.ts sees a track laid, dash.ts sees a dash cast, and so on) —
 * this file owns the definition, the running count, and the progress text, and
 * exposes a `note...` function for that system to call. Keeping the counting
 * here means a challenge can be read end to end in one place, and the systems
 * only have to say what happened.
 */

/*
 * IMPLEMENTED SINCE, for the record: night blindness, the hidden UI and the
 * over-the-shoulder camera are all in (see daynight.ts and challengeEffects.ts).
 *
 * The one thing that did NOT hold: a fog modifier is not a harmless overlay.
 * Masking the map WIPES what each player has explored, so simply lifting it at
 * dawn left the map black instead of explored-grey. daynight.ts now samples the
 * explored state before the blackout and re-flashes it afterwards.
 */


// --- ids (persisted; never reuse or renumber) ------------------------------
export const CH_CRITTERPOCALYPSE = 'crit';
export const CH_TOUGH_CAMP = 'camp';
export const CH_STRAIGHT_15 = 'str';
export const CH_CURVED_15 = 'cur';
export const CH_DASH = 'dsh';
export const CH_SOLO_TOOLS = 'solo';
export const CH_BRINK = 'brink';
export const CH_NIGHT_BLACKOUT = 'dark';
export const CH_NO_UI = 'noui';
export const CH_SHOULDER_CAM = 'ots';

const STRAIGHT_TARGET = 15;
const CURVED_TARGET = 15;
const DASHES_PER_PLAYER = 50;
/** Seconds the train must sit within BRINK_TRACKS of the end of the line. */
const BRINK_SECONDS = 10;
export const BRINK_TRACKS = 2;

// --- per-round counters ---------------------------------------------------
/** Derived from the line itself by recountTrackShapes -- never incremented.
 *  See computeTrackShapes for why. */
let straightRun = 0;      // longest unbroken run, not a total
let curvedCount = 0;
/** How many pieces the map laid before the players got to build. Anything below
 *  this index is scenery and must not count toward a wager. */
let trackBaseline = 0;

let dashCount = 0;
let brinkSeconds = 0;
let soloToolsBroken = false;

/** Clear every counter. Called when a round starts -- AFTER the terrain has
 *  spawned, because the starting tracks have to exist to be measured. */
export function resetChallengeProgress(): void {
  trackBaseline = placedTracks.length;
  straightRun = 0;
  curvedCount = 0;
  dashCount = 0;
  brinkSeconds = 0;
  soloToolsBroken = false;
}

function dashTarget(): number {
  return getHumanPlayers().length * DASHES_PER_PLAYER;
}

// --- definitions ----------------------------------------------------------
//
// NOTE: the `description` strings are built when this module loads, and I2S is
// NOT usable that early -- it returns an empty string, so "Lay 15 curved track
// pieces" shipped as "Lay  curved track pieces" with the number silently gone.
// Plain concatenation works, because Lua coerces a number in `..`. The
// `progress` lambdas may keep using I2S: they run at draw time, long after the
// natives are up.

defineChallenge({
  id: CH_CRITTERPOCALYPSE,
  name: 'Critterpocalypse',
  description: 'The next round swarms with critters. Finish the round to win the wager.',
  progress: () => 'Finish the round',
});

defineChallenge({
  id: CH_TOUGH_CAMP,
  name: 'Tough Creep Camp',
  description: "Next round's creep camp hits far harder. Defeat every creep in it.",
  progress: () => 'Defeat the creep camp',
});

defineChallenge({
  id: CH_STRAIGHT_15,
  name: 'Straight and Narrow',
  description: 'Lay ' + STRAIGHT_TARGET + ' straight track pieces in an unbroken run.',
  progress: () => 'Straight in a row ' + I2S(straightRun) + ' / ' + I2S(STRAIGHT_TARGET),
});

defineChallenge({
  id: CH_CURVED_15,
  name: 'The Scenic Route',
  description: 'Lay ' + CURVED_TARGET + ' curved track pieces this round.',
  progress: () => 'Curves laid ' + I2S(curvedCount) + ' / ' + I2S(CURVED_TARGET),
});

defineChallenge({
  id: CH_DASH,
  name: 'Marathon',
  description: 'Dash ' + DASHES_PER_PLAYER + ' times per player this round.',
  progress: () => 'Dashes ' + I2S(dashCount) + ' / ' + I2S(dashTarget()),
});

defineChallenge({
  id: CH_SOLO_TOOLS,
  name: 'Union Rules',
  description: 'Only one peasant may carry each tool: no two may hold the same '
    + 'tool type at once. Paid out when the last track is laid.',
  progress: () => (soloToolsBroken ? 'Tool shared - failed' : 'No tool shared yet'),
});

defineChallenge({
  id: CH_BRINK,
  name: 'Living Dangerously',
  description: 'Keep the train within ' + BRINK_TRACKS + ' tracks of the end '
    + 'of the line for ' + BRINK_SECONDS + ' seconds.',
  progress: () => 'Near the end ' + I2S(brinkSeconds) + ' / ' + I2S(BRINK_SECONDS) + 's',
});

defineChallenge({
  id: CH_NIGHT_BLACKOUT,
  name: 'Blackout',
  description: 'At night the whole map goes dark -- you see only what your own '
    + 'units can see. Finish the round to win the wager.',
  progress: () => 'Finish the round',
});

defineChallenge({
  id: CH_NO_UI,
  name: 'From Memory',
  description: 'The interface is hidden for the round: no minimap, no command '
    + 'card, no inventory. Hotkeys still work. Finish the round to win.',
  progress: () => 'Finish the round',
});

defineChallenge({
  id: CH_SHOULDER_CAM,
  name: 'Over the Shoulder',
  description: 'The camera drops in behind your peasant for the round. Finish '
    + 'the round to win.',
  progress: () => 'Finish the round',
});

// --- event hooks, called by the systems that see the events ---------------

/** A point on the line. Exported for the test, which builds lines by hand. */
export interface TrackPoint { x: number; y: number; }

export interface TrackShapes { straightRun: number; curved: number; }

/** Positions are grid-snapped to TRACK_SIZE, so a quarter-tile slack is more
 *  than enough to absorb float error while never spanning two tiles. */
const AXIS_TOLERANCE = TRACK_SIZE * 0.25;

/** Measure the shape of a whole line of track.
 *
 *  Counted by re-reading the line rather than by incrementing as pieces are
 *  laid, because a piece is not permanent: it can be destroyed, dropped back as
 *  an item and rebuilt. An incremental counter credits every one of those
 *  rebuilds, so destroying and re-laying a single straight piece fifteen times
 *  used to win "Straight and Narrow" outright. A measurement of the line as it
 *  actually stands cannot be farmed that way -- and it also cannot drift, which
 *  is the deeper reason to prefer it.
 *
 *  A piece's shape is only defined once it has a neighbour on BOTH sides, so
 *  the two ends of the line are never counted. Everything below `baseline` is
 *  the map's own starting track and is skipped.
 *
 *  Straight means the two neighbours sit on a common axis through the piece --
 *  both due east/west of it, or both due north/south. Anything else is a
 *  90-degree turn. */
export function computeTrackShapes(points: TrackPoint[], baseline: number): TrackShapes {
  let curved = 0;
  let longest = 0;
  let run = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (i < baseline) continue;
    const prev = points[i - 1];
    const next = points[i + 1];
    const straight = Math.abs(prev.x - next.x) < AXIS_TOLERANCE
                  || Math.abs(prev.y - next.y) < AXIS_TOLERANCE;
    if (straight) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      curved += 1;
      run = 0; // the run has to be unbroken
    }
  }
  return { straightRun: longest, curved };
}

/** Re-measure the line and settle any wager that the new measurement wins.
 *
 *  Called whenever the line changes -- a piece laid OR a piece destroyed -- so
 *  the counters always describe the track that exists right now. */
export function recountTrackShapes(): void {
  const points: TrackPoint[] = [];
  for (const t of placedTracks) points.push({ x: t.x, y: t.y });
  applyTrackShapes(computeTrackShapes(points, trackBaseline));
}

/** Adopt a measurement as the current progress and pay out anything it wins.
 *
 *  Split from recountTrackShapes so the test can drive a measured line straight
 *  into the payout rules without needing real track units on the map. */
export function applyTrackShapes(shapes: TrackShapes): void {
  straightRun = shapes.straightRun;
  curvedCount = shapes.curved;

  if (isChallengeArmed(CH_STRAIGHT_15) && straightRun >= STRAIGHT_TARGET) {
    completeChallenge(CH_STRAIGHT_15);
  }
  if (isChallengeArmed(CH_CURVED_15) && curvedCount >= CURVED_TARGET) {
    completeChallenge(CH_CURVED_15);
  }
}

/** A peasant dashed. */
export function noteDash(): void {
  if (!isChallengeArmed(CH_DASH)) return;
  dashCount += 1;
  if (dashCount >= dashTarget()) completeChallenge(CH_DASH);
}

/** Two units were found holding the same tool type — the wager is lost. */
export function noteToolSharingBroken(): void {
  soloToolsBroken = true;
}

/** One second passed with the train inside the danger window. */
export function noteBrinkSecond(): void {
  if (!isChallengeArmed(CH_BRINK)) return;
  brinkSeconds += 1;
  if (brinkSeconds >= BRINK_SECONDS) completeChallenge(CH_BRINK);
}

/** The train left the danger window, so the streak restarts. */
export function resetBrinkSeconds(): void {
  brinkSeconds = 0;
}

/** The last track of the round has been laid. Challenges judged over the whole
 *  round pay out here rather than when the train finally rolls in — the run is
 *  decided at this point, and waiting would only add dead time. */
export function noteFinalTrackPlaced(): void {
  if (isChallengeArmed(CH_SOLO_TOOLS) && !soloToolsBroken) {
    completeChallenge(CH_SOLO_TOOLS);
  }
  // "Survive the round" challenges: nothing to count, the win condition is
  // simply reaching the end of the line with the handicap on.
  for (const id of [CH_CRITTERPOCALYPSE, CH_NIGHT_BLACKOUT, CH_NO_UI, CH_SHOULDER_CAM]) {
    if (isChallengeArmed(id)) completeChallenge(id);
  }
}
