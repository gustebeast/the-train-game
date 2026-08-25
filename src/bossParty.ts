import { MapPlayer } from 'w3ts';
import { getHumanPlayers } from './util';

/**
 * Who controls what in the boss fight.
 *
 * Unlike every other time the heroes appear, they are not one player's puppets
 * here -- the party is dealt out, so everybody has somebody to play.
 *
 * The rules, in order:
 *   - every player is dealt one hero at random, and if there are fewer players
 *     than heroes the deal goes round again, so nobody is left watching;
 *   - then one mercenary to a random player, and the second to a DIFFERENT
 *     one, preferring whoever is holding least. With four players that spreads
 *     the mercenaries onto two of them; with two, it gives each a second unit
 *     rather than piling both on one.
 *
 * Kept apart from the spawning itself so the dealing can be reasoned about --
 * and tested -- without a map, units or an arena.
 */

/** How many units each player has been dealt, by player id. */
export interface PartyAssignment {
  /** Owner for each hero, in roster order. */
  heroOwners: number[];
  /** Owner for each mercenary, in contract order. */
  mercOwners: number[];
}

/** Fisher-Yates, on a copy. */
function shuffled<T>(source: ReadonlyArray<T>): T[] {
  const out = source.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = GetRandomInt(0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Deal `heroCount` heroes and `mercCount` mercenaries among `playerIds`.
 *
 * Pure: give it the same inputs and the only variation is the shuffle, which
 * is the point. No units, no map, no side effects.
 */
export function dealParty(
  playerIds: ReadonlyArray<number>, heroCount: number, mercCount: number,
): PartyAssignment {
  const heroOwners: number[] = [];
  const mercOwners: number[] = [];
  if (playerIds.length === 0) return { heroOwners, mercOwners };

  // Heroes: deal round the table in a random order, reshuffling each lap so a
  // short table does not always hand its second hero to the same person.
  const held: Record<number, number> = {};
  for (const id of playerIds) held[id] = 0;
  let order = shuffled(playerIds);
  let next = 0;
  for (let i = 0; i < heroCount; i++) {
    if (next >= order.length) { order = shuffled(playerIds); next = 0; }
    const owner = order[next];
    next += 1;
    heroOwners.push(owner);
    held[owner] += 1;
  }

  // Mercenaries: to whoever is holding least, breaking ties at random, and
  // never twice to the same player while another could take one.
  const taken: Record<number, boolean> = {};
  for (let i = 0; i < mercCount; i++) {
    let pool = playerIds.filter(id => !taken[id]);
    // More mercenaries than players: everyone is eligible again.
    if (pool.length === 0) { pool = playerIds.slice(); for (const id of playerIds) taken[id] = false; }
    let fewest = held[pool[0]];
    for (const id of pool) {
      if (held[id] < fewest) fewest = held[id];
    }
    const lightest = pool.filter(id => held[id] === fewest);
    const owner = shuffled(lightest)[0];
    mercOwners.push(owner);
    held[owner] += 1;
    taken[owner] = true;
  }
  return { heroOwners, mercOwners };
}

/** The same deal, for whoever is actually playing. */
export function dealPartyForHumans(heroCount: number, mercCount: number): PartyAssignment {
  const ids = getHumanPlayers().map((p: MapPlayer) => p.id);
  return dealParty(ids, heroCount, mercCount);
}
