import { MapPlayer } from 'w3ts';
import { getHumanPlayers } from './util';

/** Player 22: computer-controlled hero owner for the lobby DPS check. */
const DPS_CHECK_PLAYER_INDEX = 22;
/** Player 23: owns the train (and lobby vision water). */
const TRAIN_PLAYER_INDEX = 23;

/** Set the same alliance state in both directions between two players. */
function setAllianceBoth(a: MapPlayer, b: MapPlayer, state: number): void {
  SetPlayerAllianceStateBJ(a.handle, b.handle, state);
  SetPlayerAllianceStateBJ(b.handle, a.handle, state);
}

export function initTeams() {
  const humanPlayers = getHumanPlayers();

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
      setAllianceBoth(p, neutralExtra, bj_ALLIANCE_ALLIED);
    }
    if (neutralPassive) {
      setAllianceBoth(neutralPassive, neutralExtra, bj_ALLIANCE_ALLIED);
    }
  }

  if (enemy) {
    SetPlayerTeam(enemy.handle, 1);
  }

  // DPS check player — computer-controlled, allied (no vision) with humans
  const dpsCheckPlayer = MapPlayer.fromIndex(DPS_CHECK_PLAYER_INDEX);
  if (dpsCheckPlayer) {
    SetPlayerTeam(dpsCheckPlayer.handle, 0);
    SetPlayerController(dpsCheckPlayer.handle, MAP_CONTROL_COMPUTER);
    for (const p of humanPlayers) {
      const vision = p === humanPlayers[0];
      setAllianceBoth(dpsCheckPlayer, p, vision ? bj_ALLIANCE_ALLIED_VISION : bj_ALLIANCE_ALLIED);
    }
    // DPS check heroes must be enemies with neutral aggressive
    SetPlayerAlliance(dpsCheckPlayer.handle, enemy!.handle, ALLIANCE_PASSIVE, false);
    SetPlayerAlliance(enemy!.handle, dpsCheckPlayer.handle, ALLIANCE_PASSIVE, false);
    StartMeleeAI(dpsCheckPlayer.handle, 'scripts\\common.ai');
  }

  // Train owner — no AI, allied with vision to humans and neutral passive
  const trainPlayer = MapPlayer.fromIndex(TRAIN_PLAYER_INDEX);
  if (trainPlayer) {
    SetPlayerTeam(trainPlayer.handle, 0);
    SetPlayerController(trainPlayer.handle, MAP_CONTROL_NONE);
    for (const p of [...humanPlayers, neutralPassive, neutralExtra].filter((p): p is MapPlayer => p != null)) {
      setAllianceBoth(trainPlayer, p, bj_ALLIANCE_ALLIED_VISION);
    }
  }

  // Make creeps ignore tracks (neutralPassive) and the train (trainPlayer)
  // by allying enemy → those players. They remain vulnerable to hero attacks.
  if (enemy) {
    if (neutralPassive) {
      SetPlayerAllianceStateBJ(enemy.handle, neutralPassive.handle, bj_ALLIANCE_ALLIED);
    }
    if (trainPlayer) {
      SetPlayerAllianceStateBJ(enemy.handle, trainPlayer.handle, bj_ALLIANCE_ALLIED);
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
  return MapPlayer.fromIndex(TRAIN_PLAYER_INDEX)!;
}

export function getDPSCheckPlayer(): MapPlayer {
  return MapPlayer.fromIndex(DPS_CHECK_PLAYER_INDEX)!;
}
