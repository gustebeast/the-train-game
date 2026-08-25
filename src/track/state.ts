import { Unit } from 'w3ts';
import { GridPos } from '../terrain/constants';

export const placedTracks: Unit[] = [];

let _victoryTriggered = false;
let _victoryTile: GridPos = { x: 0, y: 0 };
/** The boss exit, when the round has one. Null in every ordinary round. */
let _bossVictoryTile: GridPos | null = null;
/** Which exit the finished line ran to. Read when the train arrives, to decide
 *  whether it pulls into the lobby or the arena. */
let _victoryWasBoss = false;

export function isVictoryTriggered(): boolean {
  return _victoryTriggered;
}

export function setVictoryTriggered(): void {
  _victoryTriggered = true;
}

export function resetVictoryTriggered(): void {
  _victoryTriggered = false;
  _victoryWasBoss = false;
  _bossVictoryTile = null;
}

export function setBossVictoryTile(worldX: number, worldY: number): void {
  _bossVictoryTile = { x: worldX, y: worldY };
}

export function getBossVictoryTile(): GridPos | null {
  return _bossVictoryTile;
}

export function markBossVictory(): void {
  _victoryWasBoss = true;
}

/** True when the last track went down on the boss exit rather than the usual
 *  one. Set as the line is finished and read when the train arrives. */
export function isBossVictory(): boolean {
  return _victoryWasBoss;
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
