import { defineChallenge, completeChallenge, isChallengeArmed } from './challenges';
import { getHumanPlayers } from './util';

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
let straightRun = 0;      // current unbroken run, not a total
let curvedCount = 0;
let dashCount = 0;
let brinkSeconds = 0;
let soloToolsBroken = false;

/** Clear every counter. Called when a round starts, so progress never leaks
 *  from one round into the next. */
export function resetChallengeProgress(): void {
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

defineChallenge({
  id: CH_CRITTERPOCALYPSE,
  name: 'Critterpocalypse',
  description: 'The next round swarms with critters. Finish the round to win the wager.',
});

defineChallenge({
  id: CH_TOUGH_CAMP,
  name: 'Tough Creep Camp',
  description: "Next round's creep camp hits far harder. Defeat every creep in it.",
});

defineChallenge({
  id: CH_STRAIGHT_15,
  name: 'Straight and Narrow',
  description: 'Lay ' + I2S(STRAIGHT_TARGET) + ' straight track pieces in an unbroken run.',
  progress: () => I2S(straightRun) + ' / ' + I2S(STRAIGHT_TARGET),
});

defineChallenge({
  id: CH_CURVED_15,
  name: 'The Scenic Route',
  description: 'Lay ' + I2S(CURVED_TARGET) + ' curved track pieces this round.',
  progress: () => I2S(curvedCount) + ' / ' + I2S(CURVED_TARGET),
});

defineChallenge({
  id: CH_DASH,
  name: 'Marathon',
  description: 'Dash ' + I2S(DASHES_PER_PLAYER) + ' times per player this round.',
  progress: () => I2S(dashCount) + ' / ' + I2S(dashTarget()),
});

defineChallenge({
  id: CH_SOLO_TOOLS,
  name: 'Union Rules',
  description: 'Only one peasant may carry each tool: no two may hold the same '
    + 'tool type at once. Paid out when the last track is laid.',
  progress: () => (soloToolsBroken ? 'broken' : 'holding'),
});

defineChallenge({
  id: CH_BRINK,
  name: 'Living Dangerously',
  description: 'Keep the train within ' + I2S(BRINK_TRACKS) + ' tracks of the end '
    + 'of the line for ' + I2S(BRINK_SECONDS) + ' seconds.',
  progress: () => I2S(brinkSeconds) + ' / ' + I2S(BRINK_SECONDS) + 's',
});

defineChallenge({
  id: CH_NIGHT_BLACKOUT,
  name: 'Blackout',
  description: 'At night the whole map goes dark -- you see only what your own '
    + 'units can see. Finish the round to win the wager.',
});

defineChallenge({
  id: CH_NO_UI,
  name: 'From Memory',
  description: 'The interface is hidden for the round: no minimap, no command '
    + 'card, no inventory. Hotkeys still work. Finish the round to win.',
});

defineChallenge({
  id: CH_SHOULDER_CAM,
  name: 'Over the Shoulder',
  description: 'The camera drops in behind your peasant for the round. Finish '
    + 'the round to win.',
});

// --- event hooks, called by the systems that see the events ---------------

/** A track was laid, and its shape is now known. `curved` is a 90-degree turn.
 *
 *  The straight challenge wants an UNBROKEN run, so a curve resets it to zero
 *  rather than merely not counting. */
export function noteTrackShape(curved: boolean): void {
  if (curved) {
    straightRun = 0;
    if (isChallengeArmed(CH_CURVED_15)) {
      curvedCount += 1;
      if (curvedCount >= CURVED_TARGET) completeChallenge(CH_CURVED_15);
    }
    return;
  }
  straightRun += 1;
  if (isChallengeArmed(CH_STRAIGHT_15) && straightRun >= STRAIGHT_TARGET) {
    completeChallenge(CH_STRAIGHT_15);
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
