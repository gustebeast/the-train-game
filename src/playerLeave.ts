import { MapPlayer, Trigger } from 'w3ts';
import { getHumanPlayers, nextFrame } from './util';

/** Kill every living unit owned by the given player. Uses KillUnit (not
 *  RemoveUnit) so normal death triggers fire — e.g. the hero death trigger
 *  that ends hero state and removes the creep camp. */
function killAllOwnedUnits(p: player): void {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, p, null!);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null && GetUnitState(u, UNIT_STATE_LIFE) > 0) {
      KillUnit(u);
    }
  });
  DestroyGroup(g);
}

/** When a player leaves, kill all their units (peasants, heroes, in-progress
 *  buildings). */
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
  });
}
