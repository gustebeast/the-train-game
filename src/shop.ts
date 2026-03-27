import { Trigger } from 'w3ts';
import { Items } from '@objectdata/items';
import { gameState, syncGold } from './state';
import { getTrain, syncTrainStats } from './train';

const FLAME_RETARDANT_ID = FourCC(Items.TomeOfStrength);
const TRACK_MANUFACTURING_ID = FourCC(Items.TomeOfIntelligence);

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RETARDANT_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
]);

// Maps item rawcode → 4-char ability ID whose effect art plays on the train.
// Effect path: Abilities\Spells\Items\{id}\{id}Target.mdl
// Use AIem as default if no thematic match.
const UPGRADE_EFFECTS: Record<number, string> = {
  [FLAME_RETARDANT_ID]: 'AIsm',      // strength
  [TRACK_MANUFACTURING_ID]: 'AIim',   // intelligence
};

const DEFAULT_EFFECT_ID = 'AIem';

function playUpgradeEffect(itemTypeId: number): void {
  const train = getTrain();
  if (train == null) return;
  const id = UPGRADE_EFFECTS[itemTypeId] ?? DEFAULT_EFFECT_ID;
  const path = `Abilities\\Spells\\Items\\${id}\\${id}Target.mdl`;
  const sfx = AddSpecialEffectTarget(path, train.handle, 'origin');
  if (sfx != null) DestroyEffect(sfx);
}

export function initShop(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  t.addAction(() => {
    const item = GetManipulatedItem();
    if (item == null) return;
    const itemTypeId = GetItemTypeId(item);

    const cost = ITEM_COSTS.get(itemTypeId);
    if (cost != null) {
      if (gameState.gold < cost) {
        RemoveItem(item);
        return;
      }
      gameState.gold -= cost;
      syncGold();
    }

    if (itemTypeId === FLAME_RETARDANT_ID) {
      gameState.trainMaxHP += 10;
      syncTrainStats();
      playUpgradeEffect(itemTypeId);
      RemoveItem(item);
    } else if (itemTypeId === TRACK_MANUFACTURING_ID) {
      gameState.trainMaxMana -= 10;
      if (gameState.trainMaxMana < 10) gameState.trainMaxMana = 10;
      syncTrainStats();
      playUpgradeEffect(itemTypeId);
      RemoveItem(item);
    }
  });
}
