import { MapPlayer, Rectangle, Region, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Abilities } from '@objectdata/abilities';
import { PEASANT_ID } from './constants';

const READY_ORB_ABILITY_ID = FourCC(Abilities.ItemArmorBonusPlus8);
const REGION_HALF = 128; // 2x2 grid cells = 256 world units, half = 128

interface ZoneConfig {
  message: string;
  callback: () => void;
}

interface ActiveZone {
  config: ZoneConfig;
  rect: Rectangle;
  region: Region;
  enterTrigger: Trigger;
  leaveTrigger: Trigger;
  countdownTimer: Timer | null;
  countdownStep: number;
  readyPlayers: Set<number>;
}

const zoneConfigs = new Map<string, ZoneConfig>();
const activeZones = new Map<string, ActiveZone>();
let playerLeaveTrigger: Trigger | null = null;

/** Get current active human player IDs (playing + user-controlled). */
function getActivePlayerIds(): number[] {
  return Players.filter(
    (p: MapPlayer) => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  ).map((p: MapPlayer) => p.id);
}

function checkAllReady(zone: ActiveZone): void {
  const activeIds = getActivePlayerIds();
  if (activeIds.length === 0) return;

  const allReady = activeIds.every(id => zone.readyPlayers.has(id));

  if (allReady && zone.countdownTimer == null) {
    startCountdown(zone);
  } else if (!allReady && zone.countdownTimer != null) {
    cancelCountdown(zone);
  }
}

function startCountdown(zone: ActiveZone): void {
  zone.countdownStep = 3;
  print(zone.config.message + ' in ' + I2S(zone.countdownStep) + '...');
  zone.countdownTimer = Timer.create();
  zone.countdownTimer.start(1.0, true, () => {
    zone.countdownStep -= 1;
    if (zone.countdownStep > 0) {
      print(I2S(zone.countdownStep) + '...');
    } else {
      const cb = zone.config.callback;
      cancelCountdown(zone);
      cb();
    }
  });
}

function cancelCountdown(zone: ActiveZone): void {
  if (zone.countdownTimer != null) {
    zone.countdownTimer.destroy();
    zone.countdownTimer = null;
  }
  zone.countdownStep = 0;
}

/** Register a ready zone type with its countdown message and completion callback. */
export function registerReadyZone(id: string, message: string, callback: () => void): void {
  zoneConfigs.set(id, { message, callback });
}

/** Create a ready zone centered at (cx, cy) for the given registered zone id. */
export function initReadyZone(cx: number, cy: number, id: string): void {
  const config = zoneConfigs.get(id);
  if (config == null) return;

  const rect = Rectangle.create(
    cx - REGION_HALF, cy - REGION_HALF,
    cx + REGION_HALF, cy + REGION_HALF,
  );
  const region = Region.create();
  region.addRect(rect);

  const zone: ActiveZone = {
    config,
    rect,
    region,
    enterTrigger: Trigger.create(),
    leaveTrigger: Trigger.create(),
    countdownTimer: null,
    countdownStep: 0,
    readyPlayers: new Set(),
  };

  zone.enterTrigger.registerEnterRegion(region.handle, undefined);
  zone.enterTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitAddAbility(u.handle, READY_ORB_ABILITY_ID);
    zone.readyPlayers.add(u.owner.id);
    checkAllReady(zone);
  });

  zone.leaveTrigger.registerLeaveRegion(region.handle, undefined);
  zone.leaveTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitRemoveAbility(u.handle, READY_ORB_ABILITY_ID);
    zone.readyPlayers.delete(u.owner.id);
    checkAllReady(zone);
  });

  activeZones.set(id, zone);

  // Set up shared player-leave trigger once
  if (playerLeaveTrigger == null) {
    playerLeaveTrigger = Trigger.create();
    for (const p of Players) {
      if (p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER) {
        playerLeaveTrigger.registerPlayerEvent(p, EVENT_PLAYER_LEAVE);
      }
    }
    playerLeaveTrigger.addAction(() => {
      const leavingPlayer = MapPlayer.fromEvent();
      if (leavingPlayer == null) return;
      for (const [, z] of activeZones) {
        z.readyPlayers.delete(leavingPlayer.id);
        checkAllReady(z);
      }
    });
  }
}

/** Destroy all ready zones and triggers. */
export function cleanupReady(): void {
  for (const [, zone] of activeZones) {
    cancelCountdown(zone);
    zone.enterTrigger.destroy();
    zone.leaveTrigger.destroy();
    zone.region.destroy();
    zone.rect.destroy();
  }
  activeZones.clear();
  if (playerLeaveTrigger != null) {
    playerLeaveTrigger.destroy();
    playerLeaveTrigger = null;
  }
}
