import { Item, Trigger } from 'w3ts';
import { Players } from 'w3ts/globals';
import { loadCheatTerrain, loadLobby } from './terrain/load';
import { TRACK_PIECE_ID, WOOD_ID, STONE_ID } from './constants';
import { GRID_MIN_X, gridToWorld } from './terrain/constants';
import { loadFromFile } from './save';
import { stopGameplay } from './train';

/** Register a chat command (exact match, any player) with its action. */
function onChatCommand(command: string, action: () => void): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, command, true);
  });
  trigger.addAction(action);
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
  });

  onChatCommand('-load', () => {
    if (loadFromFile()) {
      print('Save loaded. Entering lobby...');
      stopGameplay();
      loadLobby();
    } else {
      print('No save file found.');
    }
  });
}
