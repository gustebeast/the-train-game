import { Grid, GRID_MAX_X } from './constants';
import { generateTerrain, generateCheatTerrain, generateLobby, generateDefeatLobby } from './generate';
import { spawnTerrain, SpawnedTrain } from './spawn';
import { initTrain, initLobbyTrain, setVictoryCallback, setAwardVictoryCallback, setDefeatCallback } from '../train';
import { registerReadyZone } from '../ready';
import { awardVictory } from '../victory';
import { gameState } from '../state';
import { revertToLobbySnapshot, saveLobbySnapshot } from '../save';
import {
  hasHeroes, initRandomHeroes,
  saveHeroLobbySnapshot, revertHeroesToLobbySnapshot,
} from '../heroes';
import { startDPSTest } from '../creeps';
import { loadCrateForRound, loadCrateForLobby } from '../items';
import { resetChallengeProgress } from '../challengeList';
import { hideChallengeUI } from '../challengeUI';
import { applyChallengeEffects, clearChallengeEffects } from '../challengeEffects';
import { startDayNightForRound, stopDayNight } from '../daynight';
import { resetRandomOutcome } from '../randomOutcome';
import { refreshLobbyRoster, resetLobbyRoster } from '../lobbyRoster';
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

// Both lobby tracks: IMA ADPCM in a WAV container, on a sound handle.
// WC3 decodes ADPCM fine (verified in game). Chosen over PCM because MPQ was
// measured to recover only ~5% on PCM, so a 24-bit master would cost its full
// size in the archive.
//
// The masters live outside the repo with the other bounces, in
// Documents/Music/Bounces/TheTrainGame. Re-encode from there rather than from
// these files -- the difference between one lossy generation and two.
const TRACK_FILES = {
  lobby: 'war3mapImported\\InterRoundLobby.wav',
  defeat: 'war3mapImported\\Purgatory.wav',
};

type MusicTrack = keyof typeof TRACK_FILES;

/** Which track SHOULD be playing, or null for none. */
let currentTrack: MusicTrack | null = null;
const trackHandles: { [K in MusicTrack]: sound | null } = { lobby: null, defeat: null };

/**
 * Say which track should be playing. Declarative on purpose.
 *
 * Callers state the desired end state rather than issuing stop/start pairs, so
 * asking for the track that is ALREADY playing does nothing at all. That is
 * what makes a whole class of bug impossible: "Resetting purchases" re-enters
 * the lobby while the lobby track is already running, and the previous
 * stop-then-start version left it silent, because it tore down a playing sound
 * and could not reliably restart it in the same frame. Nothing here can produce
 * silence unless silence was asked for.
 *
 * Three conditions make the loops seamless, and each is easy to undo:
 *
 *  1. The FILE must not carry padding. ADPCM pads to whole blocks, so each loop
 *     length is an exact multiple of 1017 samples. Re-encode off that multiple
 *     and a click comes straight back.
 *  2. The CHANNEL must be 7. A sound's volume group is derived from its
 *     channel, and 7 is music -- without it a track ignores the music slider
 *     and answers to sound effects instead.
 *  3. Only ONE track plays at a time, which is this function's job.
 *
 * Why sound handles and not PlayMusic: the music channel loops by restarting
 * the file and cannot do it seamlessly. A sound handle loops internally.
 */
function setMusic(track: MusicTrack | null): void {
  if (track === currentTrack) return;   // already in the requested state

  // Silence the music channel and every track handle, so nothing can stack or
  // linger. StopMusic does not touch sound handles, hence both.
  StopMusic(false);
  ClearMapMusic();
  for (const key of ['lobby', 'defeat'] as MusicTrack[]) {
    const h = trackHandles[key];
    if (h != null) StopSound(h, false, false);
  }
  currentTrack = track;
  if (track == null) return;

  let handle = trackHandles[track];
  if (handle == null) {
    // looping = true; is3D = false so it plays at full volume everywhere.
    handle = CreateSound(TRACK_FILES[track], true, false, false, 10, 10, '') ?? null;
    if (handle != null) {
      SetSoundChannel(handle, 7);   // must be set before StartSound
      SetSoundVolume(handle, 127);
    }
    trackHandles[track] = handle;
  }
  if (handle != null) StartSound(handle);
}

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid, skipCleanup = false): SpawnedTrain {
  setMusic(null);
  applyChallengeEffects();
  startDayNightForRound();
  if (!hasHeroes()) initRandomHeroes();
  const spawned = spawnTerrain(grid, skipCleanup);
  // Counters are per round, so a challenge bought now starts from zero rather
  // than inheriting whatever last round left behind. After the spawn, not
  // before: the track challenges measure the line, so they need this round's
  // starting track already down to know where the players' own work begins.
  resetChallengeProgress();
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
  setMusic('defeat');
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
  setMusic('lobby');
  SetTimeOfDay(12);
  const spawned = spawnTerrain(generateLobby());
  if (spawned.engine != null && spawned.wagon != null) initLobbyTrain(spawned.engine, spawned.wagon);
  loadCrateForLobby();
  // Heroes and mercenaries stand together in the south-east corner, so the one
  // Reroll item can target either. Reset first: spawnTerrain has just removed
  // the previous lobby's display units, and their handles must not be reused.
  resetLobbyRoster();
  refreshLobbyRoster();
  startDPSTest();
}
