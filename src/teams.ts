import { MapPlayer } from 'w3ts';
import { getHumanPlayers } from './util';

/** Player 22: computer-controlled hero owner for the inter-round lobby DPS check. */
const DPS_CHECK_PLAYER_INDEX = 22;
/** Player 23: owns the train (and inter-round lobby vision water). */
const TRAIN_PLAYER_INDEX = 23;

/** Set the same alliance state in both directions between two players. */
function setAllianceBoth(a: MapPlayer, b: MapPlayer, state: number): void {
  SetPlayerAllianceStateBJ(a.handle, b.handle, state);
  SetPlayerAllianceStateBJ(b.handle, a.handle, state);
}

export function initTeams(): void {
  const humanPlayers = getHumanPlayers();
  const neutralPassive = getNeutralPassive();
  const neutralExtra = getNeutralExtra();
  const enemy = getNeutralAggressive();
  const dpsCheckPlayer = getDPSCheckPlayer();
  const trainPlayer = getTrainPlayer();

  humanPlayers.forEach((p: MapPlayer) => {
    SetPlayerTeam(p.handle, 0);
    SetPlayerController(p.handle, MAP_CONTROL_USER);
    // Wood is a carried item, never a player resource; gold is set from
    // gameState by syncGold.
    p.setState(PLAYER_STATE_RESOURCE_LUMBER, 0);
  });

  // Full allied vision between humans and neutral passive (the track)
  const visionGroup: MapPlayer[] = [...humanPlayers, neutralPassive];
  visionGroup.forEach(p => {
    visionGroup.forEach(q => {
      if (p !== q) {
        SetPlayerAllianceStateBJ(p.handle, q.handle, bj_ALLIANCE_ALLIED_VISION);
      }
    });
  });

  // Neutral extra (trees/rocks/water): allied, without vision, with the team
  SetPlayerTeam(neutralExtra.handle, 0);
  for (const p of humanPlayers) {
    setAllianceBoth(p, neutralExtra, bj_ALLIANCE_ALLIED);
  }
  setAllianceBoth(neutralPassive, neutralExtra, bj_ALLIANCE_ALLIED);

  SetPlayerTeam(enemy.handle, 1);

  // DPS check player -- computer-controlled, neutral with humans, and WITHOUT
  // vision, for everyone. The first human used to be given
  // vision of the sparring match as a special case, which meant one player
  // watched the match light up while the others saw nothing, and it
  // was not a choice anybody made. -viewdps hands it to whoever asks instead.
  // A team of its own, as well as no alliance: sharing the humans' team is
  // the other way the game counts a player as on their side.
  SetPlayerTeam(dpsCheckPlayer.handle, 2);
  SetPlayerController(dpsCheckPlayer.handle, MAP_CONTROL_COMPUTER);
  // Neutral -- passive both ways -- rather than allied: an ally's hero dying
  // is announced to every player ("Your ally's hero has fallen"), and the DPS
  // check's heroes die all round long, out of sight beyond the wall.
  for (const p of humanPlayers) {
    setAllianceBoth(dpsCheckPlayer, p, bj_ALLIANCE_NEUTRAL);
  }
  // DPS check heroes must be enemies with neutral aggressive
  SetPlayerAlliance(dpsCheckPlayer.handle, enemy.handle, ALLIANCE_PASSIVE, false);
  SetPlayerAlliance(enemy.handle, dpsCheckPlayer.handle, ALLIANCE_PASSIVE, false);
  StartMeleeAI(dpsCheckPlayer.handle, 'scripts\\common.ai');

  // Train owner -- no AI, allied with vision to humans and the neutrals
  SetPlayerTeam(trainPlayer.handle, 0);
  SetPlayerController(trainPlayer.handle, MAP_CONTROL_NONE);
  for (const p of [...humanPlayers, neutralPassive, neutralExtra]) {
    setAllianceBoth(trainPlayer, p, bj_ALLIANCE_ALLIED_VISION);
  }

  // Make creeps ignore tracks (neutralPassive) and the train (trainPlayer)
  // by allying enemy -> those players. They remain vulnerable to hero attacks.
  SetPlayerAllianceStateBJ(enemy.handle, neutralPassive.handle, bj_ALLIANCE_ALLIED);
  SetPlayerAllianceStateBJ(enemy.handle, trainPlayer.handle, bj_ALLIANCE_ALLIED);

  // No kill bounty from anyone. Gold here is gameState.gold, copied onto native
  // gold by syncGold, and earned from rounds and challenges -- never from kills.
  // A bounty only raised native gold, so every creep killed in a round showed
  // as phantom gold (6 for a kobold, measured) that the shop then refused to
  // honour, until the next sync quietly took it back. All players rather than
  // just the creeps: critters, the boss and its infernals are owned elsewhere.
  for (let i = 0; i < bj_MAX_PLAYER_SLOTS; i++) {
    SetPlayerState(Player(i)!, PLAYER_STATE_GIVES_BOUNTY, 0);
  }
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

/** Who has asked to watch the sparring match, by player id. */
const dpsVision: boolean[] = [];

/** Show or hide the sparring match for one player. Returns the new state.
 *
 *  One-way on purpose: the check player shares its vision with the watcher,
 *  and nothing is shared back. Per player, so one person looking does not put
 *  the match on everybody's screen. */
export function toggleDPSVision(who: player): boolean {
  const id = GetPlayerId(who);
  const on = !(dpsVision[id] ?? false);
  dpsVision[id] = on;
  SetPlayerAlliance(getDPSCheckPlayer().handle, who, ALLIANCE_SHARED_VISION, on);
  return on;
}

export function getDPSCheckPlayer(): MapPlayer {
  return MapPlayer.fromIndex(DPS_CHECK_PLAYER_INDEX)!;
}
