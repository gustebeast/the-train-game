import { MapPlayer } from 'w3ts';
import { Players } from 'w3ts/globals';

export function initTeams() {
  const humanPlayers = Players.filter((p: MapPlayer) =>
    p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );

  const neutralPassive = MapPlayer.fromIndex(PLAYER_NEUTRAL_PASSIVE);
  const neutralExtra = MapPlayer.fromIndex(bj_PLAYER_NEUTRAL_EXTRA);
  const enemy = MapPlayer.fromIndex(PLAYER_NEUTRAL_AGGRESSIVE);

  humanPlayers.forEach((p: MapPlayer) => {
    SetPlayerTeam(p.handle, 0);
    SetPlayerController(p.handle, MAP_CONTROL_USER);
  });

  // All team members: humans + neutral passive (tracks/crates) + neutral extra (trees/rocks/water)
  const teamAllied: MapPlayer[] = [...humanPlayers];
  if (neutralPassive) teamAllied.push(neutralPassive);
  if (neutralExtra) teamAllied.push(neutralExtra);

  // Full allied vision between humans and neutral passive
  const visionGroup: MapPlayer[] = [...humanPlayers];
  if (neutralPassive) visionGroup.push(neutralPassive);

  visionGroup.forEach(p => {
    visionGroup.forEach(q => {
      if (p !== q) {
        SetPlayerAllianceStateBJ(p.handle, q.handle, bj_ALLIANCE_ALLIED_VISION);
      }
    });
  });

  // Neutral extra: allied (no vision) with all team members
  if (neutralExtra) {
    SetPlayerTeam(neutralExtra.handle, 0);
    for (const p of humanPlayers) {
      SetPlayerAllianceStateBJ(p.handle, neutralExtra.handle, bj_ALLIANCE_ALLIED);
      SetPlayerAllianceStateBJ(neutralExtra.handle, p.handle, bj_ALLIANCE_ALLIED);
    }
    if (neutralPassive) {
      SetPlayerAllianceStateBJ(neutralPassive.handle, neutralExtra.handle, bj_ALLIANCE_ALLIED);
      SetPlayerAllianceStateBJ(neutralExtra.handle, neutralPassive.handle, bj_ALLIANCE_ALLIED);
    }
  }

  if (enemy) {
    SetPlayerTeam(enemy.handle, 1);
  }

  // Player 23: train owner — no AI, allied with vision to humans and neutral passive
  const trainPlayer = MapPlayer.fromIndex(23);
  if (trainPlayer) {
    SetPlayerTeam(trainPlayer.handle, 0);
    SetPlayerController(trainPlayer.handle, MAP_CONTROL_NONE);
    for (const p of [...humanPlayers, neutralPassive, neutralExtra].filter(p => p != null) as MapPlayer[]) {
      SetPlayerAllianceStateBJ(trainPlayer.handle, p.handle, bj_ALLIANCE_ALLIED_VISION);
      SetPlayerAllianceStateBJ(p.handle, trainPlayer.handle, bj_ALLIANCE_ALLIED_VISION);
    }
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

export function getNeutralExtra(): MapPlayer {
  return MapPlayer.fromIndex(bj_PLAYER_NEUTRAL_EXTRA)!;
}

export function getNeutralAggressive(): MapPlayer {
  return MapPlayer.fromIndex(PLAYER_NEUTRAL_AGGRESSIVE)!;
}

export function getTrainPlayer(): MapPlayer {
  return MapPlayer.fromIndex(23)!;
}
