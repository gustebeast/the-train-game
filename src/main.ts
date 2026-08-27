import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';

import './compiletime';
// Must be imported for its side effect: it wraps the engine's config(), which
// runs while the pre-game lobby is open, long before tsMain.
import './lobbyMusic';
import { initTeams } from './teams';
import { initTrackBuildTrigger } from './track/build';
import { initTrackDestroyTrigger } from './track/destroy';
import { initHarvest } from './harvest';
import { initItems } from './items';
import { initGiveTake } from './givetake';
import { initCheat } from './cheat';
import { initDayNight } from './daynight';
import { initBridge } from './bridge';
import { initBossRock } from './bossrock';
import { initFill } from './fill';
import { initWaterTrain } from './water';
import { initShop, initDealerOffer } from './shop';
import { initReroll } from './reroll';
import { initHeroes } from './heroes';
import { initMinimapIcons } from './minimapIcons';
import { initPlayerLeave } from './playerLeave';
import { initDash } from './dash';
import { initDance } from './dance';
import { initGlobalTick } from './globalTick';
import './challengeList'; // registers the challenge catalogue
import { initChallengeWatch } from './challengeWatch';
import { initChallengeUI } from './challengeUI';
import { initChallengeEffects } from './challengeEffects';
import { initCameraLock } from './cameraLock';
import { initCargoVisuals } from './cargoVisuals';
import { syncGold } from './state';
import { getHumanPlayers } from './util';
import { log } from './debug';

import { initTestKit } from './testkit';
import './damagetest'; // registers the 'damage' test; add further test modules here
import './burntest'; // burning train: production lock and wrecked end state
import './shoptest'; // Repair Train purchase effect
import './challengetest'; // challenge sequencing and payouts
import './fogtest'; // blackout must give the map back at dawn
import './bossbalance'; // final boss balance harness
import './dpstest'; // watch the lobby DPS sparring match
import './camptest'; // camp rotation: even levels, one lap per level
import './daynighttest'; // the clock must stay frozen, lobbies included
import './dashfieldstest'; // asks the engine about A000's button data
import './inputwatchtest'; // observes a real VNC-driven input sequence
import { loadStartLobby } from './terrain/load';
import { rollCreepCamp } from './creeps';

function tsMain() {
  try {
    // Init harvest before terrain so death triggers exist for destructable registration
    initHarvest();

    // Pick a creep camp for the first round
    rollCreepCamp();

    // Boot into the start lobby rather than straight into round 1: the host
    // chooses there whether to start a run, play the tutorial or load a save.
    // No train exists yet, so nothing here may assume one -- initTrain runs
    // when a round actually loads.
    loadStartLobby();

    initTeams();
    initTrackBuildTrigger();
    initTrackDestroyTrigger();
    initItems();
    initGiveTake();
    initBridge();
    initBossRock();
    initFill();
    initWaterTrain();
    // Before anything can show a sky: outside a round the map is permanently
    // day, and the clock only moves when daynight.ts moves it.
    initDayNight();
    initCheat();
    initShop();
    initDealerOffer();
    initReroll();
    initHeroes();
    initGlobalTick();
    initChallengeWatch();
    initChallengeUI();
    initChallengeEffects();
    initMinimapIcons();
    initCameraLock();
    initCargoVisuals();
    initPlayerLeave();
    initDash();
    initDance();
    // Last: writes the ready marker the VM test runner polls for, so it only
    // appears once every other system has initialised without throwing.
    initTestKit();

    syncGold();
    const humanPlayers = getHumanPlayers();
    humanPlayers.forEach((player) => {
      player.setState(PLAYER_STATE_RESOURCE_LUMBER, 0);
    });

  } catch (e) {
    log('tsMain error: ' + tostring(e));
  }
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
