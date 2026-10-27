import { MapPlayer, Unit } from 'w3ts';
import { UNKNOWN_UNIT_ID } from './constants';
import { KitItem, giveKit } from './util';

/** Create a concealed stand-in at (x, y), carrying `items`.
 *
 *  The kit still shows: what a reroll keeps is information the player is
 *  entitled to. It is WHO they got that is being withheld.
 *
 *  Used for the hero roster slots. A concealed mercenary is spawned by the
 *  ordinary mercenary spawner as UNKNOWN_UNIT_ID instead (mercenary.ts). */
export function createPlaceholder(
  owner: MapPlayer, x: number, y: number, items: ReadonlyArray<KitItem>,
): Unit | null {
  const u = Unit.create(owner, UNKNOWN_UNIT_ID, x, y, 270);
  if (u == null) return null;
  u.invulnerable = true;
  giveKit(u.handle, items);
  return u;
}
