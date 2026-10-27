import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';

import './compiletime';
// Must be imported for its side effect: it hooks the engine's config(), which
// runs while the pre-game lobby is open, long before tsMain.
import './music';
import { initTeams } from './teams';
import { initTrackBuildTrigger } from './track/build';
import { initTrackDestroyTrigger } from './track/destroy';
import { initHarvest } from './harvest';
import { initItems } from './items';
import { initGiveTake } from './giveTake';
import { initCheat } from './cheat';
import { initDayNight } from './dayNight';
import { initBridge } from './bridge';
import { initBossKey } from './bossKey';
import { initFill } from './fill';
import { initWaterTrain } from './water';
import { initShop, initDealerOffer } from './shop';
import { initReroll } from './reroll';
import { initVacuum } from './vacuum';
import { initSalesperson, initSalespersonBuyback } from './salesperson';
import { initAbilityItems } from './abilityItems';
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
import { log } from './debug';
import { DEV_TOOLS } from './buildFlags';

import { initSaveSync } from './saveSync';
import { initSelection } from './selection';
import { initTestKit } from './tests/testKit';
import './tests'; // registers every test module (tests/index.ts)
import { initBoardFlow, loadStartLobby } from './terrain/load';
import { rollCreepCamp } from './creeps';
import { initDPSCheck } from './dpsCheck';

function tsMain() {
  try {
    // Init harvest before terrain so death triggers exist for destructable registration
    initHarvest();

    // Pick a creep camp for the first round
    rollCreepCamp();

    // Before anything can show a sky: outside a round the map is permanently
    // day, and the clock only moves when dayNight.ts moves it.
    initDayNight();

    // Boot into the start lobby rather than straight into round 1: the host
    // chooses there whether to start a run, play the tutorial or load a save.
    // No train exists yet, so nothing here may assume one -- setupRoundTrain runs
    // when a round actually loads.
    initBoardFlow();
    loadStartLobby();

    initTeams();
    initDPSCheck();
    initTrackBuildTrigger();
    initTrackDestroyTrigger();
    // Before anything that reads who has what selected (dance, the dealer).
    initSelection();
    initItems();
    initGiveTake();
    initBridge();
    initBossKey();
    initFill();
    initWaterTrain();
    if (DEV_TOOLS) initCheat();
    initShop();
    initDealerOffer();
    initReroll();
    initVacuum();
    initSalesperson();
    initSalespersonBuyback();
    initAbilityItems();
    initHeroes();
    initGlobalTick();
    initChallengeWatch();
    initChallengeUI();
    initChallengeEffects();
    initMinimapIcons();
    initCameraLock();
    initCargoVisuals();
    initPlayerLeave();
    initSaveSync();
    initDash();
    initDance();
    // Last: writes the ready marker the VM test runner polls for, so it only
    // appears once every other system has initialised without throwing.
    if (DEV_TOOLS) initTestKit();

    syncGold();

  } catch (e) {
    log('tsMain error: ' + tostring(e));
  }
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
