import { Unit } from 'w3ts';
import { Grid, GRID_MAX_X } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby } from './generate';
import { spawnTerrain } from './spawn';
import { initTrain, initLobbyTrain, setVictoryCallback, setAwardVictoryCallback } from '../train';
import { registerReadyZone } from '../ready';
import { awardVictory } from '../victory';
import { gameState, revertToLobbySnapshot, saveLobbySnapshot } from '../state';
import { resetHeroState, hasHeroes, initRandomHeroes, chooseHeroes } from '../heroes';
import { startDPSTest } from '../creeps';

setVictoryCallback(() => loadLobby());
setAwardVictoryCallback(() => awardVictory());
registerReadyZone('start', 'Starting next round', () => loadTerrain(gameState.round));
registerReadyZone('revert', 'Resetting purchases', () => {
  revertToLobbySnapshot();
  loadLobby();
});

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid, skipCleanup = false): Unit | null {
  resetHeroState();
  if (!hasHeroes()) initRandomHeroes();
  chooseHeroes();
  const trainUnit = spawnTerrain(grid, skipCleanup);
  if (trainUnit != null && !skipCleanup) initTrain(trainUnit);
  return trainUnit;
}

export function loadTerrain(difficulty: number, skipCleanup = false, exitX = GRID_MAX_X): Unit | null {
  return loadGameplay(generateTerrain(difficulty, exitX), skipCleanup);
}

export function loadCheatTerrain(exitX = GRID_MAX_X, exitY = 0): void {
  loadGameplay(generateCheatTerrain(exitX, exitY));
}

export function loadLobby(): void {
  saveLobbySnapshot();
  SetTimeOfDay(12);
  const trainUnit = spawnTerrain(generateLobby());
  if (trainUnit != null) initLobbyTrain(trainUnit);
  startDPSTest();
}
