import { MapPlayer, Trigger } from 'w3ts';
import { forEachUnitOfPlayer, getHumanPlayers, nextFrame, isAlive } from './util';

/** Everyone who wants to know a player has left, in registration order. */
const leaveListeners: Array<(this: void, leaving: MapPlayer) => void> = [];

/** Run cb whenever a human player leaves the game. One trigger serves every
 *  listener, so a system cannot register a leave event of its own and miss the
 *  ones that came first. */
export function onPlayerLeave(cb: (this: void, leaving: MapPlayer) => void): void {
  leaveListeners.push(cb);
}

/** Kill every living unit owned by the given player. Uses KillUnit (not
 *  RemoveUnit) so normal death triggers fire — e.g. the hero death trigger
 *  that ends hero state and removes the creep camp. */
function killAllOwnedUnits(p: player): void {
  forEachUnitOfPlayer(p, u => {
    if (isAlive(u)) KillUnit(u);
  });
}

/** Watch for players leaving. A leaver's units die with them (peasants,
 *  heroes, in-progress buildings), and then every listener hears about it. */
export function initPlayerLeave(): void {
  const trigger = Trigger.create();
  for (const p of getHumanPlayers()) {
    trigger.registerPlayerEvent(p, EVENT_PLAYER_LEAVE);
  }
  trigger.addAction(() => {
    const leaving = MapPlayer.fromEvent();
    if (leaving == null) return;
    killAllOwnedUnits(leaving.handle);
    // The kill chain can hand the leaver new units in the same frame (hero
    // death → endHeroState restores transferred peasants) — sweep once more
    nextFrame(() => killAllOwnedUnits(leaving.handle));
    for (const cb of leaveListeners) cb(leaving);
  });
}
