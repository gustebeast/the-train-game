import { Destructable, Item, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { loadCheatTerrain, loadInterRoundLobby } from './terrain/load';
import { TRACK_PIECE_ID, WOOD_ID, STONE_ID, PEASANT_ID, WATER_ID, TRAIN_ID } from './constants';
import { GRID_MIN_X, gridToWorld, ROCK_RAW, TREE_RAW } from './terrain/constants';
import { loadFromFile } from './save';
import { stopGameplay, triggerDefeat } from './train';
import { applyChallengeEffects, toggleShoulderCam } from './challengeEffects';
import {
  getChallengeDefs, armChallenge, clearChallenges, advanceChallengeOffer,
} from './challenges';
import { applyTrackShapes } from './challengeList';
import { beginNight, endNight, isNight } from './daynight';
import { getNeutralPassive } from './teams';
import { makeDancer } from './dance';
import { getHumanPlayers, getWorldBounds } from './util';

/** True once the map has been revealed, so repeat calls are no-ops. */
let mapRevealed = false;

/** Reveal the whole map to all human players for the rest of the session.
 *  An active VISIBLE fog modifier outrides the masked-fog reset that runs on
 *  every terrain respawn, so the reveal survives round transitions.
 *
 *  Guarded because more than one cheat command calls this and each call used to
 *  create a fresh modifier per player without destroying the last, so typing
 *  -cheatmode (or -rolltest) repeatedly stacked leaked fog modifiers. One
 *  permanent modifier per player is all the reveal needs. */
function revealWholeMap(): void {
  if (mapRevealed) return;
  mapRevealed = true;
  for (const p of getHumanPlayers()) {
    const fog = CreateFogModifierRect(p.handle, FOG_OF_WAR_VISIBLE, getWorldBounds(), true, false);
    if (fog != null) FogModifierStart(fog);
  }
}

/** Register a chat command (exact match, any player) with its action. */
function onChatCommand(command: string, action: () => void): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, command, true);
  });
  trigger.addAction(action);
}

/** Register a chat command that takes an argument, e.g. "-challenge 4".
 *
 *  WC3's non-exact chat event matches a SUBSTRING, not a prefix, so "-challenge"
 *  would also fire on someone typing "look at -challenge 4" mid-sentence. The
 *  guard below insists the message actually starts with the command, which is
 *  also what keeps the argument at a known offset. */
function onChatCommandWithArg(command: string, action: (arg: string) => void): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, command, false);
  });
  trigger.addAction(() => {
    const said = GetEventPlayerChatString();
    if (said == null) return;
    if (string.sub(said, 1, string.len(command)) !== command) return;
    const [rest] = string.gsub(string.sub(said, string.len(command) + 1), '^%s+', '');
    action(rest);
  });
}

export function initCheat(): void {
  onChatCommand('-cheatmode', () => {
    loadCheatTerrain(GRID_MIN_X + 11);
    const trackPos = gridToWorld({ x: GRID_MIN_X + 4, y: -3 });
    const tracks = Item.create(TRACK_PIECE_ID, trackPos.x, trackPos.y)!;
    tracks.charges = 99;
    const woodPos = gridToWorld({ x: GRID_MIN_X + 5, y: -3 });
    const wood = Item.create(WOOD_ID, woodPos.x, woodPos.y)!;
    wood.charges = 99;
    const stonePos = gridToWorld({ x: GRID_MIN_X + 6, y: -3 });
    const stone = Item.create(STONE_ID, stonePos.x, stonePos.y)!;
    stone.charges = 99;
    revealWholeMap();
  });

  // Roll obstacle arena: clears a patch around the camera and drops one of each
  // collision hazard around a fresh peasant so you can roll (E) into each and
  // confirm the roll no longer clips through them. rock=E, tree=N, water=W,
  // train=S. Reveals the map so the arena is fully visible.
  onChatCommand('-rolltest', () => {
    revealWholeMap();
    const ax = GetCameraTargetPositionX();
    const ay = GetCameraTargetPositionY();
    const r = Rect(ax - 700, ay - 700, ax + 700, ay + 700);
    EnumDestructablesInRect(r, undefined, () => RemoveDestructable(GetEnumDestructable()!));
    RemoveRect(r);
    const d = 340;
    Destructable.create(FourCC(ROCK_RAW), ax + d, ay, 0, 1.4, 0);
    Destructable.create(FourCC(TREE_RAW), ax, ay + d, 0, 1.0, 0);
    const water = Unit.create(getNeutralPassive(), WATER_ID, ax - d, ay, 0);
    if (water != null) water.invulnerable = true;
    const train = Unit.create(getNeutralPassive(), TRAIN_ID, ax, ay - d, 0);
    if (train != null) train.invulnerable = true;
    CreateUnit(Players[0].handle, PEASANT_ID, ax, ay, 90);
    PanCameraToTimed(ax, ay, 0);
    print('Dash arena: rock=E, tree=N, water=W, train=S. Cast Dash (E) into each.');
  });

  // Make your first peasant dash east on command — handy for eyeballing the
  // dash and for checking a queued follow-up order still runs.
  onChatCommand('-dashnow', () => {
    const g = CreateGroup()!;
    GroupEnumUnitsOfPlayer(g, Players[0].handle, undefined);
    let pe: unit | undefined;
    ForGroup(g, () => {
      const u = GetEnumUnit();
      if (pe == null && u != null && GetUnitTypeId(u) === PEASANT_ID) pe = u;
    });
    DestroyGroup(g);
    if (pe == null) { print('rollnow: no peasant'); return; }
    const p = pe;
    PanCameraToTimed(GetUnitX(p), GetUnitY(p), 0);
    SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, 1100, 0);
    IssuePointOrderById(p, OrderId('flare')!, GetUnitX(p) + 400, GetUnitY(p));
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
  onChatCommand('-dance', () => {
    const x = GetCameraTargetPositionX();
    const y = GetCameraTargetPositionY();
    const dancer = Unit.create(Players[0], PEASANT_ID, x, y, 270);
    if (dancer == null) { print('dance: could not spawn a peasant'); return; }
    makeDancer(dancer);
    ClearSelection();
    SelectUnit(dancer.handle, true);
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

  // Drive the defeat path without having to actually run the train out of
  // track, which otherwise takes a whole round to reach.
  onChatCommand('-testdefeat', () => {
    triggerDefeat();
  });

  // Jump to the inter-round lobby, for looking at the shop and the dealer without playing
  // a round to get there.
  onChatCommand('-lobby', () => {
    stopGameplay();
    advanceChallengeOffer();
    loadInterRoundLobby();
  });

  onChatCommand('-load', () => {
    if (loadFromFile()) {
      print('Save loaded. Entering inter-round lobby...');
      stopGameplay();
      loadInterRoundLobby();
    } else {
      print('No save file found.');
    }
  });
}
