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

// Both lobby tracks: IMA ADPCM in a WAV container, on a sound handle.
// WC3 decodes ADPCM fine (verified in game). Chosen over PCM because MPQ was
// measured to recover only ~5% on PCM, so a 24-bit master would cost its full
// size in the archive.
//
// The masters live outside the repo with the other bounces, in
// Documents/Music/Bounces/TheTrainGame. Re-encode from there rather than from
// these files -- the difference between one lossy generation and two.
const LOBBY_MUSIC = 'war3mapImported\\InterRoundLobbyAdpcm.wav';
const DEFEAT_MUSIC = 'war3mapImported\\PurgatoryAdpcm.wav';

/** Start a seamless looping track on a SOUND handle, reusing the handle so a
 *  re-entry does not stack a second copy. Returns the handle to store.
 *
 *  Why not PlayMusic: it loops by restarting the file, and it cannot do so
 *  seamlessly. Every MP3 carries encoder delay and end padding, and gapless
 *  playback needs the decoder to honour LAME's tags, which WC3 does not. A
 *  sound handle loops internally instead (the `looping` flag below).
 *
 *  Three things have to be true, and each is easy to undo by accident:
 *
 *  1. The FILE must not carry padding either. ADPCM pads to whole blocks, so
 *     each loop length is an exact multiple of 1017 samples. Re-encode off that
 *     multiple and the click comes straight back.
 *  2. The CHANNEL must be 7. A sound's volume group is derived from its
 *     channel, and 7 is music -- without it the track ignores the music slider
 *     and answers to sound effects instead.
 *  3. Only ONE may play at a time. StopMusic does not touch sound handles, so
 *     whoever starts one stops the other explicitly. */
function startLoopingTrack(handle: sound | null, path: string): sound | null {
  StopMusic(false);       // silence the music channel so nothing stacks
  ClearMapMusic();
  let s = handle;
  if (s == null) {
    // looping = true; is3D = false so it plays at full volume everywhere.
    s = CreateSound(path, true, false, false, 10, 10, '') ?? null;
    if (s != null) {
      SetSoundChannel(s, 7);   // must be set before StartSound
      SetSoundVolume(s, 127);
    }
  }
  if (s != null) StartSound(s);
  return s;
}

function stopTrack(handle: sound | null): void {
  if (handle != null) StopSound(handle, false, false);
}

let lobbySound: sound | null = null;
let defeatSound: sound | null = null;

/** Start the looping inter-round lobby track. */
function playLobbyMusic(): void {
  stopTrack(defeatSound);
  lobbySound = startLoopingTrack(lobbySound, LOBBY_MUSIC);
}

/** Start the looping defeat-lobby track. */
function playDefeatMusic(): void {
  stopTrack(lobbySound);
  defeatSound = startLoopingTrack(defeatSound, DEFEAT_MUSIC);
}

/** Stop both lobby tracks when leaving a lobby (e.g. a round starts).
 *
 *  Both play on sound handles, which StopMusic does not touch, so without this
 *  one would keep playing underneath whatever comes next. */
function stopLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  stopTrack(lobbySound);
  stopTrack(defeatSound);
}

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid, skipCleanup = false): SpawnedTrain {
  stopLobbyMusic();
  applyChallengeEffects();
  startDayNightForRound();
  clearLastSummoned(); // this round's summon (if any) re-records it
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
