import { Unit } from 'w3ts';
import { GRID_MAX_X } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby } from './generate';
import { spawnTerrain } from './spawn';
import { initTrain, initLobbyTrain, setVictoryCallback, setAwardVictoryCallback } from '../train';
import { setStartRoundCallback } from '../ready';
import { awardVictory } from '../victory';

setVictoryCallback(() => loadLobby());
setAwardVictoryCallback(() => awardVictory());
setStartRoundCallback((difficulty) => loadTerrain(difficulty));

export function loadTerrain(difficulty: number, skipCleanup = false, exitX = GRID_MAX_X): Unit | null {
  const trainUnit = spawnTerrain(generateTerrain(difficulty, exitX), skipCleanup);
  if (trainUnit != null && !skipCleanup) initTrain(trainUnit);
  return trainUnit;
}

export function loadCheatTerrain(exitX = GRID_MAX_X, exitY = 0): void {
  const trainUnit = spawnTerrain(generateCheatTerrain(exitX, exitY));
  if (trainUnit != null) initTrain(trainUnit);
}

export function loadLobby(): void {
  const trainUnit = spawnTerrain(generateLobby());
  if (trainUnit != null) initLobbyTrain(trainUnit);
}
