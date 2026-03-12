import { Unit } from 'w3ts';

export const placedTracks: Unit[] = [];

export function removeTrack(unit: Unit): void {
  const idx = placedTracks.findIndex(t => t.handle === unit.handle);
  if (idx !== -1) placedTracks.splice(idx, 1);
}
