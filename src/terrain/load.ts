import { Grid, GRID_MAX_X, gridToWorld } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby } from './generate';
import { spawnTerrain, SpawnedTrain } from './spawn';
import { initTrain, initLobbyTrain, setVictoryCallback, setAwardVictoryCallback } from '../train';
import { registerReadyZone } from '../ready';
import { awardVictory } from '../victory';
import { gameState } from '../state';
import { revertToLobbySnapshot, saveLobbySnapshot } from '../save';
import {
  hasHeroes, initRandomHeroes, spawnLobbyHeroes, clearLastSummoned,
  saveHeroLobbySnapshot, revertHeroesToLobbySnapshot,
} from '../heroes';
import { startDPSTest } from '../creeps';
import { loadCrateForRound, loadCrateForLobby } from '../items';

setVictoryCallback(() => loadLobby());
setAwardVictoryCallback(() => awardVictory());
registerReadyZone('start', 'Starting next round', () => loadTerrain(gameState.round));
registerReadyZone('revert', 'Resetting purchases', () => {
  revertToLobbySnapshot();
  revertHeroesToLobbySnapshot(); // undoes rerolls bought this lobby
  loadLobby();
});

const LOBBY_MUSIC = 'war3mapImported\\InGameLobby.mp3';

/** Start the looping lobby track. The music channel loops it natively — no re-trigger needed. */
function playLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  PlayMusic(LOBBY_MUSIC);
}

/** Stop the lobby track when leaving the lobby (e.g. a round starts). */
function stopLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
}

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid, skipCleanup = false): SpawnedTrain {
  stopLobbyMusic();
  clearLastSummoned(); // this round's summon (if any) re-records it
  if (!hasHeroes()) initRandomHeroes();
  const spawned = spawnTerrain(grid, skipCleanup);
  if (spawned.engine != null && spawned.wagon != null && !skipCleanup) {
    initTrain(spawned.engine, spawned.wagon);
    loadCrateForRound();
  }
  return spawned;
}

export function loadTerrain(difficulty: number, skipCleanup = false, exitX = GRID_MAX_X): SpawnedTrain {
  return loadGameplay(generateTerrain(difficulty, exitX), skipCleanup);
}

export function loadCheatTerrain(exitX = GRID_MAX_X, exitY = 0): void {
  loadGameplay(generateCheatTerrain(exitX, exitY));
}

export function loadLobby(): void {
  saveLobbySnapshot();
  saveHeroLobbySnapshot();
  playLobbyMusic();
  SetTimeOfDay(12);
  const spawned = spawnTerrain(generateLobby());
  if (spawned.engine != null && spawned.wagon != null) initLobbyTrain(spawned.engine, spawned.wagon);
  loadCrateForLobby();
  // Last round's summoned heroes stand south of the peasants for rerolling
  spawnLobbyHeroes([gridToWorld({ x: -1, y: -2 }), gridToWorld({ x: 1, y: -2 })]);
  startDPSTest();
}
