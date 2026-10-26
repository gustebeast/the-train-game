import { Units } from '@objectdata/units';

// Shared data: compiletime.ts loads this module too (see sharedData.ts for the
// rule that allows it), so it holds data and declarations only.

export type Direction = 'N' | 'S' | 'E' | 'W';

export const TRACK_SIZE = 128;

/** A track piece as it is being placed: solid, so it pushes the builder off
 *  the tile, and replaced by a DEFAULT_TRACK the moment it finishes. */
export const OMNI_TRACK = Units.Farm;
/** What every placed piece IS: walkable, so the train can drive over it. Its
 *  shape is only a skin (see TRACK_PIECES). */
export const DEFAULT_TRACK = Units.ScoutTower;
export const OMNI_TRACK_MODEL = 'OmniTrack';

/** One orientation of track: the unit type worn as its skin, and the model
 *  that unit carries (war3mapImported/<model>.mdx), each pre-rotated. */
export interface TrackPiece { unit: Units; model: string; }

/** Every orientation, keyed by toOrientationKey of the piece's two neighbours.
 *
 *  The model files are named 90 degrees clockwise from the key that wears
 *  them -- the EW piece carries NSTrack.mdx -- and these pairs are the ones
 *  that draw correctly. The build authors each unit from this table, so the
 *  pairing is written down exactly once. */
export const TRACK_PIECES: { [orientation: string]: TrackPiece } = {
  EW: { unit: DEFAULT_TRACK, model: 'NSTrack' },
  NS: { unit: Units.GuardTower, model: 'EWTrack' },
  EN: { unit: Units.CannonTower, model: 'ESTrack' },
  NW: { unit: Units.ArcaneTower, model: 'ENTrack' },
  SW: { unit: Units.WatchTower, model: 'NWTrack' },
  ES: { unit: Units.BoulderTower, model: 'SWTrack' },
};

/** The unit type to skin a piece as, for an orientation key. */
export function skinFor(orientation: string): Units {
  return (TRACK_PIECES[orientation] ?? TRACK_PIECES.EW).unit;
}

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
