import { gameState } from './state';

/**
 * Seeded randomness for outcomes the player must not be able to re-roll by
 * reloading.
 *
 * WC3's GetRandomInt is fresh every session, so `-load`, reroll, dislike it,
 * `-load` again gave a different hero each time -- the Reset Purchases circle
 * cannot close that hole, because a load starts from the save on disk, not
 * from the lobby snapshot the circle restores.
 *
 * A draw here is a pure function of (seed, draw index), and BOTH live in the
 * save. Restoring a save therefore restores the exact point in the sequence,
 * so the same action from the same save always produces the same result, while
 * successive draws within a run still differ.
 *
 * Only use this for outcomes worth save-scumming. Cosmetic randomness (critter
 * types, scatter, effects) should stay on GetRandomInt: it does not need to
 * survive a reload, and spending draws on it would make the sequence depend on
 * how much scenery happened to spawn.
 */

/** 2^31 - 1. Park-Miller, chosen for being exactly reproducible in Lua's
 *  doubles -- every intermediate stays well inside 2^53. */
const M = 2147483647;
const A = 16807;

/** The sub-streams subsystems draw from (deriveSeed). Listed in one place so
 *  two systems cannot pick the same id and silently share a sequence. */
export const STREAMS = {
  /** The order the dealer offers challenges in (challenges.ts). */
  challenge: 1,
  /** Map generation, offset by the round (terrain/load.ts). */
  terrain: 2,
  /** The Secret Salesperson's offer order (salesperson.ts). */
  salesperson: 3,
  /** Tie-breaks when choosing the round's heroes, offset by round and slot
   *  (heroes.ts). Far from the others because the offsets climb. */
  heroPick: 1000,
};

/** Hash the draw index into the stream so a draw depends on both, and a seed of
 *  0 (not yet minted) still produces a usable spread. */
function valueAt(seed: number, index: number): number {
  let x = (seed % M + M) % M;
  if (x === 0) x = 1;
  // Advance deterministically. The loop is bounded by the draw count, which
  // only grows by a handful per inter-round lobby visit.
  for (let i = 0; i <= index; i++) {
    x = (A * x) % M;
  }
  return x;
}

/** The stream value at `index`, consuming nothing. Callers that keep their own
 *  cursor (the hero reroll queue) use this so their sequence is independent of
 *  how many other draws happened. */
export function seededValueAt(index: number): number {
  ensureSeed();
  return valueAt(gameState.randomSeed, index);
}

/** Deterministic replacement for GetRandomInt(low, high), inclusive. */
export function seededInt(low: number, high: number): number {
  if (high <= low) return low;
  ensureSeed();
  const idx = gameState.randomDraws;
  gameState.randomDraws = idx + 1;
  const v = valueAt(gameState.randomSeed, idx);
  return low + (v % (high - low + 1));
}

/** A stable sub-seed for one subsystem, derived from the run seed.
 *
 *  Subsystems that keep their own sequence (the challenge order, for instance)
 *  take one of these rather than sharing the global draw counter, so a merc
 *  roll cannot shift which challenge is on the shelf. Same run seed in, same
 *  sub-seed out, every load. */
export function deriveSeed(streamId: number): number {
  ensureSeed();
  return valueAt(gameState.randomSeed + streamId * 7919, streamId + 1);
}

/** Shuffle `items` in place, the same way every time for the same seed: a
 *  Fisher-Yates walk driven by the Park-Miller step above. For orders that
 *  must survive a reload (the dealer's challenge lap). */
export function shuffleSeeded<T>(items: T[], seed: number): void {
  let x = (seed % M + M) % M;
  if (x === 0) x = 1;
  for (let i = items.length - 1; i > 0; i--) {
    x = (A * x) % M;
    const j = x % (i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

/** Shuffle `items` in place on the game's own RNG. For outcomes nobody could
 *  profit from replaying (see the note at the top). */
export function shuffleRandom<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = GetRandomInt(0, i);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

/** Give the run a seed if it has none. Old saves predate the field, and a save
 *  written before this existed decodes it as 0 -- so mint one on the spot and
 *  carry on; the save picks it up the next time it is written. */
function ensureSeed(): void {
  if (gameState.randomSeed !== 0) return;
  gameState.randomSeed = GetRandomInt(1, M - 1);
  gameState.randomDraws = 0;
}
