import { Unit } from 'w3ts';
import { GridPos } from '../terrain/constants';

export const placedTracks: Unit[] = [];

let _victoryTriggered = false;
let _victoryTile: GridPos = { x: 0, y: 0 };

export function isVictoryTriggered(): boolean {
  return _victoryTriggered;
}

export function setVictoryTriggered(): void {
  _victoryTriggered = true;
}

export function setVictoryTile(worldX: number, worldY: number): void {
  _victoryTile = { x: worldX, y: worldY };
}

export function getVictoryTile(): GridPos {
  return _victoryTile;
}

export function removeTrack(unit: Unit): void {
  const idx = placedTracks.findIndex(t => t.handle === unit.handle);
  if (idx !== -1) placedTracks.splice(idx, 1);
}
