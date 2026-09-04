import { MapPlayer, Unit } from 'w3ts';
import { UNKNOWN_UNIT_ID } from './constants';
import { giveItems } from './util';

/** Create a concealed stand-in at (x, y), carrying `items`.
 *
 *  The kit still shows: what a reroll keeps is information the player is
 *  entitled to. It is WHO they got that is being withheld.
 *
 *  Shared because there are three places a placeholder gets made -- a hero
 *  roster slot, a mercenary roster slot, and a mercenary reroll -- and a
 *  change applied to two of the three looks exactly like the model being
 *  unreliable. */
export function createPlaceholder(
  owner: MapPlayer, x: number, y: number, items: number[],
): Unit | null {
  const u = Unit.create(owner, UNKNOWN_UNIT_ID, x, y, 270);
  if (u == null) return null;
  u.invulnerable = true;
  giveItems(u, items);
  return u;
}
