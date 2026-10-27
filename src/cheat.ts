import { Destructable, Item, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import {
  loadCheatTerrain, loadInterRoundLobby, loadBossBattlefield,
  ensureRosterForLoadedRun, finishRoundToLobby,
} from './terrain/load';
import { TRACK_PIECE_ID, WOOD_ID, STONE_ID, PEASANT_ID, WATER_ID, TRAIN_ID } from './constants';
import { GRID_MIN_X, gridToWorld } from './terrain/constants';
import { ROCK_RAW, TREE_WALLS } from './sharedData';
import { isInGameplay } from './state';
import { loadFromFile } from './save';
import { stopGameplay, triggerDefeat } from './train';
import { applyChallengeEffects, toggleShoulderCam } from './challengeEffects';
import {
  getChallengeDefs, armChallenge, clearChallenges,
} from './challenges';
import { applyTrackShapes } from './challengeList';
import { beginNight, endNight, isNight } from './dayNight';
import { getNeutralExtra, getNeutralPassive, toggleDPSVision } from './teams';
import { getDPSCheckReport } from './dpsCheck';
import { makeDancer } from './dance';
import { checkUnionRules } from './challengeWatch';
import { spawnBoss } from './boss';
import { firstPeasantOf, getHumanPlayers, onChatCommand, onChatCommandWithArg } from './util';

const CAMERA_SYNC_PREFIX = 'ttgCamCmd';
/** Commands that act where the typer's camera is looking, by command. */
const cameraCommands = new Map<string, (this: void, x: number, y: number) => void>();

/** Run `action` at the point the typing player's camera is looking at.
 *
 *  The camera is the one thing a chat handler cannot read directly: it is
 *  local to each machine, so every player would act at a different spot -- a
 *  desync. So the typer's machine sends its point (BlzSendSyncData), and every
 *  machine acts when the point arrives. */
function onChatCommandAtCamera(command: string, action: (this: void, x: number, y: number) => void): void {
  cameraCommands.set(command, action);
  onChatCommand(command, () => {
    // local: only the typer's machine reads its camera, and sends it.
    if (GetLocalPlayer() !== GetTriggerPlayer()) return;
    BlzSendSyncData(CAMERA_SYNC_PREFIX, command + ' ' + tostring(GetCameraTargetPositionX())
      + ' ' + tostring(GetCameraTargetPositionY()));
  });
}

function initCameraCommands(): void {
  const t = Trigger.create();
  for (const p of getHumanPlayers()) {
    BlzTriggerRegisterPlayerSyncEvent(t.handle, p.handle, CAMERA_SYNC_PREFIX, false);
  }
  t.addAction(() => {
    const parts = (BlzGetTriggerSyncData() ?? '').split(' ');
    const action = cameraCommands.get(parts[0]);
    const x = tonumber(parts[1]);
    const y = tonumber(parts[2]);
    if (action != null && x != null && y != null) action(x, y);
  });
}

export function initCheat(): void {
  initCameraCommands();
  onChatCommand('-cheatmode', () => {
    // Replaces the map you are playing with the cheat map. It is not a way IN
    // to gameplay: from a lobby there is no round to replace, and loading one
    // here would skip everything starting a round properly does.
    if (!isInGameplay()) {
      print('-cheatmode only works during a round.');
      return;
    }
    loadCheatTerrain();
    const trackPos = gridToWorld({ x: GRID_MIN_X + 4, y: -3 });
    const tracks = Item.create(TRACK_PIECE_ID, trackPos.x, trackPos.y)!;
    tracks.charges = 99;
    const woodPos = gridToWorld({ x: GRID_MIN_X + 5, y: -3 });
    const wood = Item.create(WOOD_ID, woodPos.x, woodPos.y)!;
    wood.charges = 99;
    const stonePos = gridToWorld({ x: GRID_MIN_X + 6, y: -3 });
    const stone = Item.create(STONE_ID, stonePos.x, stonePos.y)!;
    stone.charges = 99;
  });

  // Dash obstacle arena: clears a patch around the camera and drops one of each
  // collision hazard around a fresh peasant so you can dash (E) into each and
  // confirm the dash does not clip through them. rock=E, tree=N, water=W,
  // train=S.
  onChatCommandAtCamera('-dashtest', (ax, ay) => {
    const r = Rect(ax - 700, ay - 700, ax + 700, ay + 700);
    EnumDestructablesInRect(r, undefined, () => RemoveDestructable(GetEnumDestructable()!));
    RemoveRect(r);
    const d = 340;
    Destructable.create(FourCC(ROCK_RAW), ax + d, ay, 0, 1.4, 0);
    Destructable.create(FourCC(TREE_WALLS.summer), ax, ay + d, 0, 1.0, 0);
    // Owned the way the board's own water is (spawn.ts).
    const water = Unit.create(getNeutralExtra(), WATER_ID, ax - d, ay, 0);
    if (water != null) water.invulnerable = true;
    const train = Unit.create(getNeutralPassive(), TRAIN_ID, ax, ay - d, 0);
    if (train != null) train.invulnerable = true;
    Unit.create(Players[0], PEASANT_ID, ax, ay, 90);
    print('Dash arena: rock=E, tree=N, water=W, train=S. Cast Dash (E) into each.');
  });

  // Make your first peasant dash east on command — handy for eyeballing the
  // dash and for checking a queued follow-up order still runs.
  onChatCommand('-dashnow', () => {
    const p = firstPeasantOf(Players[0].handle);
    if (p == null) { print('dashnow: no peasant'); return; }
    PanCameraToTimedForPlayer(Players[0].handle, p.x, p.y, 0);
    SetCameraFieldForPlayer(Players[0].handle, CAMERA_FIELD_TARGET_DISTANCE, 1100, 0);
    p.issueOrderAt('flare', p.x + 400, p.y);
    print('dashnow: dashing east');
  });

  // Try the Over the Shoulder view without buying the challenge. Toggles, so
  // the same command gets you back out.
  onChatCommand('-thirdperson', () => {
    const on = toggleShoulderCam();
    print(on
      ? 'Third-person camera ON — locked behind your peasant. -thirdperson again to exit.'
      : 'Third-person camera OFF.');
  });

  // Step through the challenge catalogue, arming each in turn, so the overlay
  // can be looked at in every state it can be in without buying ten wagers and
  // playing ten rounds. Each press also stamps a part-finished track count, so
  // the progress row shows a real "7 / 15" rather than sitting at zero.
  let uiIndex = -1;
  onChatCommand('-uichallenge', () => {
    const all = getChallengeDefs();
    if (all.length === 0) { print('uichallenge: nothing registered'); return; }
    uiIndex = (uiIndex + 1) % all.length;
    const def = all[uiIndex];
    clearChallenges();
    armChallenge(def.id);
    applyTrackShapes({ straightRun: 7, curved: 3 });
    print('uichallenge ' + I2S(uiIndex + 1) + '/' + I2S(all.length) + ': ' + def.name);
  });

  // Arm a challenge by number, for playing one deliberately rather than
  // waiting for the dealer to offer it. Bare "-challenge" lists them, since
  // the number is only useful next to the name it belongs to.
  //
  // Applies the handicaps too, so arming Over the Shoulder or From Memory
  // mid-round does what buying it would have done at the round's start --
  // otherwise the challenge would be armed but invisible until the next round.
  onChatCommandWithArg('-challenge', arg => {
    const all = getChallengeDefs();
    const n = S2I(arg);
    if (n < 1 || n > all.length) {
      print('|cffffcc00Challenges|r (use -challenge <number>):');
      for (let i = 0; i < all.length; i++) {
        print('  ' + I2S(i + 1) + '. ' + all[i].name);
      }
      return;
    }
    const def = all[n - 1];
    clearChallenges();
    armChallenge(def.id);
    applyChallengeEffects();
    // Armed mid-round, tools may already be in hand; Union Rules otherwise only
    // looks when someone picks one up. (Living Dangerously hears the arming.)
    checkUnionRules();
    print('Armed ' + I2S(n) + '. |cffffcc00' + def.name + '|r: ' + def.description);
  });

  // Disarm, which is what Reset Purchases does. Pairs with -uichallenge to
  // walk the buy -> reset -> buy again cycle that a real inter-round lobby visit produces,
  // since that is the path where the overlay used to come back wrong.
  onChatCommand('-uiclear', () => {
    clearChallenges();
    print('uiclear: nothing armed');
  });

  // Spawn a dancer wherever the camera is looking, so the start-lobby dance
  // spells can be tried without needing three other players in the game.
  onChatCommandAtCamera('-dance', (x, y) => {
    const dancer = Unit.create(Players[0], PEASANT_ID, x, y, 270);
    if (dancer == null) { print('dance: could not spawn a peasant'); return; }
    makeDancer(dancer);
    SelectUnitForPlayerSingle(dancer.handle, Players[0].handle);
    print('Dancer spawned. Q W E R Y U I O V B are the dances.');
  });

  // Bring on night without waiting out the random 1-10 minute timer. Toggles,
  // so the same command puts the day back -- and going back through endNight
  // means the Blackout challenge's fog restore runs too, rather than the map
  // simply brightening.
  onChatCommand('-night', () => {
    if (isNight()) {
      endNight();
      print('Day.');
      return;
    }
    beginNight();
  });

  // Drop the final boss wherever the camera is looking, for balance work.
  onChatCommandAtCamera('-boss', (x, y) => {
    const boss = spawnBoss(x, y);
    if (boss == null) { print('boss: could not spawn'); return; }
    print('Boss spawned: ' + I2S(R2I(boss.maxLife))! + ' HP, ' + I2S(R2I(boss.maxMana))! + ' mana.');
  });

  // Watch the inter-round lobby's DPS sparring match, which is otherwise
  // fought out of sight. Per player and toggleable, so one person looking does
  // not reveal the match for everyone.
  onChatCommand('-viewdps', () => {
    const who = GetTriggerPlayer();
    if (who == null) return;
    const on = toggleDPSVision(who);
    DisplayTimedTextToPlayer(who, 0, 0, 8, on
      ? 'Sparring vision ON. -viewdps again to hide it.'
      : 'Sparring vision OFF.');
  });

  // What the last DPS match measured, and the multiplier it is about to apply
  // to the next camp's damage. For checking a suspicious camp without guessing.
  onChatCommand('-dpsnumbers', () => {
    for (const line of getDPSCheckReport()) print(line);
  });

  // Drive the defeat path without having to actually run the train out of
  // track, which otherwise takes a whole round to reach.
  onChatCommand('-testdefeat', () => {
    triggerDefeat();
  });

  // Jump to the boss arena, for the fight's real setting rather than a boss
  // dropped into a round. (This was registered as a second -boss, so typing
  // -boss spawned a boss and then swept it away with the arena.)
  onChatCommand('-arena', () => {
    stopGameplay();
    loadBossBattlefield();
    print('Boss battlefield loaded.');
  });

  // Jump to the inter-round lobby, for looking at the shop and the dealer
  // without playing a round to get there.
  onChatCommand('-lobby', () => {
    stopGameplay();
    finishRoundToLobby();
  });

  onChatCommand('-load', () => {
    if (loadFromFile()) {
      ensureRosterForLoadedRun();
      print('Save loaded. Entering inter-round lobby...');
      stopGameplay();
      loadInterRoundLobby();
    } else {
      print('No save file found.');
    }
  });
}
