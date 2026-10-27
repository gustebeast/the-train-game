import { Unit } from 'w3ts';
import { GridPos } from '../terrain/constants';

export const placedTracks: Unit[] = [];

const lineListeners: Array<(this: void) => void> = [];

/** Run cb whenever the line or the train's place on it changes: a piece laid
 *  or destroyed, the train moving on to its next piece, the board cleared. */
export function onLineChanged(cb: (this: void) => void): void {
  lineListeners.push(cb);
}

/** Call wherever placedTracks or the train's target piece has just changed. */
export function noteLineChanged(): void {
  for (const cb of lineListeners) cb();
}

let victoryTriggered = false;
let victoryTile: GridPos = { x: 0, y: 0 };
/** The boss exit, when the round has one. Null in every ordinary round. */
let bossVictoryTile: GridPos | null = null;
/** Which exit the finished line ran to. Read when the train arrives, to decide
 *  whether it pulls into the lobby or the arena. */
let victoryWasBoss = false;

export function isVictoryTriggered(): boolean {
  return victoryTriggered;
}

export function setVictoryTriggered(): void {
  victoryTriggered = true;
}

/** A new board: no line finished, no boss exit, nothing decided. */
export function resetLineEnd(): void {
  victoryTriggered = false;
  victoryWasBoss = false;
  bossVictoryTile = null;
}

export function setBossVictoryTile(worldX: number, worldY: number): void {
  bossVictoryTile = { x: worldX, y: worldY };
}

export function getBossVictoryTile(): GridPos | null {
  return bossVictoryTile;
}

export function markBossVictory(): void {
  victoryWasBoss = true;
}

/** True when the last track went down on the boss exit rather than the usual
 *  one. Set as the line is finished and read when the train arrives. */
export function isBossVictory(): boolean {
  return victoryWasBoss;
}

export function setVictoryTile(worldX: number, worldY: number): void {
  victoryTile = { x: worldX, y: worldY };
}

export function getVictoryTile(): GridPos {
  return victoryTile;
}

