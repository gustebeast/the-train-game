import { GRID_MAX_X } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby } from './generate';
import { spawnTerrain } from './spawn';
import { respawnTrain, setVictoryCallback } from '../train';

setVictoryCallback(() => loadLobby());

export function loadTerrain(difficulty: number, skipCleanup = false, exitX = GRID_MAX_X): void {
  spawnTerrain(generateTerrain(difficulty, exitX), skipCleanup);
  if (!skipCleanup) respawnTrain();
}

export function loadCheatTerrain(exitX = GRID_MAX_X): void {
  spawnTerrain(generateCheatTerrain(exitX));
  respawnTrain();
}

export function loadLobby(): void {
  spawnTerrain(generateLobby());
}
