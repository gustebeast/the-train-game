import { Timer, Unit, Trigger } from 'w3ts';
import { Players } from 'w3ts/globals';
import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';
import { Units } from '@objectdata/units';
import { Abilities } from '@objectdata/abilities';

const BUILD_DATE = compiletime(() => new Date().toUTCString());
const TS_VERSION = compiletime(() => require('typescript').version);
const TSTL_VERSION = compiletime(() => require('typescript-to-lua').version);

compiletime(({ objectData, constants }) => {
  const tracks = [
    [constants.units.ArcaneTower, 'NS'],
    [constants.units.CannonTower, 'EW'],
    [constants.units.Farm, 'NE'],
    [constants.units.GuardTower, 'SE'],
    [constants.units.ScoutTower, 'SW'],
    [constants.units.WatchTower, 'NW'],
  ]
  tracks.forEach(([unitName, direction]) => {
    const unit = objectData.units.get(unitName);
    if (unit) {
      unit.modelFile = 'war3mapImported\\' + direction + 'Track.mdx';
      unit.name = 'Railway Track';
      unit.description = 'A section of railway track.';
      unit.buildTime = 1;
      unit.hitPointsMaximumBase = 500;
      unit.scalingValueundefined = 1.0;
      unit.groundTexture = "HSMA"; // Human building ground texture
    }
  });

  const peasant = objectData.units.get(constants.units.Peasant)!;
  peasant.structuresBuilt = tracks.map(([unitName]) => unitName).join(',');

  objectData.save();
});

function initTeams() {
  const humanPlayers = [0, 1, 2, 3];
  const alliedPlayers = humanPlayers.concat(11);

  // Set up human players
  humanPlayers.forEach(i => {
    SetPlayerTeam(Players[i].handle, 0);
    SetPlayerController(Players[i].handle, MAP_CONTROL_USER);
  });

  // Set up allied computer (train)
  SetPlayerTeam(Players[11].handle, 0);
  SetPlayerController(Players[11].handle, MAP_CONTROL_COMPUTER);

  // Set up enemy computer
  SetPlayerTeam(Players[12].handle, 1);
  SetPlayerController(Players[12].handle, MAP_CONTROL_COMPUTER);

  // Set alliances and vision
  alliedPlayers.forEach(i => {
    alliedPlayers.forEach(j => {
      if (i !== j) {
        SetPlayerAllianceStateBJ(Players[i].handle, Players[j].handle, bj_ALLIANCE_ALLIED_VISION);
      }
    });
  });

  // Camera zoom
  humanPlayers.forEach(i => {
    SetCameraFieldForPlayer(Players[i].handle, CAMERA_FIELD_TARGET_DISTANCE, 2500, 0);
  });

  // Resources
  humanPlayers.forEach(i => {
    Players[i].setState(PLAYER_STATE_RESOURCE_GOLD, 500);
    Players[i].setState(PLAYER_STATE_RESOURCE_LUMBER, 500);
  });
}

function tsMain() {
  initTeams();

  // Spawn the train
  const train = Unit.create(Players[11], FourCC(Units.SiegeEngine), 0, 0, 0)!;
  train.issueOrderAt('move', 0, -1000);

  // Tech requirements
  Unit.create(Players[0], FourCC(Units.LumberMill), -400, 0, 0);
  Unit.create(Players[0], FourCC(Units.Workshop), -600, 0, 0);
  Unit.create(Players[0], FourCC(Units.WarMill), -800, 0, 0);
  Unit.create(Players[0], FourCC(Units.HuntersHall), -1000, 0, 0);
  
  const hero = Unit.create(Players[0], FourCC(Units.Peasant), -200, 0, 0)!;
  hero.addAbility(FourCC(Abilities.BuildHuman));
  Players[0].setState(PLAYER_STATE_RESOURCE_GOLD, 5000);
  Players[0].setState(PLAYER_STATE_RESOURCE_LUMBER, 5000);
  SetCameraFieldForPlayer(Players[0].handle, CAMERA_FIELD_TARGET_DISTANCE, 500, 0);
}

addScriptHook(W3TS_HOOK.MAIN_AFTER, tsMain);