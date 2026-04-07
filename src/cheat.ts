import { Item, Trigger } from 'w3ts';
import { Players } from 'w3ts/globals';
import { loadCheatTerrain, loadLobby } from './terrain/load';
import { TRACK_PIECE_ID } from './constants';
import { GRID_MIN_X, gridToWorld } from './terrain/constants';
import { loadFromFile } from './save';
import { stopGameplay } from './train';

export function initCheat(): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, '-cheatmode', true);
  });
  trigger.addAction(() => {
    loadCheatTerrain(GRID_MIN_X + 11);
    const trackPos = gridToWorld({ x: GRID_MIN_X + 4, y: -3 });
    const tracks = Item.create(TRACK_PIECE_ID, trackPos.x, trackPos.y)!;
    tracks.charges = 99;
  });

  const loadTrigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(loadTrigger.handle, p.handle, '-load', true);
  });
  loadTrigger.addAction(() => {
    if (loadFromFile()) {
      print('Save loaded. Entering lobby...');
      stopGameplay();
      loadLobby();
    } else {
      print('No save file found.');
    }
  });
}
