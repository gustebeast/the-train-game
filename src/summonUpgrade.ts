import { Unit } from 'w3ts';
import { registerSaveSegment } from './save';
import { getHumanPlayers } from './util';
import { SUMMON_TECH_ID, SUMMON_UPGRADE_ITEM_ID } from './constants';

/** Whether the Summon Heroes upgrade has been bought (persisted in saves). */
let purchased = false;

/** The current lobby shop unit, so the upgrade can be pulled from stock. */
let shopUnit: Unit | null = null;

export function isSummonUpgradePurchased(): boolean {
  return purchased;
}

/** Research the tech for all human players, un-graying the summon ability. */
function applyTech(): void {
  for (const p of getHumanPlayers()) {
    SetPlayerTechResearched(p.handle, SUMMON_TECH_ID, 1);
  }
}

/** Pull the upgrade from the current shop's stock (if a shop exists). */
function removeFromShopStock(): void {
  if (shopUnit != null && GetUnitTypeId(shopUnit.handle) !== 0) {
    RemoveItemFromStock(shopUnit.handle, SUMMON_UPGRADE_ITEM_ID);
  }
}

/** Register the lobby shop after it spawns, so a later purchase can pull
 *  the item from its stock. Initial stocking is additive (stockShop in
 *  shop.ts) — when the upgrade is owned the item is simply never added. */
export function registerSummonShop(shop: Unit): void {
  shopUnit = shop;
}

/** Mark the upgrade as bought: unlock the summon ability and stop selling it. */
export function purchaseSummonUpgrade(): void {
  purchased = true;
  applyTech();
  removeFromShopStock();
}

// Persist as save segment 'su': '1' when bought, omitted otherwise.
// Loading is reset-then-apply: baseline is "not purchased, tech unresearched";
// the decoder re-applies the purchase if the save has it. The shop needs no
// handling here — loading rebuilds the map, and the fresh shop is stocked
// from the (post-load) purchased flag (see stockShop in shop.ts).
registerSaveSegment('su',
  () => (purchased ? '1' : ''),
  (raw) => {
    if (raw === '1') {
      purchased = true;
      applyTech();
    }
  },
  () => {
    purchased = false;
    for (const p of getHumanPlayers()) {
      SetPlayerTechResearched(p.handle, SUMMON_TECH_ID, 0);
    }
  },
);
