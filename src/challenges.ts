import { gameState, syncGold } from './state';
import { registerSaveSegment, parseFields } from './save';

/**
 * Shady Dealer challenges — optional wagers bought in the lobby for 1 gold
 * that modify the next round and pay 2 gold if their condition is met.
 *
 * Lifecycle: armed by purchase, consumed either by paying out or by
 * awardVictory spending unpaid (lost) wagers before the game is saved.
 * The save-segment registration gives the system the standard
 * reset-then-apply behavior, so -load and Reset Purchases restore
 * challenge state through the same path as every other feature.
 */

const CHALLENGE_BONUS = 2;

let critterpocalypse = false;
let toughCamp = false;

export function armCritterpocalypse(): void {
  critterpocalypse = true;
}

export function armToughCamp(): void {
  toughCamp = true;
}

export function isCritterpocalypse(): boolean {
  return critterpocalypse;
}

export function isToughCamp(): boolean {
  return toughCamp;
}

/** Disarm all challenges. Segment reset, and called by awardVictory to
 *  spend lost wagers before the game is saved. */
export function clearChallenges(): void {
  critterpocalypse = false;
  toughCamp = false;
}

/** Encode armed challenges as "c=1;t=1" ('' when none are armed). */
function encodeChallenges(): string {
  const parts: string[] = [];
  if (critterpocalypse) parts.push('c=1');
  if (toughCamp) parts.push('t=1');
  return table.concat(parts, ';');
}

/** Decode armed challenges from "c=1;t=1". */
function decodeChallenges(raw: string): void {
  const fields = parseFields(raw);
  if (fields['c'] === '1') critterpocalypse = true;
  if (fields['t'] === '1') toughCamp = true;
}

registerSaveSegment('ch', encodeChallenges, decodeChallenges, clearChallenges);

/** Award the Critterpocalypse bonus if armed, consuming the wager. Called
 *  on round victory, before the game is saved. */
export function payCritterpocalypseBonus(): void {
  if (!critterpocalypse) return;
  critterpocalypse = false;
  gameState.gold += CHALLENGE_BONUS;
  syncGold();
  print('Critterpocalypse survived! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}

/** Award the Tough Creep Camp bonus if armed, consuming the wager. Called
 *  when the last creep of the round's camp dies. */
export function payToughCampBonus(): void {
  if (!toughCamp) return;
  toughCamp = false;
  gameState.gold += CHALLENGE_BONUS;
  syncGold();
  print('Tough creep camp defeated! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}
