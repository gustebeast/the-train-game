import { MapPlayer, Unit } from 'w3ts';
import { UNKNOWN_UNIT_ID } from './constants';

/**
 * The "?" standing in for a hero or mercenary you have rolled but not yet met.
 *
 * Its model plays ONCE and stops -- it is a cinematic prop, authored to flash
 * on screen during a scene rather than hold a pose -- so a placeholder left
 * standing goes blank after a second or two. Pinning it to its first frame and
 * stopping its clock is the attempt to keep it drawn: it can then never reach
 * the end that makes it vanish.
 *
 * Every placeholder in the game goes through here, so whatever it takes to
 * make the mark hold is written once rather than at each of the three places
 * one gets created.
 */
export function holdPlaceholderPose(u: Unit): void {
  SetUnitAnimationByIndex(u.handle, 0);
  SetUnitTimeScale(u.handle, 0);
}

/** Create a concealed stand-in at (x, y), carrying `items`.
 *
 *  The kit still shows: what a reroll keeps is information the player is
 *  entitled to. It is WHO they got that is being withheld. */
export function createPlaceholder(
  owner: MapPlayer, x: number, y: number, items: number[],
): Unit | null {
  const u = Unit.create(owner, UNKNOWN_UNIT_ID, x, y, 270);
  if (u == null) return null;
  u.invulnerable = true;
  holdPlaceholderPose(u);
  for (const itemId of items) {
    const it = CreateItem(itemId, u.x, u.y);
    if (it != null) UnitAddItem(u.handle, it);
  }
  return u;
}
