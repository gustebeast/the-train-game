import { Trigger } from 'w3ts';
import { Units } from '@objectdata/units';
import { gameState, syncState } from './state';
import { showFloatingText } from './items';
import { nextFrame, findInventoryItem, unitExists, giveKit } from './util';
import { carryItemCooldown } from './abilityItems';
import { registerSaveSegment, parseFields } from './save';
import { deriveSeed, STREAMS } from './rng';
import { ABILITY_ITEM_PRICE, UPGRADE_ABILITY_PRICE } from './sharedData';
import { SALESPERSON_ID, PEASANT_ID, UPGRADE_PEASANT_ABILITY_ID, ABILITY_ITEM_FAMILIES } from './constants';

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
/** What he pays for an ability item sold back to him: 1, or 2 for a Greater.
 *  Nothing else is bought. */
const BUYBACK = new Map<number, number>();
/** Each ability item and its Greater version. */
const GREATER_VERSION = new Map<number, number>();
const PRICES = new Map<number, number>([[UPGRADE_PEASANT_ABILITY_ID, UPGRADE_ABILITY_PRICE]]);
for (const { plain, greater } of ABILITY_ITEM_FAMILIES) {
  BUYBACK.set(plain, 1);
  BUYBACK.set(greater, 2);
  GREATER_VERSION.set(plain, greater);
  PRICES.set(plain, ABILITY_ITEM_PRICE);
}

// --- what's on offer ---------------------------------------------------------
//
// One ability item per visit, walked like the dealer's challenges: a seeded
// shuffle of the whole list, no repeats until every item has been offered,
// then a fresh shuffle for the next lap. Seeded per save, so a reload brings
// back the same sequence.

let seed = 0;
let cycles = 0;
/** Keys offered this lap. */
let seen: string[] = [];
let offeredKey: string | null = null;

function shuffledKeys(): string[] {
  const keys = ABILITY_ITEM_FAMILIES.map(f => f.key);
  let state = ((seed !== 0 ? seed : 1) + cycles * 2654435761) % 4294967296;
  for (let i = keys.length - 1; i > 0; i--) {
    state = (1664525 * state + 1013904223) % 4294967296;
    const j = state % (i + 1);
    const tmp = keys[i];
    keys[i] = keys[j];
    keys[j] = tmp;
  }
  return keys;
}

/** Move the offer on to the next item of the lap. Called once per visit. */
function advanceOffer(): void {
  if (seed === 0) seed = deriveSeed(STREAMS.salesperson);
  let next = shuffledKeys().find(key => !seen.includes(key));
  if (next == null) {
    seen = [];
    cycles += 1;
    next = shuffledKeys()[0];
  }
  offeredKey = next;
  seen.push(next);
}

/** The ability item on offer at the current visit, or 0 before the first. */
export function getOfferedAbilityItem(): number {
  for (const f of ABILITY_ITEM_FAMILIES) if (f.key === offeredKey) return f.plain;
  return 0;
}

registerSaveSegment('sp',
  () => {
    const parts: string[] = ['s=' + tostring(seed)];
    if (cycles > 0) parts.push('n=' + tostring(cycles));
    if (offeredKey != null) parts.push('o=' + offeredKey);
    if (seen.length > 0) parts.push('p=' + seen.join(','));
    return parts.join(';');
  },
  (raw) => {
    const fields = parseFields(raw);
    seed = tonumber(fields['s'] ?? '') ?? 0;
    cycles = tonumber(fields['n'] ?? '') ?? 0;
    const o = fields['o'];
    offeredKey = o != null && o !== '' ? o : null;
    const p = fields['p'];
    seen = p != null && p !== '' ? p.split(',') : [];
  },
  () => {
    seed = 0;
    cycles = 0;
    seen = [];
    offeredKey = null;
  },
);

/** Stock a freshly spawned salesperson with the next item of the rotation and
 *  the upgrade. Deferred a frame, as for the shop, so the adds land after the
 *  unit fully exists. */
export function stockSalesperson(salesperson: unit): void {
  advanceOffer();
  const offered = getOfferedAbilityItem();
  nextFrame(() => {
    if (!unitExists(salesperson)) return;
    AddItemToStock(salesperson, offered, 10, 10);
    AddItemToStock(salesperson, UPGRADE_PEASANT_ABILITY_ID, 10, 10);
  });
}

/** The buyer's ability item that has a Greater version, if any. */
function upgradableItem(buyer: unit): item | null {
  return findInventoryItem(buyer, id => GREATER_VERSION.has(id));
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
      const greater = CreateItem(GREATER_VERSION.get(GetItemTypeId(current))!, GetUnitX(buyer), GetUnitY(buyer))!;
      carryItemCooldown(current, greater);
      RemoveItem(current);
      UnitAddItem(buyer, greater);
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
    giveKit(seller, [{ id: itemType, charges }]);
    showFloatingText(seller, "He's not buying that!");
  });
}