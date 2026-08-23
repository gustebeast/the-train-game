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
// IMA ADPCM in a WAV container: 388KB against the MP3's 282KB, but with no
// encoder delay or padding, so the loop point is sample-exact. Converted from
// the 24-bit master, so it is also one lossy generation rather than two.
//
// If WC3 turns out not to decode ADPCM, fall back to PCM (32kHz mono is ~535KB)
// -- the symptom would be silence in the defeat lobby, not a crash.
const DEFEAT_MUSIC = 'war3mapImported\\PurgatoryAdpcm.wav';

/** Start the looping lobby track. The music channel loops it natively — no re-trigger needed. */
function playLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  stopDefeatMusic(); // it is on a sound handle, so StopMusic will not stop it
  PlayMusic(LOBBY_MUSIC);
}

/** The defeat track, played on a SOUND handle rather than the music channel.
 *
 *  Why not PlayMusic: the music channel loops by restarting the file, and an
 *  MP3 cannot loop seamlessly. Every MP3 carries encoder delay at the start and
 *  padding at the end (~1000+ samples), and gapless playback depends on the
 *  decoder honouring LAME's tags, which WC3 does not. The result is an audible
 *  click or gap at the loop point no matter how cleanly the audio is authored.
 *
 *  A sound handle loops internally (the `looping` flag below) and, unlike the
 *  single music stream, handles mix -- so if a click still remains this can be
 *  extended to two handles crossfading over a silent lead-in.
 *
 *  THE REAL FIX IS THE FORMAT. Export this as WAV and the encoder padding does
 *  not exist, so the loop is sample-exact. Point DEFEAT_MUSIC at the .wav,
 *  import it, and nothing else here has to change.
 *
 *  One consequence worth knowing: sound handles follow the game's SOUND volume
 *  slider, not MUSIC. A player who has turned music down will still hear this.
 */
let defeatSound: sound | null = null;

function playDefeatMusic(): void {
  // Silence the music channel so the two do not stack.
  StopMusic(false);
  ClearMapMusic();
  if (defeatSound == null) {
    // looping = true; is3D = false so it plays at full volume everywhere.
    defeatSound = CreateSound(DEFEAT_MUSIC, true, false, false, 10, 10, '') ?? null;
    if (defeatSound != null) SetSoundVolume(defeatSound, 127);
  }
  if (defeatSound != null) StartSound(defeatSound);
}

/** Stop the defeat track. Safe to call when it was never started. */
function stopDefeatMusic(): void {
  if (defeatSound != null) StopSound(defeatSound, false, false);
}

/** Stop the lobby track when leaving the lobby (e.g. a round starts).
 *
 *  Also stops the defeat track: it plays on a sound handle, which StopMusic
 *  does not touch, so without this it would keep playing underneath whatever
 *  comes next. Reaching a round from defeat needs a save load, but that path
 *  exists (-load), and a stuck loop is a nasty thing to debug later. */
function stopLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  stopDefeatMusic();
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
