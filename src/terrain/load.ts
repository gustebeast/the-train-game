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
// IMA ADPCM in a WAV container, 387KB. WC3 decodes it fine (verified in game).
// Chosen over PCM because MPQ was measured to recover only ~5% on PCM, so the
// master would have cost its full 2.3MB in the archive.
//
// The master lives at assets/audio/Purgatory-master.wav, outside the map so it
// is not packaged. Re-encode from there rather than from this file: it is the
// difference between one lossy generation and two.
const DEFEAT_MUSIC = 'war3mapImported\\PurgatoryAdpcm.wav';

/** Start the looping lobby track. The music channel loops it natively — no re-trigger needed. */
function playLobbyMusic(): void {
  StopMusic(false);
  ClearMapMusic();
  stopDefeatMusic(); // it is on a sound handle, so StopMusic will not stop it
  PlayMusic(LOBBY_MUSIC);
}

/** The defeat track, played on a SOUND handle rather than through PlayMusic.
 *  Verified in game: loops seamlessly and follows the music volume slider.
 *
 *  Why not PlayMusic: it loops by restarting the file, and an MP3 cannot loop
 *  seamlessly -- every MP3 carries encoder delay and end padding, and gapless
 *  playback needs the decoder to honour LAME's tags, which WC3 does not. A
 *  sound handle loops internally instead (the `looping` flag below).
 *
 *  Two things had to be true for this to work, and both are easy to undo by
 *  accident:
 *
 *  1. The FILE must not carry padding either. ADPCM pads to whole blocks, so
 *     the loop length is an exact multiple of 1017 samples (see the note on
 *     PurgatoryAdpcm.wav's creation in git). Change the loop length off that
 *     multiple and the click comes straight back.
 *  2. The CHANNEL must be 7. A sound's volume group is derived from its
 *     channel, and 7 is music -- without it the track ignores the music slider
 *     and answers to sound effects instead.
 */
let defeatSound: sound | null = null;

function playDefeatMusic(): void {
  // Silence the music channel so the two do not stack.
  StopMusic(false);
  ClearMapMusic();
  if (defeatSound == null) {
    // looping = true; is3D = false so it plays at full volume everywhere.
    defeatSound = CreateSound(DEFEAT_MUSIC, true, false, false, 10, 10, '') ?? null;
    if (defeatSound != null) {
      // Put it on WC3's MUSIC channel (7) so it follows the music volume
      // slider rather than sound effects. A sound's volume group is derived
      // from its channel, and playing on a sound handle is what makes the loop
      // seamless -- so this keeps the clean loop AND the right slider, rather
      // than trading one for the other. Must be set before StartSound.
      SetSoundChannel(defeatSound, 7);
      SetSoundVolume(defeatSound, 127);
    }
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
