import { Grid, LOBBY_BACK_CENTRE, biomeForCampLevel, gridToWorld } from './constants';
import { MusicTrack, setMusic } from '../music';
import { generateTerrain, generateCheatTerrain, generateInterRoundLobby, generateBossBattlefield, generateDefeatLobby, generateVictoryLobby, generateStartLobby, generateChooseSaveLobby, generateTutorial } from './generate';
import { spawnTerrain, spawnReadyCircle, addBoardEffect, SpawnedTrain } from './spawn';
import { setupRoundTrain, setupInterRoundLobbyTrain, setVictoryCallback, setAwardVictoryCallback, setDefeatCallback } from '../train';
import { registerReadyZone } from '../ready';
import { TROPHY_MODEL, TROPHY_SCALE } from '../constants';
import { markUnit } from '../unitLabels';
import { forEachPeasantOf, getHumanPlayers } from '../util';
import { makeDancer, startDanceSession } from '../dance';
import {
  closeChooseSaveLobby, getSelectedSlot, openChooseSaveLobby,
  selectNewerSave, selectOlderSave,
  getOfferedSaveCount, isSelectedSaveVictorious,
} from '../chooseSaveLobby';
import { awardVictory } from '../victory';
import { resetBossKey } from '../bossKey';
import { isBossVictory, placedTracks } from '../track/state';
import { getNeutralExtra } from '../teams';
import { setBossArenaCallbacks, startBossFight } from '../bossArena';
import { getCampData, getSparringSecondsToMinimum, startSparringMatch } from '../creeps';
import { gameState } from '../state';
import { loadFromSlot, listSaves, markCurrentSaveDefeated, markCurrentSaveVictorious, resetToNewRun, revertToInterRoundLobbySnapshot, saveInterRoundLobbySnapshot } from '../save';
import {
  hasHeroes, rollRandomRoster, chooseHeroes, getInterRoundLobbyHeroUnits,
  saveHeroInterRoundLobbySnapshot,
} from '../heroes';
import { loadCrateForRound, loadCrateForInterRoundLobby } from '../items';
import { resetChallengeProgress } from '../challengeList';
import { hideChallengeUI, hidePanel, showPanel } from '../challengeUI';
import { startTutorialBoard, stopTutorialBoard, getTutorialBoardLines } from '../tutorialBoard';
import { applyChallengeEffects, clearChallengeEffects } from '../challengeEffects';
import {
  DAY_TIME, startDayNightForRound, stopDayNight,
} from '../daynight';
import { refreshInterRoundLobbyRoster, resetInterRoundLobbyRoster } from '../interRoundLobbyRoster';
import { saveMercInterRoundLobbySnapshot, getInterRoundLobbyMercUnits } from '../mercenary';
import { deriveSeed, STREAMS } from '../rng';
import { advanceChallengeOffer } from '../challenges';

/** True while the tutorial is being played.
 *
 *  The tutorial must leave no trace: it never claims a save slot, never calls
 *  awardVictory (which is what writes one), and both of its endings go back to
 *  the start lobby rather than into the inter-round or defeat lobby. Every
 *  other way into gameplay either loads a save or starts a run that will claim
 *  its own slot, so nothing here can reach one. */
let inTutorial = false;

/** Leave the tutorial: back to the start lobby, with the session wiped so
 *  nothing the tutorial did can follow the player into a real run. */
function endTutorial(): void {
  inTutorial = false;
  stopTutorialBoard();
  hidePanel();
  resetToNewRun();
  loadStartLobby();
}

/** Begin a fresh run: wipe the session, then pick the four heroes it will be
 *  played with.
 *
 *  The roster used to be picked lazily by loadGameplay -- "if nobody has been
 *  chosen yet, choose now" -- which made having a roster a side effect of
 *  loading a round rather than a property of the run. Anything that reached the
 *  lobby without loading a round first (the -lobby cheat, a test) found nobody
 *  chosen and quietly measured that instead. A run has a roster from the moment
 *  it starts. */
export function beginNewRun(): void {
  resetToNewRun();
  rollRandomRoster();
}

/** Into the inter-round lobby as if a round had just been won, for -lobby:
 *  the dealer moves on to his next offer, which awardVictory does for a real
 *  win. NOT inside loadInterRoundLobby: Reset Purchases goes back through there
 *  too, and rewinding a purchase must leave the same wager on sale rather than
 *  letting a player shop for a different one. */
export function finishRoundToLobby(): void {
  advanceChallengeOffer();
  loadInterRoundLobby();
}

/** Adopt a run that came off disk. A save carries its roster once one has
 *  been rolled, so this only covers a run saved before that. */
export function ensureRosterForLoadedRun(): void {
  if (!hasHeroes()) rollRandomRoster();
}

/** Wire up how boards lead to one another: the round's endings, the boss
 *  fight's, and every ready circle's destination. Called once from main, before
 *  the first board is loaded -- a circle whose zone is not registered yet is a
 *  dead circle. */
export function initBoardFlow(): void {
  setVictoryCallback(() => {
    // Reaching the target track finishes the tutorial rather than opening the
    // inter-round lobby: there is no run to continue.
    if (inTutorial) { endTutorial(); return; }
    // The line ran to the boss exit rather than the usual one, so the train
    // pulls into the arena instead of the lobby. The round itself was already
    // won and paid out on arrival -- this is what the round bought.
    if (isBossVictory()) {
      loadBossBattlefield();
      startBossFight();
      return;
    }
    // awardVictory has already moved the dealer on and written the save.
    loadInterRoundLobby();
  });

  // How the boss fight ends. Losing costs the attempt, not the run: it lands
  // exactly where an ordinary victory would, because the round was already won.
  // Winning goes quiet and leaves one unmarked circle in the middle of the
  // arena. Everyone who survived the fight has to stand on it -- every hero and
  // mercenary still alive, not one unit per player -- and that is what takes the
  // party to the victory lobby.
  setBossArenaCallbacks(
    () => loadInterRoundLobby(),
    survivors => {
      // On disk the moment the boss falls, not when the party walks out: the
      // run is won whether or not anyone ever reaches the circle.
      markCurrentSaveVictorious();
      // Nobody but summons left standing: there is nobody to walk out.
      if (survivors.length === 0) {
        loadVictoryLobby();
        return;
      }
      setMusic('silence');
      spawnReadyCircle(0, 0, { label: '', zone: 'bossexit' }, survivors);
    },
  );
  registerReadyZone('bossexit', '', () => loadVictoryLobby());
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
  // The countdown waits out the sparring match's minimum: starting the round
  // ends the match, and one cut short measures the opening seconds -- ranged
  // heroes and summons hitting creeps still walking in -- which reads the party
  // as several times stronger than it is and scales the next camp to match.
  registerReadyZone('start', 'Starting next round', () => loadTerrain(gameState.round),
    undefined, getSparringSecondsToMinimum);
  registerReadyZone('newgame', 'Starting a new game', () => {
    beginNewRun();
    loadTerrain(0);
  });
  registerReadyZone('tutorial', 'Starting the tutorial', () => {
    beginNewRun();
    inTutorial = true;
    loadGameplay(generateTutorial());
    // After the load: loadGameplay hides the overlay on its way through, so the
    // board has to be put up once the round is standing.
    startTutorialBoard();
    showPanel('Tutorial', getTutorialBoardLines);
  });
  registerReadyZone('loadsave', 'Opening saved games', () => loadChooseSaveLobby(),
    () => (listSaves().length === 0 ? 'There are no saved games to load.' : null));
  registerReadyZone('saveback', 'Going back', () => {
    closeChooseSaveLobby();
    loadStartLobby();
  });
  // Paging does NOT reload the lobby: only the displayed heroes and the label
  // change, so the circles the player is standing among stay put.
  const nothingToPage = (): string | null => {
    const count = getOfferedSaveCount();
    if (count === 0) return 'There are no saved games.';
    return count === 1 ? 'This is the only saved game.' : null;
  };
  registerReadyZone('saveprev', 'Showing the newer save', () => selectNewerSave(), nothingToPage);
  registerReadyZone('savenext', 'Showing the older save', () => selectOlderSave(), nothingToPage);
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
    ensureRosterForLoadedRun();
    // Into the LOBBY, not into a round. A save is written on the way into the
    // inter-round lobby, so resuming there puts you exactly where the save was
    // taken -- shop, roster and all. Dropping straight into gameplay skipped the
    // half of the round the save was standing in.
    loadInterRoundLobby();
  }, () => (isSelectedSaveVictorious() ? 'This save is already victorious and cannot be loaded' : null));
  registerReadyZone('restart', 'Returning to the start lobby', () => {
    // The run is already marked finished -- defeated by loadDefeatLobby, or
    // victorious when the boss fell -- so this only has to put the session back
    // to how it boots.
    beginNewRun();
    loadStartLobby();
  });
  registerReadyZone('revert', 'Resetting purchases', resetPurchases);
}

/** Stand up a board that is NOT a round in progress: the five lobbies and the
 *  boss arena.
 *
 *  All six wanted the same six things in the same order -- no challenge
 *  overlay, no handicaps, no night timer, the board's own music, noon, then the
 *  terrain. Six copies is six chances for one of them to keep a handicap or
 *  come up in the dark, and coming up in the dark is exactly what the lobbies
 *  did until the clock was frozen at init. */
function enterBoard(track: MusicTrack | null, grid: Grid): SpawnedTrain {
  hideChallengeUI();
  clearChallengeEffects();
  stopDayNight();
  setMusic(track);
  SetTimeOfDay(DAY_TIME);
  return spawnTerrain(grid);
}

/** Shared gameplay load: reset hero state, spawn grid, init train. */
function loadGameplay(grid: Grid): SpawnedTrain {
  setMusic(null);
  // The Strange Key is a round's prize, not a run's: it is earned and spent
  // inside one round, so a round starts without one. Here rather than in
  // loadTerrain because EVERY way of setting a round up has to clear it --
  // -cheatmode replaces the map mid-round, and leaving the flag set meant the
  // cheat map's camp could never drop a key.
  resetBossKey();
  // Settle the roster for this round. Derived rather than loaded, so continuing
  // a run fields whoever the XP rule says instead of whatever pair a save
  // happened to record. Deriving it here, and not only at victory, is what
  // covers a run that was loaded rather than played into this round.
  chooseHeroes();
  applyChallengeEffects();
  startDayNightForRound();
  const spawned = spawnTerrain(grid);
  // Counters are per round, so a challenge bought now starts from zero rather
  // than inheriting whatever last round left behind. After the spawn, not
  // before: the track challenges measure the line, so they need this round's
  // starting track already down to know where the players' own work begins.
  resetChallengeProgress();
  if (spawned.engine != null && spawned.wagon != null) {
    setupRoundTrain(spawned.engine, spawned.wagon);
    loadCrateForRound();
  }
  return spawned;
}

/** The round, counted from 1, at which the map reaches full difficulty. */
const MAX_DIFFICULTY_ROUND = 25;

/** How hard a round's MAP is, 0 to 100: granite, water and spare resources all
 *  scale off this (generate.ts). Even steps from 0 on the first round to 100 on
 *  round 25, then held there. It used to be the raw round number, so full
 *  difficulty took 100 rounds, and nothing stopped it running past 100 --
 *  where the formulas extrapolate into fewer resources than a map needs.
 *
 *  `round` is gameState.round, which is 0 for the first round played. */
export function difficultyForRound(round: number): number {
  const d = round * 100 / (MAX_DIFFICULTY_ROUND - 1);
  return d > 100 ? 100 : d;
}

/** Lay out and enter round `round`'s map (gameState.round: 0 is the first). */
export function loadTerrain(round: number): SpawnedTrain {
  // Map generation is hundreds of draws deep (corridors, blobs, tree and rock
  // scatter, camp placement), so rather than thread a seeded RNG through all of
  // generate.ts, point WC3's own generator at a reproducible starting point
  // first. Same save and same round therefore lay out the same map, which is
  // what stops a player rerolling the terrain by reloading.
  //
  // Keyed on the ROUND as well as the seed, so consecutive rounds differ. Not
  // on the difficulty: that stops rising at round 25, and every round after it
  // would otherwise lay out the very same map.
  SetRandomSeed(deriveSeed(STREAMS.terrain) + round);
  // A level 3 camp is the only one that can drop the key, so it is also the
  // only round that gets a second exit -- the two arrive together or not at all.
  const camp = getCampData();
  const bossRound = camp != null && camp.level >= 3;
  const biome = biomeForCampLevel(camp != null ? camp.level : null);
  return loadGameplay(generateTerrain(difficultyForRound(round), bossRound, biome));
}

/** -cheatmode swaps the round in progress for the cheat map. It does not come
 *  through a start lobby, so it answers for the roster itself. */
export function loadCheatTerrain(): void {
  ensureRosterForLoadedRun();
  loadGameplay(generateCheatTerrain());
}

/** The run is over and won: the defeat lobby's floor, with the whole party
 *  standing on it -- peasants, and the heroes and mercenaries in the
 *  inter-round lobby's roster column -- every one of them under a trophy.
 *  The save was already marked victorious when the boss fell. */
function loadVictoryLobby(): void {
  // Snapshot first, as the inter-round lobby does: the roster hides anyone who
  // differs from the last snapshot behind a "?", and a hero rolled in the last
  // lobby has been met since -- in the boss fight -- so nobody here is a secret.
  snapshotLobbyRoster();
  enterBoard('victory', generateVictoryLobby());
  resetInterRoundLobbyRoster();
  refreshInterRoundLobbyRoster();
  const winners: unit[] = [];
  for (const h of getInterRoundLobbyHeroUnits()) winners.push(h.handle);
  for (const m of getInterRoundLobbyMercUnits()) winners.push(m.handle);
  for (const p of getHumanPlayers()) {
    forEachPeasantOf(p.handle, u => winners.push(u.handle));
  }
  for (const u of winners) markUnit(u, TROPHY_MODEL, 'overhead', TROPHY_SCALE);
  // And the trophy itself, life-size in the middle of the back row -- the
  // square the inter-round lobby gives to the shop.
  const top = gridToWorld(LOBBY_BACK_CENTRE);
  addBoardEffect(TROPHY_MODEL, top.x, top.y, 1.6);
}

/** Load the defeat lobby: the inter-round lobby tileset, empty but for the
 *  circle back to the start lobby.
 *
 *  No train, shop, crate, heroes or mercenaries, and no way to start another
 *  round: the run is over. It does NOT snapshot or save, so a defeat cannot
 *  overwrite the inter-round lobby state a later session would load. */
function loadDefeatLobby(): void {
  // The run is over: mark its save so the chooser stops offering it. Marked,
  // not deleted -- see markCurrentSaveDefeated. A session that never claimed a
  // slot (tutorial, cheat run) marks nothing.
  markCurrentSaveDefeated();
  enterBoard('defeat', generateDefeatLobby());
}

/** Beats per minute the dance clock counts at in the start lobby. The track
 *  itself runs at 130, but 0 here means the dances play the moment they are
 *  cast rather than waiting for a beat. Set it to 130 to sync them to the
 *  song; that is a gameplay decision, not a consequence of adding the song. */
const START_LOBBY_BPM = 0;

/** The lobby the map boots into, and where a defeated run restarts to.
 *
 *  Deliberately spawns no train, shop or crate: nothing here is a game in
 *  progress, and nothing written from here can reach a save. */
export function loadStartLobby(): void {
  enterBoard('startLobby', generateStartLobby());
  // Everyone but the host becomes a dancer: immobile, with the dance spells on
  // the command card.
  startDanceSession(START_LOBBY_BPM);
  for (const player of getHumanPlayers()) {
    if (player.id === 0) continue;
    forEachPeasantOf(player.handle, makeDancer);
  }
}

/** The save chooser. Same shell as the start lobby, with paging circles in
 *  place of the menu ones. */
function loadChooseSaveLobby(): void {
  enterBoard('startLobby', generateChooseSaveLobby());
  // The party stands at the back, clear of the dancers: the guests now line up
  // one tile north of centre, which is where this row used to be.
  const back = gridToWorld(LOBBY_BACK_CENTRE);
  openChooseSaveLobby(back.x, back.y);
}

/** Load the boss battlefield: the arena floor and its lava surround, and
 *  nothing else. No train, no shop, no ready circles -- the boss and whoever
 *  fights it are placed on top of this (bossArena.ts). */
export function loadBossBattlefield(): void {
  enterBoard('boss', generateBossBattlefield());
}

/** Hand the inter-round lobby's scenery to the neutral player that shares NO
 *  vision.
 *
 *  spawnTerrain owns the train, its wagon and the starting track by neutral
 *  passive, because in a ROUND those are things you must be able to see -- the
 *  train is the thing you are protecting and the line is where you are going.
 *  In the lobby they are furniture: the train never moves, and the two track
 *  tiles under it go nowhere. Left on neutral passive they each threw 400 units
 *  of sight across the floor, which is vision the players did nothing to earn.
 *
 *  Only the lobby is re-owned; the round's copies are untouched. What keeps the
 *  lobby lit is deliberate and elsewhere: the inner ring of WATER_VISIBLE tiles
 *  (train player, sight deliberately shrunk) plus the players' own peasants.
 */
function giveLobbyPropsNoVision(spawned: SpawnedTrain): void {
  const blind = getNeutralExtra();
  if (spawned.engine != null) spawned.engine.owner = blind;
  if (spawned.wagon != null) spawned.wagon.owner = blind;
  for (const t of placedTracks) t.owner = blind;
}

/** Remember who was standing in the roster column as this lobby began, so
 *  anyone rolled since shows as a "?" (heroConcealed, mercConcealed). */
function snapshotLobbyRoster(): void {
  saveHeroInterRoundLobbySnapshot();
  saveMercInterRoundLobbySnapshot();
}

/** Reset Purchases: back to the state this inter-round lobby visit began
 *  with -- gold, upgrades, and the roster with any rerolls undone -- and into
 *  the lobby again. */
export function resetPurchases(): void {
  revertToInterRoundLobbySnapshot();
  loadInterRoundLobby();
}

export function loadInterRoundLobby(): void {
  // Snapshot before the board changes: this is the state Reset Purchases
  // reverts to, and it must be what the player walked in with.
  saveInterRoundLobbySnapshot();
  snapshotLobbyRoster();
  const spawned = enterBoard('interRound', generateInterRoundLobby());
  if (spawned.engine != null && spawned.wagon != null) setupInterRoundLobbyTrain(spawned.engine, spawned.wagon);
  giveLobbyPropsNoVision(spawned);
  loadCrateForInterRoundLobby();
  // Heroes and mercenaries stand in one column down the east edge, so the one
  // Reroll item can target either. Reset first: spawnTerrain has just removed
  // the previous inter-round lobby's display units, and their handles must not be reused.
  resetInterRoundLobbyRoster();
  refreshInterRoundLobbyRoster();
  startSparringMatch();
}
