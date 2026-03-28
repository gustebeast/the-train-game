import { Timer } from 'w3ts';
import { Players } from 'w3ts/globals';
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
import { syncGold } from './state';
import { log } from './debug';

import { loadTerrain } from './terrain/load';

const BUILD_DATE = compiletime(() => new Date().toUTCString());
const TS_VERSION = compiletime(() => require('typescript').version);
const TSTL_VERSION = compiletime(() => require('typescript-to-lua').version);

function tsMain() {
  print('TheTrainGame script started');

  try {
    // Init harvest before terrain so death triggers exist for destructable registration
    initHarvest();

    // Generate and spawn procedural terrain (includes crates, tracks, items, players)
    const trainUnit = loadTerrain(0, true); // difficulty 0 for round 1, skip cleanup on first load

    initTeams();
    initTrackBuildTrigger();
    initTrackDestroyTrigger();
    initTrain(trainUnit!);
    initItems();
    initGiveTake();
    initBridge();
    initFill();
    initWaterTrain();
    initCheat();
    initShop();

    // Lock camera distance at 1200 for all human players
    const cameraPosition = 1200;
    const humanPlayers = Players.filter(
      p => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
    );
    Timer.create().start(0.5, false, () => humanPlayers.forEach(({handle}) =>
      SetCameraFieldForPlayer(handle, CAMERA_FIELD_TARGET_DISTANCE, cameraPosition, 0)
    ));

    syncGold();
    humanPlayers.forEach((player) => {
      player.setState(PLAYER_STATE_RESOURCE_LUMBER, 0);
    });
  } catch (e) {
    log('tsMain error: ' + tostring(e));
  }
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
