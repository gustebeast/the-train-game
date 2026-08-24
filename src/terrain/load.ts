import { Grid, GRID_MAX_X } from './constants';
import { generateTerrain, generateCheatTerrain, generateInterRoundLobby, generateDefeatLobby, generateStartLobby, generateChooseSaveLobby, generateTutorial } from './generate';
import { spawnTerrain, SpawnedTrain } from './spawn';
import { initTrain, initInterRoundLobbyTrain, setVictoryCallback, setAwardVictoryCallback, setDefeatCallback } from '../train';
import { registerReadyZone } from '../ready';
import { Unit } from 'w3ts';
import { PEASANT_ID } from '../constants';
import { getHumanPlayers } from '../util';
import { makeDancer, startDanceClock } from '../dance';
import {
  closeChooseSaveLobby, getSelectedSlot, openChooseSaveLobby,
  selectNewerSave, selectOlderSave,
} from '../chooseSaveLobby';
import { TRACK_SIZE } from '../track/constants';
import { awardVictory } from '../victory';
import { gameState } from '../state';
import { loadFromSlot, markCurrentSaveDefeated, resetToNewRun, revertToInterRoundLobbySnapshot, saveInterRoundLobbySnapshot } from '../save';
import {
  hasHeroes, initRandomHeroes,
  saveHeroInterRoundLobbySnapshot, revertHeroesToInterRoundLobbySnapshot,
} from '../heroes';
import { startDPSTest } from '../creeps';
import { loadCrateForRound, loadCrateForInterRoundLobby } from '../items';
import { resetChallengeProgress } from '../challengeList';
import { hideChallengeUI, hidePanel, showPanel } from '../challengeUI';
import { startTutorialBoard, stopTutorialBoard, tutorialBoardLines } from '../tutorialBoard';
import { applyChallengeEffects, clearChallengeEffects } from '../challengeEffects';
import { startDayNightForRound, stopDayNight } from '../daynight';
import { resetRandomOutcome } from '../randomOutcome';
import { refreshInterRoundLobbyRoster, resetInterRoundLobbyRoster } from '../interRoundLobbyRoster';
import { deriveSeed } from '../rng';
import { advanceChallengeOffer } from '../challenges';

// Finishing a round is what counts as a new visit to the dealer, so that is
// where the shelf rotates. NOT inside loadInterRoundLobby: Reset Purchases goes back
// through there too, and rewinding a purchase must leave the same wager on
// sale rather than letting a player shop for a different one.
/** True while the tutorial is being played.
 *
 *  The tutorial must leave no trace: it never claims a save slot, never calls
 *  awardVictory (which is what writes one), and both of its endings go back to
 *  the start lobby rather than into the inter-round or defeat lobby. Every
 *  other way into gameplay either loads a save or starts a run that will claim
 *  its own slot, so nothing here can reach one. */
let inTutorial = false;

export function isInTutorial(): boolean {
  return inTutorial;
}

/** Leave the tutorial: back to the start lobby, with the session wiped so
 *  nothing the tutorial did can follow the player into a real run. */
function endTutorial(): void {
  inTutorial = false;
  stopTutorialBoard();
  hidePanel();
  resetToNewRun();
  loadStartLobby();
}

setVictoryCallback(() => {
  // Reaching the target track finishes the tutorial rather than opening the
  // inter-round lobby: there is no run to continue.
  if (inTutorial) { endTutorial(); return; }
  advanceChallengeOffer();
  loadInterRoundLobby();
});
setDefeatCallback(() => {
  if (inTutorial) { endTutorial(); return; }
  loadDefeatLobby();
});
// Reaching the target track ends the tutorial instead of paying it out:
// awardVictory is what writes a save, and the tutorial must not write one.
setAwardVictoryCallback(() => {
  if (inTutorial) return;
  awardVictory();
});
registerReadyZone('start', 'Starting next round', () => loadTerrain(gameState.round));
registerReadyZone('newgame', 'Starting a new game', () => {
  resetToNewRun();
  loadTerrain(0);
});
registerReadyZone('tutorial', 'Starting the tutorial', () => {
  resetToNewRun();
  inTutorial = true;
  loadGameplay(generateTutorial());
  // After the load: loadGameplay hides the overlay on its way through, so the
  // board has to be put up once the round is standing.
  startTutorialBoard();
  showPanel('Tutorial', tutorialBoardLines);
});
registerReadyZone('loadsave', 'Opening saved games', () => loadChooseSaveLobby());
registerReadyZone('saveback', 'Going back', () => {
  closeChooseSaveLobby();
  loadStartLobby();
});
// Paging does NOT reload the lobby: only the displayed heroes and the label
// change, so the circles the player is standing among stay put.
registerReadyZone('saveprev', 'Showing the newer save', () => selectNewerSave());
registerReadyZone('savenext', 'Showing the older save', () => selectOlderSave());
registerReadyZone('saveconfirm', 'Loading the selected save', () => {
  const slot = getSelectedSlot();
  if (slot === 0) {
    print('No save selected.');
    return;
  }
  closeChooseSaveLobby();
  if (!loadFromSlot(slot)) {
    print('That save could not be read.');
    loadStartLobby();
    return;
  }
  loadTerrain(gameState.round);
});
registerReadyZone('restart', 'Returning to the start lobby', () => {
  // The run is already marked defeated (loadDefeatLobby did that on the way
  // in), so this only has to put the session back to how it boots.
  resetToNewRun();
  loadStartLobby();
});
registerReadyZone('revert', 'Resetting purchases', () => {
  revertToInterRoundLobbySnapshot();
  revertHeroesToInterRoundLobbySnapshot(); // undoes rerolls bought this inter-round lobby
  loadInterRoundLobby();
});

// Both inter-round lobby tracks: IMA ADPCM in a WAV container, on a sound handle.
// WC3 decodes ADPCM fine (verified in game). Chosen over PCM because MPQ was
// measured to recover only ~5% on PCM, so a 24-bit master would cost its full
// size in the archive.
//
// The masters live outside the repo with the other bounces, in
// Documents/Music/Bounces/TheTrainGame. Re-encode from there rather than from
// these files -- the difference between one lossy generation and two.
const TRACK_FILES = {
  interRound: 'war3mapImported\\InterRoundLobby.wav',
  defeat: 'war3mapImported\\Purgatory.wav',
};

type MusicTrack = keyof typeof TRACK_FILES;

/** Which track SHOULD be playing, or null for none. */
let currentTrack: MusicTrack | null = null;
const trackHandles: { [K in MusicTrack]: sound | null } = { interRound: null, defeat: null };

/**
 * Say which track should be playing. Declarative on purpose.
 *
 * Callers state the desired end state rather than issuing stop/start pairs, so
 * asking for the track that is ALREADY playing does nothing at all. That is
 * what makes a whole class of bug impossible: "Resetting purchases" re-enters
 * the inter-round lobby while the inter-round lobby track is already running, and the previous
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
  for (const key of ['interRound', 'defeat'] as MusicTrack[]) {
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

/** Load the defeat lobby: the inter-round lobby tileset, empty.
 *
 *  Intentionally spawns nothing else -- no train, shop, crate, heroes, merc or
 *  ready circles. There is no way to start another round from here, which is
 *  the point: the run is over. It also does NOT snapshot or save, so a defeat
 *  cannot overwrite the inter-round lobby state a later session would load.
 *
 *  Contrast loadInterRoundLobby(), which is the victory path and rebuilds everything. */
export function loadDefeatLobby(): void {
  // The run is over: mark its save so the chooser stops offering it. Marked,
  // not deleted -- see markCurrentSaveDefeated. A session that never claimed a
  // slot (tutorial, cheat run) marks nothing.
  markCurrentSaveDefeated();
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  setMusic('defeat');
  SetTimeOfDay(12);
  spawnTerrain(generateDefeatLobby());
}

/** Beats per minute of the starting-lobby track. 0 means no song yet, so
 *  dances play the moment they are cast rather than waiting for a beat. */
const START_LOBBY_BPM = 0;

/** The lobby the map boots into, and where a defeated run restarts to.
 *
 *  Deliberately spawns no train, shop or crate: nothing here is a game in
 *  progress, and nothing written from here can reach a save. */
export function loadStartLobby(): void {
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  setMusic('interRound');
  SetTimeOfDay(12);
  spawnTerrain(generateStartLobby());
  // Everyone but the host becomes a dancer: immobile, with the dance spells on
  // the command card. 0 BPM until there is a lobby song to sync to, which makes
  // each dance fire on the keypress instead of on the beat.
  startDanceClock(START_LOBBY_BPM);
  for (const player of getHumanPlayers()) {
    if (player.id === 0) continue;
    const group = CreateGroup()!;
    GroupEnumUnitsOfPlayer(group, player.handle, undefined);
    ForGroup(group, () => {
      const u = Unit.fromHandle(GetEnumUnit());
      if (u != null && u.typeId === PEASANT_ID) makeDancer(u);
    });
    DestroyGroup(group);
  }
}

/** The save chooser. Same shell as the start lobby, with paging circles in
 *  place of the menu ones. */
export function loadChooseSaveLobby(): void {
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  setMusic('interRound');
  SetTimeOfDay(12);
  spawnTerrain(generateChooseSaveLobby());
  // Heroes stand in the middle of the floor, north of the circles.
  openChooseSaveLobby(0, TRACK_SIZE);
}

export function loadInterRoundLobby(): void {
  // No round in progress, so no challenge overlay, handicaps or night timer.
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  resetRandomOutcome();
  saveInterRoundLobbySnapshot();
  saveHeroInterRoundLobbySnapshot();
  setMusic('interRound');
  SetTimeOfDay(12);
  const spawned = spawnTerrain(generateInterRoundLobby());
  if (spawned.engine != null && spawned.wagon != null) initInterRoundLobbyTrain(spawned.engine, spawned.wagon);
  loadCrateForInterRoundLobby();
  // Heroes and mercenaries stand together in the south-east corner, so the one
  // Reroll item can target either. Reset first: spawnTerrain has just removed
  // the previous inter-round lobby's display units, and their handles must not be reused.
  resetInterRoundLobbyRoster();
  refreshInterRoundLobbyRoster();
  startDPSTest();
}
