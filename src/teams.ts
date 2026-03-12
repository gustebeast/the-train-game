import { MapPlayer } from 'w3ts';
import { Players } from 'w3ts/globals';

export function initTeams() {
  const humanPlayers = Players.filter((p: MapPlayer) =>
    p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );

  const ally = MapPlayer.fromIndex(PLAYER_NEUTRAL_PASSIVE);
  const enemy = MapPlayer.fromIndex(PLAYER_NEUTRAL_AGGRESSIVE);

  humanPlayers.forEach((p: MapPlayer) => {
    SetPlayerTeam(p.handle, 0);
    SetPlayerController(p.handle, MAP_CONTROL_USER);
  });

  if (ally) {
    SetPlayerTeam(ally.handle, 0);

    [...humanPlayers, ally].forEach(p => {
      [...humanPlayers, ally].forEach(q => {
        if (p !== q) {
          SetPlayerAllianceStateBJ(p.handle, q.handle, bj_ALLIANCE_ALLIED_VISION);
        }
      });
    });
  }

  if (enemy) {
    SetPlayerTeam(enemy.handle, 1);
  }

  humanPlayers.forEach((p: MapPlayer) => {
    SetCameraFieldForPlayer(p.handle, CAMERA_FIELD_TARGET_DISTANCE, 2500, 0);
    p.setState(PLAYER_STATE_RESOURCE_GOLD, 500);
    p.setState(PLAYER_STATE_RESOURCE_LUMBER, 500);
  });
}

export function getNeutralPassive(): MapPlayer {
  return MapPlayer.fromIndex(PLAYER_NEUTRAL_PASSIVE)!;
}
