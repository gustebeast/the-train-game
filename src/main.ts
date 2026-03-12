import { Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';
import { Units } from '@objectdata/units';
import { Abilities } from '@objectdata/abilities';

import './compiletime';
import { initTeams, getNeutralPassive } from './teams';
import { initTrackBuildTrigger } from './track/build';
import { initTrackDestroyTrigger } from './track/destroy';
import { initTrain } from './train';
import { DEFAULT_TRACK, SKINS, TRACK_SIZE } from './track/constants';
import { placedTracks } from './track/state';
import { log } from './debug';

const BUILD_DATE = compiletime(() => new Date().toUTCString());
const TS_VERSION = compiletime(() => require('typescript').version);
const TSTL_VERSION = compiletime(() => require('typescript-to-lua').version);

function tsMain() {
  initTeams();
  initTrackBuildTrigger();
  initTrackDestroyTrigger();

  const ally = getNeutralPassive();

  // Place two initial EW track pieces, both invulnerable
  const initTrack1 = Unit.create(ally, FourCC(DEFAULT_TRACK), 0, 0, 0)!;
  initTrack1.skin = FourCC(SKINS.EW);
  initTrack1.invulnerable = true;
  placedTracks.push(initTrack1);

  const initTrack2 = Unit.create(ally, FourCC(DEFAULT_TRACK), TRACK_SIZE, 0, 0)!;
  initTrack2.skin = FourCC(SKINS.EW);
  initTrack2.invulnerable = true;
  placedTracks.push(initTrack2);

  // Spawn the train
  const train = Unit.create(ally, FourCC(Units.WarWagon), 0, 0, 0)!;
  train.invulnerable = true;
  initTrain(train);

  const peasant = Unit.create(Players[0], FourCC(Units.Peasant), -200, 0, 0)!;
  peasant.addAbility(FourCC(Abilities.BuildHuman));
  Players[0].setState(PLAYER_STATE_RESOURCE_GOLD, 5000);
  Players[0].setState(PLAYER_STATE_RESOURCE_LUMBER, 5000);
  SetCameraFieldForPlayer(Players[0].handle, CAMERA_FIELD_TARGET_DISTANCE, 1000, 0);
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);
