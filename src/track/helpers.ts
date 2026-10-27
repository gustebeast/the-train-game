import { Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { DEFAULT_TRACK } from './constants';
import { getNeutralPassive } from '../teams';

/** Swap the visual model without destroying/recreating the unit. */
export function reskinTrack(track: Unit, skinType: Units): void {
  track.skin = FourCC(skinType);
}

/** Destroy and recreate as a DEFAULT_TRACK (walkable pathing) at (x, y), then
 *  apply the skin. */
export function replaceTrack(track: Unit, skinType: Units, x: number, y: number): Unit {
  const wasInvulnerable = track.invulnerable;
  track.destroy();
  const newUnit = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), x, y, 0)!;
  reskinTrack(newUnit, skinType);
  newUnit.invulnerable = wasInvulnerable;
  return newUnit;
}
