import { Item, MapPlayer, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { loadCheatTerrain, loadLobby } from './terrain/load';
import { TRACK_PIECE_ID } from './items';
import { GRID_MIN_X, gridToWorld } from './terrain/constants';
import { loadFromFile } from './save';
import { stopGameplay } from './train';
import { getCampCreeps, logUnitStats, scaleCreepStats, spawnCreepsAt } from './creeps';
import { initRandomHeroes } from './heroes';
import { TRACK_SIZE } from './track/constants';
import { Items } from '@objectdata/items';

export function triggerBattleTest(): void {
  // Load cheat terrain first to get a proper map
  loadCheatTerrain(GRID_MIN_X + 11);

  // Spawn heroes and creeps after a frame so terrain is ready
  const t = Timer.create();
  t.start(0.1, false, () => {
    t.destroy();

    const cx = 0;
    const cy = 0;

    initRandomHeroes();

    const compPlayer = MapPlayer.fromIndex(1)!;
    SetPlayerController(compPlayer.handle, MAP_CONTROL_COMPUTER);
    StartMeleeAI(compPlayer.handle, 'scripts\\common.ai');

    const heroPool = ['Hpal', 'Hamg', 'Hmkg', 'Hblm', 'Obla', 'Ofar', 'Otch', 'Oshd'];
    const h1 = Unit.create(compPlayer, FourCC(heroPool[GetRandomInt(0, heroPool.length - 1)]), cx - TRACK_SIZE, cy, 0)!;
    const h2 = Unit.create(compPlayer, FourCC(heroPool[GetRandomInt(0, heroPool.length - 1)]), cx - TRACK_SIZE, cy + TRACK_SIZE, 0)!;

    // Log stats before items
    logUnitStats('H1 (no items) ' + GetUnitName(h1.handle), h1.handle);
    logUnitStats('H2 (no items) ' + GetUnitName(h2.handle), h2.handle);

    // Give test items to heroes
    UnitAddItem(h1.handle, CreateItem(FourCC(Items.KhadgarsGemOfHealth), cx, cy)!);
    UnitAddItem(h2.handle, CreateItem(FourCC(Items.RingOfProtectionPlus2), cx, cy)!);

    // Log stats after items
    logUnitStats('H1 (w/ Khadgars Gem +350hp) ' + GetUnitName(h1.handle), h1.handle);
    logUnitStats('H2 (w/ Ring of Protection +2) ' + GetUnitName(h2.handle), h2.handle);

    const creepIds = getCampCreeps();
    if (creepIds == null) { print('No creep camp rolled'); return; }
    spawnCreepsAt(cx + 2 * TRACK_SIZE, cy, creepIds);

    // Scale and start battle after another frame (items need to apply)
    const t2 = Timer.create();
    t2.start(0, false, () => {
      t2.destroy();
      scaleCreepStats([h1, h2]);
    });

    const human = Players.find(p => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER);
    if (human != null) PanCameraToTimedForPlayer(human.handle, cx, cy, 0);

    print('Battle test started!');
  });
}

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
