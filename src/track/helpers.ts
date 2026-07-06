import { Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { DEFAULT_TRACK } from './constants';
import { getNeutralPassive } from '../teams';

/** Swap the visual model without destroying/recreating the unit. */
export function reskinTrack(track: Unit, skinType: Units): void {
  track.skin = FourCC(skinType);
}

/** Destroy and recreate as a ScoutTower (walkable pathing), then apply skin. */
export function replaceTrack(track: Unit, skinType: Units, x?: number, y?: number): Unit {
  const posX = x ?? track.x;
  const posY = y ?? track.y;
  const wasInvulnerable = track.invulnerable;
  track.destroy();
  const newUnit = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), posX, posY, 0)!;
  newUnit.skin = FourCC(skinType);
  newUnit.invulnerable = wasInvulnerable;
  return newUnit;
}
