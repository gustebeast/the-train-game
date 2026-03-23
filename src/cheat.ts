import { Item, Trigger } from 'w3ts';
import { Players } from 'w3ts/globals';
import { loadCheatTerrain } from './terrain/load';
import { TRACK_PIECE_ID } from './items';
import { GRID_MIN_X, gridToWorld } from './terrain/constants';

export function initCheat(): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, '-cheatmode', true);
  });
  trigger.addAction(() => {
    loadCheatTerrain(GRID_MIN_X + 20);
    const trackPos = gridToWorld({ x: GRID_MIN_X + 4, y: -3 });
    const tracks = Item.create(TRACK_PIECE_ID, trackPos.x, trackPos.y)!;
    tracks.charges = 99;
  });
}
