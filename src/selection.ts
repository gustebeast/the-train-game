import { MapPlayer, Trigger } from 'w3ts';
import { getHumanPlayers, unitExists } from './util';

/**
 * Who has what selected, as every machine agrees on it.
 *
 * IsUnitSelected is not that. A player's own machine updates its selection the
 * instant they click, and everyone else's only hears about it a network turn
 * later -- so a check made in that window answers differently from machine to
 * machine, and whatever it decides (a dance, a redraw) happens on some and not
 * others: a desync. The SELECTED and DESELECTED events, on the other hand,
 * arrive everywhere at the same point in the game, so the record kept here
 * from them is the same everywhere. It is also already up to date inside a
 * DESELECTED handler, where IsUnitSelected can still answer with the old
 * state.
 *
 * Read this, never IsUnitSelected, for anything that changes the game.
 */

/** Player id -> the units that player has selected. */
const selected = new Map<number, Set<unit>>();

type SelectionListener = (this: void, who: MapPlayer, u: unit, nowSelected: boolean) => void;
const listeners: SelectionListener[] = [];

/** Run cb after any human player selects or deselects a unit, once the record
 *  here already says so. */
export function onSelectionChanged(cb: SelectionListener): void {
  listeners.push(cb);
}

/** Whether `playerId` has `u` selected. */
export function isSelectedBy(u: unit, playerId: number): boolean {
  if (!unitExists(u)) return false;
  const set = selected.get(playerId);
  return set != null && set.has(u);
}

/** Whether any human player has `u` selected. */
export function isSelectedByAnyone(u: unit): boolean {
  for (const p of getHumanPlayers()) {
    if (isSelectedBy(u, p.id)) return true;
  }
  return false;
}

function record(nowSelected: boolean): void {
  const who = MapPlayer.fromEvent();
  const u = GetTriggerUnit();
  if (who == null || u == null) return;
  let set = selected.get(who.id);
  if (set == null) {
    set = new Set<unit>();
    selected.set(who.id, set);
  }
  if (nowSelected) set.add(u);
  else set.delete(u);
  for (const cb of listeners) cb(who, u, nowSelected);
}

export function initSelection(): void {
  const onSelect = Trigger.create();
  const onDeselect = Trigger.create();
  for (const p of getHumanPlayers()) {
    onSelect.registerPlayerUnitEvent(p, EVENT_PLAYER_UNIT_SELECTED, undefined);
    onDeselect.registerPlayerUnitEvent(p, EVENT_PLAYER_UNIT_DESELECTED, undefined);
  }
  onSelect.addAction(() => record(true));
  onDeselect.addAction(() => record(false));
}
