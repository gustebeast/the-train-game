import { MapPlayer } from 'w3ts';
import { getHumanPlayers } from './util';
import { shuffleRandom } from './rng';

/**
 * Who plays which hero in the boss fight.
 *
 * Unlike every other time the heroes appear, they are not one player's puppets
 * here -- the party is dealt out, so everybody has somebody to play. Every
 * player is dealt one hero at random, and if there are fewer players than
 * heroes the deal goes round again, so nobody is left watching.
 *
 * The mercenaries are not dealt here: the mercenary system already gives each
 * to whoever holds the fewest heroes (spawnMercWithHeroes), and is told the
 * hero owners this produces.
 */

/** One owner (a player id) per hero, in roster order, dealt among whoever is
 *  playing. Round the table in a random order, reshuffled each lap so a short
 *  table does not always hand its second hero to the same person. */
export function dealHeroesForHumans(heroCount: number): number[] {
  const playerIds = getHumanPlayers().map((p: MapPlayer) => p.id);
  const owners: number[] = [];
  if (playerIds.length === 0) return owners;
  let order: number[] = [];
  for (let i = 0; i < heroCount; i++) {
    if (order.length === 0) {
      order = playerIds.slice();
      shuffleRandom(order);
    }
    owners.push(order.shift()!);
  }
  return owners;
}
