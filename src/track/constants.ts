import { Units } from '@objectdata/units';

export type Direction = 'N' | 'S' | 'E' | 'W';

export const TRACK_SIZE = 128;

export const OMNI_TRACK = Units.Farm;
export const DEFAULT_TRACK = Units.ScoutTower;

/** Maps orientation key → unit type used as skin (each has a pre-rotated model) */
export const SKINS: { [key: string]: Units } = {
  EW: DEFAULT_TRACK,
  NS: Units.GuardTower,
  EN: Units.CannonTower,
  NW: Units.ArcaneTower,
  SW: Units.WatchTower,
  ES: Units.BoulderTower,
};

export const DIRECTIONS = {
  N: [0, TRACK_SIZE],
  S: [0, -TRACK_SIZE],
  E: [TRACK_SIZE, 0],
  W: [-TRACK_SIZE, 0],
} as const;

export const OPPOSITE = {
  N: 'S', S: 'N', E: 'W', W: 'E',
} as const;

export const TRACK_UNIT_TYPES = [OMNI_TRACK, DEFAULT_TRACK];

export function toOrientationKey(dir1: Direction, dir2: Direction): string {
  return [dir1, dir2].sort().join('');
}
