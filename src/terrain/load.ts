import { Grid, GRID_MAX_X, gridToWorld } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby, generateDefeatLobby } from './generate';
import { spawnTerrain, SpawnedTrain } from './spawn';
import { initTrain, initLobbyTrain, setVictoryCallback, setAwardVictoryCallback, setDefeatCallback } from '../train';
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
import { resetChallengeProgress } from '../challengeList';
import { hideChallengeUI } from '../challengeUI';
import { applyChallengeEffects, clearChallengeEffects } from '../challengeEffects';
import { startDayNightForRound, stopDayNight } from '../daynight';
import { spawnLobbyMerc } from '../mercenary';
import { resetRandomOutcome } from '../randomOutcome';
import { deriveSeed } from '../rng';
import { advanceChallengeOffer } from '../challenges';

setVictoryCallback(() => loadLobby());
setDefeatCallback(() => loadDefeatLobby());
setAwardVictoryCallback(() => awardVictory());
registerReadyZone('start', 'Starting next round', () => loadTerrain(gameState.round));
registerReadyZone('revert', 'Resetting purchases', () => {
  revertToLobbySnapshot();
  revertHeroesToLobbySnapshot(); // undoes rerolls bought this lobby
  loadLobby();
});

const LOBBY_MUSIC = 'war3mapImported\\InGameLobby.mp3';
const DEFEAT_MUSIC = 'war3mapImported\\Purgatory.mp3';

/** Start the looping lobby track. The music channel loops it natively — no re-trigger needed. */
function playLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  PlayMusic(LOBBY_MUSIC);
}

/** Start the looping defeat-lobby track. Loops natively like the lobby one.
 *  ClearMapMusic matters here: without it the map's own music list can come
 *  back over the top when the engine picks the next track. */
function playDefeatMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  PlayMusic(DEFEAT_MUSIC);
}

/** Stop the lobby track when leaving the lobby (e.g. a round starts). */
function stopLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
}

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid, skipCleanup = false): SpawnedTrain {
  stopLobbyMusic();
  // Counters are per round, so a challenge bought now starts from zero rather
  // than inheriting whatever last round left behind.
  resetChallengeProgress();
  applyChallengeEffects();
  startDayNightForRound();
  clearLastSummoned(); // this round's summon (if any) re-records it
  if (!hasHeroes()) initRandomHeroes();
  const spawned = spawnTerrain(grid, skipCleanup);
  if (spawned.engine != null && spawned.wagon != null && !skipCleanup) {
    initTrain(spawned.engine, spawned.wagon);
    loadCrateForRound();
  }
  return spawned;
}

/** Stream id for map generation (see rng.deriveSeed). */
const TERRAIN_STREAM = 2;

export function loadTerrain(difficulty: number, skipCleanup = false, exitX = GRID_MAX_X): SpawnedTrain {
  // Map generation is hundreds of draws deep (corridors, blobs, tree and rock
  // scatter, camp placement), so rather than thread a seeded RNG through all of
  // generate.ts, point WC3's own generator at a reproducible starting point
  // first. Same save and same round therefore lay out the same map, which is
  // what stops a player rerolling the terrain by reloading.
  //
  // Keyed on the round as well as the seed, so consecutive rounds differ.
  SetRandomSeed(deriveSeed(TERRAIN_STREAM) + difficulty);
  return loadGameplay(generateTerrain(difficulty, exitX), skipCleanup);
}

export function loadCheatTerrain(exitX = GRID_MAX_X, exitY = 0): void {
  loadGameplay(generateCheatTerrain(exitX, exitY));
}

/** Load the defeat lobby: the lobby tileset, empty.
 *
 *  Intentionally spawns nothing else -- no train, shop, crate, heroes, merc or
 *  ready circles. There is no way to start another round from here, which is
 *  the point: the run is over. It also does NOT snapshot or save, so a defeat
 *  cannot overwrite the lobby state a later session would load.
 *
 *  Contrast loadLobby(), which is the victory path and rebuilds everything. */
export function loadDefeatLobby(): void {
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  playDefeatMusic();
  SetTimeOfDay(12);
  spawnTerrain(generateDefeatLobby());
}

export function loadLobby(): void {
  // No round in progress, so no challenge overlay, handicaps or night timer.
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  resetRandomOutcome();
  saveLobbySnapshot();
  saveHeroLobbySnapshot();
  playLobbyMusic();
  SetTimeOfDay(12);
  const spawned = spawnTerrain(generateLobby());
  if (spawned.engine != null && spawned.wagon != null) initLobbyTrain(spawned.engine, spawned.wagon);
  loadCrateForLobby();
  // Last round's summoned heroes stand in the south-east corner, with the
  // mercenary alongside them so the one Reroll item can target either.
  spawnLobbyHeroes([gridToWorld({ x: 2, y: -3 }), gridToWorld({ x: 3, y: -3 })]);
  spawnLobbyMerc(gridToWorld({ x: 3, y: -2 }).x, gridToWorld({ x: 3, y: -2 }).y);
  startDPSTest();
}
