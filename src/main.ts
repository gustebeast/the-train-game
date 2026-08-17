import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';

import './compiletime';
import { initTeams } from './teams';
import { initTrackBuildTrigger } from './track/build';
import { initTrackDestroyTrigger } from './track/destroy';
import { initTrain } from './train';
import { initHarvest } from './harvest';
import { initItems } from './items';
import { initGiveTake } from './givetake';
import { initCheat } from './cheat';
import { initBridge } from './bridge';
import { initFill } from './fill';
import { initWaterTrain } from './water';
import { initShop } from './shop';
import { initReroll } from './reroll';
import { initHeroes } from './heroes';
import { initMinimapIcons } from './minimapIcons';
import { initPlayerLeave } from './playerLeave';
import { initDash } from './dash';
import { initGlobalTick } from './globalTick';
import { initCameraLock } from './cameraLock';
import { initCargoVisuals } from './cargoVisuals';
import { syncGold } from './state';
import { getHumanPlayers } from './util';
import { log } from './debug';

import { initTestKit } from './testkit';
import './damagetest'; // registers the 'damage' test; add further test modules here
import { loadTerrain } from './terrain/load';
import { rollCreepCamp } from './creeps';

function tsMain() {
  print('TheTrainGame script started');

  try {
    // Init harvest before terrain so death triggers exist for destructable registration
    initHarvest();

    // Pick a creep camp for the first round
    rollCreepCamp();

    // Generate and spawn procedural terrain (includes crates, tracks, items, players)
    const spawned = loadTerrain(0, true); // difficulty 0 for round 1, skip cleanup on first load

    initTeams();
    initTrackBuildTrigger();
    initTrackDestroyTrigger();
    initTrain(spawned.engine!, spawned.wagon!);
    initItems();
    initGiveTake();
    initBridge();
    initFill();
    initWaterTrain();
    initCheat();
    initShop();
    initReroll();
    initHeroes();
    initGlobalTick();
    initMinimapIcons();
    initCameraLock();
    initCargoVisuals();
    initPlayerLeave();
    initDash();
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
