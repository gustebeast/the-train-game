import { MapPlayer, Rectangle, Region, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { gameState } from './state';

const READY_ORB_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus6);
const PEASANT_ID = FourCC(Units.Peasant);
const REGION_HALF = 192; // 3x3 grid cells = 384 world units, half = 192

let readyRect: Rectangle | null = null;
let readyRegion: Region | null = null;
let enterTrigger: Trigger | null = null;
let leaveTrigger: Trigger | null = null;
let playerLeaveTrigger: Trigger | null = null;
let countdownTimer: Timer | null = null;
let countdownStep = 0;

// Track which players have a peasant in the ready zone
const readyPlayers = new Set<number>();

let startRoundCallback: ((difficulty: number) => void) | null = null;

/** Set the callback that starts a new round. Called with the difficulty (round number). */
export function setStartRoundCallback(cb: (difficulty: number) => void): void {
  startRoundCallback = cb;
}

/** Get current active human player IDs (playing + user-controlled). */
function getActivePlayerIds(): number[] {
  return Players.filter(
    (p: MapPlayer) => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  ).map((p: MapPlayer) => p.id);
}

/** Check if all active players are ready and start/cancel countdown accordingly. */
function checkAllReady(): void {
  const activeIds = getActivePlayerIds();
  if (activeIds.length === 0) return;

  const allReady = activeIds.every(id => readyPlayers.has(id));

  if (allReady && countdownTimer == null) {
    startCountdown();
  } else if (!allReady && countdownTimer != null) {
    cancelCountdown();
  }
}

function startCountdown(): void {
  countdownStep = 3;
  print('Starting next round in ' + I2S(countdownStep) + '...');
  countdownTimer = Timer.create();
  countdownTimer.start(1.0, true, () => {
    countdownStep -= 1;
    if (countdownStep > 0) {
      print(I2S(countdownStep) + '...');
    } else {
      cancelCountdown();
      if (startRoundCallback != null) {
        startRoundCallback(gameState.round);
      }
    }
  });
}

function cancelCountdown(): void {
  if (countdownTimer != null) {
    countdownTimer.destroy();
    countdownTimer = null;
  }
  countdownStep = 0;
}

/** Initialize the ready system with a rectangle centered on the circle of power. */
export function initReady(cx: number, cy: number): void {
  cleanupReady();

  readyRect = Rectangle.create(
    cx - REGION_HALF, cy - REGION_HALF,
    cx + REGION_HALF, cy + REGION_HALF,
  );
  readyRegion = Region.create();
  readyRegion.addRect(readyRect);

  enterTrigger = Trigger.create();
  enterTrigger.registerEnterRegion(readyRegion.handle, undefined);
  enterTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitAddAbility(u.handle, READY_ORB_ABILITY_ID);
    readyPlayers.add(u.owner.id);
    checkAllReady();
  });

  leaveTrigger = Trigger.create();
  leaveTrigger.registerLeaveRegion(readyRegion.handle, undefined);
  leaveTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitRemoveAbility(u.handle, READY_ORB_ABILITY_ID);
    readyPlayers.delete(u.owner.id);
    checkAllReady();
  });

  // Handle players leaving the game mid-lobby
  playerLeaveTrigger = Trigger.create();
  for (const p of Players) {
    if (p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER) {
      playerLeaveTrigger.registerPlayerEvent(p, EVENT_PLAYER_LEAVE);
    }
  }
  playerLeaveTrigger.addAction(() => {
    const leavingPlayer = MapPlayer.fromEvent();
    if (leavingPlayer != null) {
      readyPlayers.delete(leavingPlayer.id);
      checkAllReady();
    }
  });
}

/** Destroy all ready-system triggers and regions. */
export function cleanupReady(): void {
  cancelCountdown();
  readyPlayers.clear();
  if (enterTrigger != null) { enterTrigger.destroy(); enterTrigger = null; }
  if (leaveTrigger != null) { leaveTrigger.destroy(); leaveTrigger = null; }
  if (playerLeaveTrigger != null) { playerLeaveTrigger.destroy(); playerLeaveTrigger = null; }
  if (readyRegion != null) { readyRegion.destroy(); readyRegion = null; }
  if (readyRect != null) { readyRect.destroy(); readyRect = null; }
}
