import { Item, Timer, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';
import { Units } from '@objectdata/units';
import { Items } from '@objectdata/items';

import './compiletime';
import { initTeams, getNeutralPassive, getNeutralExtra } from './teams';
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
import { DEFAULT_TRACK, SKINS, TRACK_SIZE } from './track/constants';
import { placedTracks, setVictoryTile } from './track/state';

import { generateTerrain } from './terrain/generate';
import { spawnTerrain } from './terrain/spawn';
import { GRID_MIN_X, GRID_MAX_X, gridToWorld } from './terrain/constants';

const BUILD_DATE = compiletime(() => new Date().toUTCString());
const TS_VERSION = compiletime(() => require('typescript').version);
const TSTL_VERSION = compiletime(() => require('typescript-to-lua').version);

function tsMain() {
  // Init harvest before terrain so death triggers exist for destructable registration
  initHarvest();

  // Generate and spawn procedural terrain
  const grid = generateTerrain(0); // difficulty 0 for round 1
  spawnTerrain(grid);
  setVictoryTile(GRID_MAX_X * TRACK_SIZE, grid.exitY * TRACK_SIZE);

  // Place storage crates south of start and exit points (neutral extra = allied, no vision)
  const extra = getNeutralExtra();
  const startCratePos = gridToWorld(GRID_MIN_X, -1);
  const endCratePos = gridToWorld(GRID_MAX_X, grid.exitY - 1);
  const startCrate = Unit.create(extra, FourCC(Units.GrainWarehouse), startCratePos.x, startCratePos.y, 270)!;
  const endCrate = Unit.create(extra, FourCC(Units.GrainWarehouse), endCratePos.x, endCratePos.y, 270)!;
  startCrate.invulnerable = true;
  endCrate.invulnerable = true;

  // Place initial EW track pieces
  const ally = getNeutralPassive();
  for (const gridX of [GRID_MIN_X, GRID_MIN_X + 1]) {
    const track = Unit.create(ally, FourCC(DEFAULT_TRACK), gridX * TRACK_SIZE, 0, 0)!;
    track.skin = FourCC(SKINS.EW);
    track.invulnerable = true;
    placedTracks.push(track);
  }

  initTeams();
  initTrackBuildTrigger();
  initTrackDestroyTrigger();
  initTrain();
  initItems();
  initGiveTake();
  initBridge();
  initFill();
  initWaterTrain();
  initCheat();

  // Spawn tools in the start area
  const axePos = gridToWorld(GRID_MIN_X + 1, -3);
  const pickPos = gridToWorld(GRID_MIN_X + 2, -3);
  const bucketPos = gridToWorld(GRID_MIN_X + 3, -3);
  Item.create(FourCC(Items.SturdyWarAxe), axePos.x, axePos.y);
  Item.create(FourCC(Items.RustyMiningPick), pickPos.x, pickPos.y);
  Item.create(FourCC(Items.EmptyVial), bucketPos.x, bucketPos.y);
  

  // Lock camera distance at 1200 for all human players
  const cameraPosition = 1200;
  const humanPlayers = Players.filter(
    p => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );
  Timer.create().start(0.5, true, () => humanPlayers.forEach(({handle}) =>
    SetCameraFieldForPlayer(handle, CAMERA_FIELD_TARGET_DISTANCE, cameraPosition, 0)
  ));

  humanPlayers.forEach((player, index) => {
    const spawnPos = gridToWorld(GRID_MIN_X + 3 + index, -2);
    Unit.create(player, FourCC(Units.Peasant), spawnPos.x, spawnPos.y, 0)!;
    player.setState(PLAYER_STATE_RESOURCE_GOLD, 0);
    player.setState(PLAYER_STATE_RESOURCE_LUMBER, 0);
    SetCameraFieldForPlayer(player.handle, CAMERA_FIELD_TARGET_DISTANCE, cameraPosition, 0);
  });
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
