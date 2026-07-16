import { gameState, syncGold } from './state';

/**
 * Shady Dealer challenges — optional wagers bought in the lobby for 1 gold
 * that modify the next round and pay 2 gold if their condition is met.
 * Deliberately NOT part of gameState: they are one-round bets that must not
 * be persisted to the save file. Reset Purchases still refunds them because
 * every lobby entry clears the flags before the gold snapshot is taken.
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

/** Clear all armed challenges. Called on every lobby entry, before the
 *  purchase snapshot is taken. */
export function clearChallenges(): void {
  critterpocalypse = false;
  toughCamp = false;
}

/** Award the Critterpocalypse bonus if armed. Called on round victory,
 *  before the game is saved. */
export function payCritterpocalypseBonus(): void {
  if (!critterpocalypse) return;
  gameState.gold += CHALLENGE_BONUS;
  syncGold();
  print('Critterpocalypse survived! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}

/** Award the Tough Creep Camp bonus if armed. Called when the last creep
 *  of the round's camp dies. */
export function payToughCampBonus(): void {
  if (!toughCamp) return;
  gameState.gold += CHALLENGE_BONUS;
  syncGold();
  print('Tough creep camp defeated! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}
