import { STRANGE_ROCK_ID } from './constants';
import { getNeutralExtra } from './teams';
import { ROCK_MODEL_SCALES } from './terrain/constants';

/**
 * The Strange Rock: what the Strange Key is for.
 *
 * You USE the key on the rock. It is a copy of the Alchemist's Transmute, so
 * the peasant throws, the missile flies, and the rock is destroyed when it
 * lands -- all done by the engine, nothing here watching or timing it.
 *
 * That replaced a proximity watcher: the rock used to sit at granite's health
 * and drop to 1 HP whenever a key-holder stood near it, checked twice a second
 * for the rest of the game. A cast raises a fresh event every time; the attack
 * order the first version relied on did not.
 *
 * The rock is INVULNERABLE, like the water tiles, and that one setting does
 * two jobs: an invulnerable unit shows no health bar (checked side by side in
 * game: a vulnerable copy showed one, the invulnerable copy and the water did
 * not), and attacking it gets the engine's own refusal -- no message of ours
 * to word. Transmute still kills it: the key's copy is allowed invulnerable
 * targets, and it kills rather than damages.
 *
 * The key targets "ancient structures", and the rock is the only one in the
 * map, so everything else gets the engine's invalid-target refusal too. The
 * Alchemist's real Transmute is untouched: the key casts a copy.
 */

/** Stand the seal up. The one place a rock is made: the board spawner and the
 *  tests both come through here. Neutral extra, so it shares no vision. */
export function spawnStrangeRock(x: number, y: number): unit | null {
  const rock = CreateUnit(getNeutralExtra().handle, STRANGE_ROCK_ID, x, y, 270);
  if (rock == null) return null;
  SetUnitInvulnerable(rock, true);
  // Variation 0 of the rock-chunk model, at the size granite and the resource
  // rocks use for it -- a rock among rocks, singled out by colour, not size.
  SetUnitScale(rock, ROCK_MODEL_SCALES[0], ROCK_MODEL_SCALES[0], ROCK_MODEL_SCALES[0]);
  return rock;
}
