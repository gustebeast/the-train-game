import { Item, Trigger } from 'w3ts';
import { Players } from 'w3ts/globals';
import { generateTerrain } from './terrain/generate';
import { spawnTerrain, enableCheatMode } from './terrain/spawn';
import { setVictoryTile } from './track/state';
import { TRACK_PIECE_ID } from './items';
import { GRID_MIN_X, GRID_MAX_X, gridToWorld } from './terrain/constants';
import { TRACK_SIZE } from './track/constants';

export function initCheat(): void {
  const trigger = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, '-cheatmode', true);
  });
  trigger.addAction(() => {
    enableCheatMode();
    EnumDestructablesInRect(GetWorldBounds()!, null!, () => {
      RemoveDestructable(GetEnumDestructable()!);
    });
    const grid = generateTerrain(0);
    spawnTerrain(grid);
    setVictoryTile(GRID_MAX_X * TRACK_SIZE, grid.exitY * TRACK_SIZE);
    const trackPos = gridToWorld(GRID_MIN_X + 4, -3);
    const tracks = Item.create(TRACK_PIECE_ID, trackPos.x, trackPos.y)!;
    tracks.charges = 99;
  });
}
