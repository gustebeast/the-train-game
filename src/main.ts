import { Item, Unit } from 'w3ts';
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
import { DEFAULT_TRACK, SKINS, TRACK_SIZE } from './track/constants';
import { placedTracks } from './track/state';
import { log } from './debug';
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
  for (const gridX of [-26, -25]) {
    const track = Unit.create(ally, FourCC(DEFAULT_TRACK), gridX * TRACK_SIZE, 0, 0)!;
    track.skin = FourCC(SKINS.EW);
    track.invulnerable = true;
    placedTracks.push(track);
  }

  initTeams();
  initTrackBuildTrigger();
  initTrackDestroyTrigger();
  initTrain();

  // Spawn tools in the start area
  const axePos = gridToWorld(-25, -3);
  const pickPos = gridToWorld(-24, -3);
  Item.create(FourCC(Items.SturdyWarAxe), axePos.x, axePos.y);
  Item.create(FourCC(Items.RustyMiningPick), pickPos.x, pickPos.y);

  const peasant = Unit.create(Players[0], FourCC(Units.Peasant), (0 / 4 - 23) * TRACK_SIZE, -2 * TRACK_SIZE, 0)!;
  peasant.acquireRange = 0;
  Players[0].setState(PLAYER_STATE_RESOURCE_GOLD, 5000);
  Players[0].setState(PLAYER_STATE_RESOURCE_LUMBER, 5000);
  SetCameraFieldForPlayer(Players[0].handle, CAMERA_FIELD_TARGET_DISTANCE, 1000, 0);
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
