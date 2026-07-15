import { Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { gameState, syncState } from './state';
import { getTrain, getTrackWagon } from './train';
import { getCrateStart, loadCrateForLobby } from './items';
import { SUMMON_UPGRADE_ITEM_ID, PEASANT_ID } from './constants';
import { isSummonUpgradePurchased, purchaseSummonUpgrade, registerSummonShop } from './summonUpgrade';
import { forEachUnitInWorld } from './util';

const FLAME_RESISTANCE_ID = FourCC(Items.AncientFigurine);
const TRACK_MANUFACTURING_ID = FourCC(Items.BracerOfAgility);
const RESOURCE_CAPACITY_ID = FourCC(Items.DruidPouch);
const TRACK_CAPACITY_ID = FourCC(Items.JadeRing);
const CRATE_CAPACITY_ID = FourCC(Items.LionsRing);

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RESISTANCE_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
  [RESOURCE_CAPACITY_ID, 1],
  [TRACK_CAPACITY_ID, 1],
  [CRATE_CAPACITY_ID, 1],
  [SUMMON_UPGRADE_ITEM_ID, 1],
]);

/** Hook for a freshly spawned shop. All items for sale are pre-listed in
 *  the shop's object data (dynamically ADDED stock never displays in this
 *  engine version — tested), so availability is managed by REMOVAL only:
 *  the summon upgrade is pulled from stock when already owned. */
export function stockShop(shop: Unit): void {
  registerSummonShop(shop);
}

// Effect path: Abilities\Spells\Items\{id}\{id}Target.mdl
const EFFECT_ID = 'AIem';

function playUpgradeEffect(targets: Unit[]): void {
  for (const u of targets) {
    const path = `Abilities\\Spells\\Items\\${EFFECT_ID}\\${EFFECT_ID}Target.mdl`;
    const sfx = AddSpecialEffectTarget(path, u.handle, 'origin');
    if (sfx != null) DestroyEffect(sfx);
  }
}

export function initShop(): void {
  // Blizzard.j's InitNeutralBuildings registers RemovePurchasedItem, which
  // strips any sold item type from a NEUTRAL PASSIVE seller's stock — for
  // trigger-added stock that deletes the slot permanently after one
  // purchase. Our shop is fully trigger-stocked; kill the whole machinery
  // (the marketplace rotation timer dies with it — no marketplaces here).
  if (bj_stockItemPurchased != null) DestroyTrigger(bj_stockItemPurchased);
  if (bj_stockUpdateTimer != null) DestroyTimer(bj_stockUpdateTimer);

  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  t.addAction(() => {
    const item = GetManipulatedItem();
    if (item == null) return;
    const itemTypeId = GetItemTypeId(item);

    const cost = ITEM_COSTS.get(itemTypeId);
    if (cost == null) return;

    // One-time upgrade already owned — swallow the item without charging
    if (itemTypeId === SUMMON_UPGRADE_ITEM_ID && isSummonUpgradePurchased()) {
      RemoveItem(item);
      return;
    }

    if (gameState.gold < cost) {
      RemoveItem(item);
      return;
    }
    gameState.gold -= cost;

    let effectTargets: Unit[] = [];

    if (itemTypeId === FLAME_RESISTANCE_ID) {
      gameState.trainMaxHP += 10;
      effectTargets = [getTrain()];
    } else if (itemTypeId === TRACK_MANUFACTURING_ID) {
      gameState.trainMaxMana -= 10;
      if (gameState.trainMaxMana < 10) gameState.trainMaxMana = 10;
      effectTargets = [getTrain()];
    } else if (itemTypeId === RESOURCE_CAPACITY_ID) {
      gameState.trainCargoMaxStack += 2;
      effectTargets = [getTrain()];
    } else if (itemTypeId === TRACK_CAPACITY_ID) {
      gameState.trainTrackMaxStack += 2;
      effectTargets = [getTrackWagon()];
    } else if (itemTypeId === CRATE_CAPACITY_ID) {
      gameState.crateMaxStack += 4;
      // The shop is in the lobby, where the START crate displays capacity as
      // item charges — refresh it and play the effect there (the target
      // crate from getCrate() only exists during gameplay rounds)
      loadCrateForLobby();
      const crateStart = getCrateStart();
      if (crateStart != null) effectTargets = [crateStart];
    } else if (itemTypeId === SUMMON_UPGRADE_ITEM_ID) {
      purchaseSummonUpgrade();
      // The unlock applies to everyone — play the effect on every peasant
      const targets: Unit[] = [];
      forEachUnitInWorld(u => {
        if (GetUnitTypeId(u) === PEASANT_ID) {
          const peasant = Unit.fromHandle(u);
          if (peasant != null) targets.push(peasant);
        }
      });
      effectTargets = targets;
      print('Summon Heroes unlocked!');
    }

    syncState();
    playUpgradeEffect(effectTargets);
    RemoveItem(item);
  });
}
