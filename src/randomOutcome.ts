import { removeReadyZone } from './ready';

/**
 * Randomness, once taken, is kept.
 *
 * The lobby's Reset Purchases circle rewinds to the snapshot taken on entry.
 * That is fine for spending gold -- you get the gold back -- but it also
 * rewinds a random roll, so a player could reroll a hero, dislike the result,
 * reset, and roll again until it suited them. The gamble has to cost
 * something, so the first time a random outcome is TAKEN the circle is retired
 * for this lobby visit.
 *
 * Taken, not bought: buying a reroll item leaves it in the inventory and
 * decides nothing, so the circle survives that. Casting it does decide
 * something. The Mercenary Contract is the other way round -- the roll happens
 * at purchase -- which is exactly why callers say when the OUTCOME landed
 * rather than this module guessing from a purchase.
 */
let spent = false;

/** Call when a random result has been produced and the player has seen it. */
export function markRandomOutcomeTaken(): void {
  if (spent) return;
  spent = true;
  removeReadyZone('revert');
  print('The dice are cast — purchases can no longer be reset this round.');
}

/** Whether a random outcome has already been taken this lobby visit. */
export function isRandomOutcomeTaken(): boolean {
  return spent;
}

/** Clear on entering a fresh lobby, so the circle is available again. */
export function resetRandomOutcome(): void {
  spent = false;
}
