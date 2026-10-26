import { Trigger } from 'w3ts';
import { Units } from '@objectdata/units';
import { gameState, syncState } from './state';
import { showFloatingText } from './items';
import { INVENTORY_SLOTS, nextFrame } from './util';
import {
  SALESPERSON_ID, PEASANT_ID, RESOURCE_VACUUM_ID, GREATER_RESOURCE_VACUUM_ID,
  UPGRADE_PEASANT_ABILITY_ID,
} from './constants';

/**
 * The Secret Salesperson: a goblin who turns up on snow rounds selling peasant
 * ability items. Placed by the terrain generator like the creep camp; this is
 * his stock and his till.
 *
 * Purchases are paid from the shared gold (gameState.gold) like every other
 * purchase, so the native gold the engine deducts is only ever a display that
 * syncState overwrites. A purchase that turns out to be useless is not charged
 * and its item is taken back.
 */
const PRICES = new Map<number, number>([
  [RESOURCE_VACUUM_ID, 2],
  [UPGRADE_PEASANT_ABILITY_ID, 3],
]);

/** What he pays for an ability item sold back to him. Nothing else is bought. */
const BUYBACK = new Map<number, number>([
  [RESOURCE_VACUUM_ID, 1],
  [GREATER_RESOURCE_VACUUM_ID, 2],
]);

/** Each ability item and its Greater version. */
const GREATER_VERSION = new Map<number, number>([
  [RESOURCE_VACUUM_ID, GREATER_RESOURCE_VACUUM_ID],
]);

/** Stock a freshly spawned salesperson. Deferred a frame, as for the shop, so
 *  the adds land after the unit fully exists. */
export function stockSalesperson(salesperson: unit): void {
  const t = CreateTimer()!;
  TimerStart(t, 0, false, () => {
    DestroyTimer(t);
    if (GetUnitTypeId(salesperson) === 0) return;
    AddItemToStock(salesperson, RESOURCE_VACUUM_ID, 10, 10);
    AddItemToStock(salesperson, UPGRADE_PEASANT_ABILITY_ID, 10, 10);
  });
}

/** The buyer's ability item that has a Greater version, if any. */
function upgradableItem(buyer: unit): item | null {
  for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
    const it = UnitItemInSlot(buyer, slot);
    if (it != null && GREATER_VERSION.has(GetItemTypeId(it))) return it;
  }
  return null;
}

/** Take back an item the buyer shouldn't have, uncharged. */
function refuse(buyer: unit, sold: item, msg: string): void {
  RemoveItem(sold);
  syncState(); // put back the native gold the engine took
  showFloatingText(buyer, msg);
}

export function initSalesperson(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SELL_ITEM);
  t.addAction(() => {
    const seller = GetSellingUnit();
    const buyer = GetBuyingUnit();
    const sold = GetSoldItem();
    if (seller == null || buyer == null || sold == null) return;
    if (GetUnitTypeId(seller) !== SALESPERSON_ID) return;
    const itemType = GetItemTypeId(sold);
    const price = PRICES.get(itemType);
    if (price == null) return;

    if (gameState.gold < price) {
      refuse(buyer, sold, 'Not enough gold!');
      return;
    }
    if (GetUnitTypeId(buyer) !== PEASANT_ID) {
      refuse(buyer, sold, 'Only peasants can buy here!');
      return;
    }

    if (itemType === UPGRADE_PEASANT_ABILITY_ID) {
      const current = upgradableItem(buyer);
      if (current == null) {
        refuse(buyer, sold, 'Nothing to upgrade!');
        return;
      }
      RemoveItem(sold);
      const greater = GREATER_VERSION.get(GetItemTypeId(current))!;
      RemoveItem(current);
      const upgraded = CreateItem(greater, GetUnitX(buyer), GetUnitY(buyer));
      if (upgraded != null) UnitAddItem(buyer, upgraded);
    }
    // An ability item goes on into the buyer's inventory as a pickup, where
    // items.ts gives it the last slot (swapping out any one already held).
    gameState.gold -= price;
    syncState();
  });
}

const SHOP_TYPES = [SALESPERSON_ID, FourCC(Units.Marketplace)];

/** The shop and the unit selling to it, for the pawn being handled. Read off
 *  every unit the event names rather than trusting one getter. */
function pawnParties(): [unit, unit] | null {
  let shop: unit | null = null;
  let seller: unit | null = null;
  for (const u of [GetSellingUnit(), GetBuyingUnit(), GetTriggerUnit()]) {
    if (u == null) continue;
    if (SHOP_TYPES.indexOf(GetUnitTypeId(u)) !== -1) shop = u;
    else seller = u;
  }
  return shop != null && seller != null ? [shop, seller] : null;
}

/** Whether the pawn being handled happened at the salesperson's shop. */
export function isSalespersonPawn(): boolean {
  const parties = pawnParties();
  return parties != null && GetUnitTypeId(parties[0]) === SALESPERSON_ID;
}

/** Selling to the salesperson: a peasant may sell back an ability item; any
 *  other item, from anyone, is handed straight back unpaid -- heroes and
 *  mercenaries carrying loot can find him too. And only he buys ability
 *  items: one sold to the regular shop is handed back the same way. */
export function initSalespersonBuyback(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PAWN_ITEM);
  t.addAction(() => {
    const pawn = pawnParties();
    const sold = GetSoldItem();
    if (pawn == null || sold == null) return;
    const [shop, seller] = pawn;
    const itemType = GetItemTypeId(sold);
    const atSalesperson = GetUnitTypeId(shop) === SALESPERSON_ID;
    if (!atSalesperson && BUYBACK.get(itemType) == null) return;
    const payout = BUYBACK.get(itemType);
    // The engine pays its own price for the item AFTER this handler (seen in
    // game: 250 native gold for a hero's claws), so the shared gold is copied
    // back over it a frame later, not now.
    nextFrame(() => syncState());
    if (atSalesperson && payout != null && GetUnitTypeId(seller) === PEASANT_ID) {
      RemoveItem(sold);
      gameState.gold += payout;
      return;
    }
    const charges = GetItemCharges(sold);
    RemoveItem(sold);
    const back = CreateItem(itemType, GetUnitX(seller), GetUnitY(seller));
    if (back != null) {
      SetItemCharges(back, charges);
      UnitAddItem(seller, back);
    }
    showFloatingText(seller, "He's not buying that!");
  });
}