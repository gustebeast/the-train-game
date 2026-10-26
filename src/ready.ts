import { MapPlayer, Rectangle, Region, Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { PEASANT_ID } from './constants';
import { getHumanPlayers } from './util';

const READY_ORB_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus6);
const REGION_HALF = 128; // 2x2 grid cells = 256 world units, half = 128

interface ZoneConfig {
  message: string;
  callback: () => void;
  /** Why this zone cannot do anything right now, or null when it can.
   *
   *  Asked the moment everyone is ready, so a circle that would achieve
   *  nothing -- Load Save with no saves, paging with only one -- says so at
   *  once instead of counting three down to nothing happening. */
  blocked?: () => string | null;
  /** How many seconds the countdown should run, when three is not always
   *  enough. Asked when the countdown starts and again when it reaches zero,
   *  so something that changes in between -- a reroll restarting the sparring
   *  match -- extends it rather than being skipped past. */
  seconds?: () => number;
}

interface ActiveZone {
  config: ZoneConfig;
  /** The circle of power this zone sits on, so removing the zone removes the
   *  thing the player can see and walk onto. */
  marker: Unit | null;
  rect: Rectangle;
  region: Region;
  enterTrigger: Trigger;
  leaveTrigger: Trigger;
  countdownTimer: Timer | null;
  countdownStep: number;
  readyPlayers: Set<number>;
  /** Set while the zone is standing on a refusal, so stepping a second player
   *  on does not repeat it. Cleared as soon as anybody steps off. */
  refused: boolean;
  /** When set, the zone is ready once every one of THESE units that is still
   *  alive stands in it, instead of one peasant per player. */
  members: unit[] | null;
  /** Which members are standing in the zone right now. */
  membersInside: Set<unit>;
}

function isMember(zone: ActiveZone, u: unit): boolean {
  return zone.members != null && zone.members.indexOf(u) >= 0;
}

function membersReady(zone: ActiveZone): boolean {
  const living = zone.members!.filter(u => GetWidgetLife(u) > 0.405);
  return living.length > 0 && living.every(u => zone.membersInside.has(u));
}

const zoneConfigs = new Map<string, ZoneConfig>();
const activeZones = new Map<string, ActiveZone>();
let playerLeaveTrigger: Trigger | null = null;

function checkAllReady(zone: ActiveZone): void {
  const activeIds = getHumanPlayers().map(p => p.id);
  if (activeIds.length === 0) return;

  const allReady = zone.members != null
    ? membersReady(zone)
    : activeIds.every(id => zone.readyPlayers.has(id));

  if (allReady && zone.countdownTimer == null) {
    const why = zone.config.blocked != null ? zone.config.blocked() : null;
    if (why != null) {
      if (!zone.refused) { print(why); zone.refused = true; }
      return;
    }
    startCountdown(zone);
  } else if (!allReady) {
    zone.refused = false;
    if (zone.countdownTimer != null) cancelCountdown(zone);
  }
}

const MIN_COUNTDOWN = 3;

/** Seconds the zone still wants to wait, beyond nothing. Whole seconds,
 *  rounded up, so a wait of 6.2 is never cut to 6. */
function extraWait(zone: ActiveZone): number {
  if (zone.config.seconds == null) return 0;
  return math.max(0, math.ceil(zone.config.seconds()));
}

function startCountdown(zone: ActiveZone): void {
  zone.countdownStep = math.max(MIN_COUNTDOWN, extraWait(zone));
  // An unnamed zone counts down bare: "3...", with no "<message> in".
  print((zone.config.message === '' ? '' : zone.config.message + ' in ') + I2S(zone.countdownStep) + '...');
  zone.countdownTimer = Timer.create();
  zone.countdownTimer.start(1.0, true, () => {
    zone.countdownStep -= 1;
    if (zone.countdownStep <= 0) {
      // Still waiting on something that changed mid-countdown: keep going.
      const more = extraWait(zone);
      if (more > 0) zone.countdownStep = more;
    }
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
export function registerReadyZone(
  id: string, message: string, callback: () => void, blocked?: () => string | null,
  seconds?: () => number,
): void {
  zoneConfigs.set(id, { message, callback, blocked, seconds });
}

/** Create a ready zone centered at (cx, cy) for the given registered zone id.
 *  Pass `members` to make it wait for those units instead of for a peasant
 *  from every player. */
export function initReadyZone(
  cx: number, cy: number, id: string, marker: Unit | null = null, members: unit[] | null = null,
): void {
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
    marker,
    rect,
    region,
    enterTrigger: Trigger.create(),
    leaveTrigger: Trigger.create(),
    countdownTimer: null,
    countdownStep: 0,
    readyPlayers: new Set(),
    refused: false,
    members,
    membersInside: new Set(),
  };

  zone.enterTrigger.registerEnterRegion(region.handle, undefined);
  zone.enterTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null) return;
    if (zone.members != null) {
      if (!isMember(zone, u.handle)) return;
      zone.membersInside.add(u.handle);
    } else {
      if (u.typeId !== PEASANT_ID) return;
      zone.readyPlayers.add(u.owner.id);
    }
    UnitAddAbility(u.handle, READY_ORB_ABILITY_ID);
    checkAllReady(zone);
  });

  zone.leaveTrigger.registerLeaveRegion(region.handle, undefined);
  zone.leaveTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null) return;
    if (zone.members != null) {
      if (!isMember(zone, u.handle)) return;
      zone.membersInside.delete(u.handle);
    } else {
      if (u.typeId !== PEASANT_ID) return;
      zone.readyPlayers.delete(u.owner.id);
    }
    UnitRemoveAbility(u.handle, READY_ORB_ABILITY_ID);
    checkAllReady(zone);
  });

  activeZones.set(id, zone);

  // A member zone can appear under units already standing there, and entering
  // only fires on the way in -- so count whoever is on the spot now.
  if (members != null) {
    for (const u of members) {
      if (GetWidgetLife(u) > 0.405 && IsUnitInRegion(region.handle, u)) {
        zone.membersInside.add(u);
        UnitAddAbility(u, READY_ORB_ABILITY_ID);
      }
    }
    checkAllReady(zone);
  }

  // Set up shared player-leave trigger once
  if (playerLeaveTrigger == null) {
    playerLeaveTrigger = Trigger.create();
    for (const p of getHumanPlayers()) {
      playerLeaveTrigger.registerPlayerEvent(p, EVENT_PLAYER_LEAVE);
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
