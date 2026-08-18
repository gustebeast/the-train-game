import { Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { gameState, syncState } from './state';
import { getTrain, getTrackWagon } from './train';
import { getCrateStart, loadCrateForLobby } from './items';
import { SUMMON_UPGRADE_ITEM_ID, PEASANT_ID, REROLL_ITEM_ID } from './constants';
import { isSummonUpgradePurchased, purchaseSummonUpgrade, registerSummonShop } from './summonUpgrade';
import { isMercUpgradeBought, buyMercContract, rerollMerc } from './mercenary';
import { areHeroesSpawned, getSpawnedHeroes, hadSummonLastRound } from './heroes';
import { forEachUnitInWorld, nextFrame } from './util';
import { armCritterpocalypse, armToughCamp } from './challenges';
import { onGlobalTick } from './globalTick';

const FLAME_RESISTANCE_ID = FourCC(Items.AncientFigurine);
const TRACK_MANUFACTURING_ID = FourCC(Items.BracerOfAgility);
const RESOURCE_CAPACITY_ID = FourCC(Items.DruidPouch);
const TRACK_CAPACITY_ID = FourCC(Items.JadeRing);
const CRATE_CAPACITY_ID = FourCC(Items.LionsRing);
const MERC_CONTRACT_ID = FourCC(Items.MogrinsReport);
const MERC_REROLL_ID = FourCC(Items.HoodOfCunning);
const CRITTERPOCALYPSE_ID = FourCC(Items.MedallionOfCourage);
const TOUGH_CAMP_ID = FourCC(Items.PeriaptOfVitality);

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RESISTANCE_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
  [RESOURCE_CAPACITY_ID, 1],
  [TRACK_CAPACITY_ID, 1],
  [CRATE_CAPACITY_ID, 1],
  [SUMMON_UPGRADE_ITEM_ID, 1],
  [MERC_CONTRACT_ID, 1],
  [MERC_REROLL_ID, 1],
  [CRITTERPOCALYPSE_ID, 1],
  [TOUGH_CAMP_ID, 1],
]);

/** Repeatable upgrades every shop sells. */
const REPEATABLE_STOCK = [
  FLAME_RESISTANCE_ID,
  TRACK_MANUFACTURING_ID,
  RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID,
  CRATE_CAPACITY_ID,
];

/** The current shop unit, so purchases can adjust its stock. */
let currentShop: Unit | null = null;

/** Stock a freshly spawned shop. The shop is a MARKETPLACE-based unit, the
 *  one shop type whose dynamically added stock displays; everything for
 *  sale is added here so availability can depend on game state (one-time
 *  upgrades are simply not added once owned; Reroll Mercenary only appears
 *  once the contract is owned). Deferred a frame so the adds land after
 *  the unit fully exists. */
export function stockShop(shop: Unit): void {
  registerSummonShop(shop);
  currentShop = shop;
  nextFrame(() => {
    if (GetUnitTypeId(shop.handle) === 0) return; // shop died/removed
    for (const itemId of REPEATABLE_STOCK) {
      AddItemToStock(shop.handle, itemId, 10, 10);
    }
    if (!isSummonUpgradePurchased()) {
      AddItemToStock(shop.handle, SUMMON_UPGRADE_ITEM_ID, 1, 1);
    }
    if (!isMercUpgradeBought()) {
      AddItemToStock(shop.handle, MERC_CONTRACT_ID, 1, 1);
    } else {
      AddItemToStock(shop.handle, MERC_REROLL_ID, 10, 10);
    }
    // Rerolls only make sense when last round's heroes stand in the lobby
    if (hadSummonLastRound()) {
      AddItemToStock(shop.handle, REROLL_ITEM_ID, 10, 10);
    }
  });
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
  // Kill Blizzard.j's neutral-shop machinery (InitNeutralBuildings) — both
  // halves would corrupt our MARKETPLACE-based shop:
  // - RemovePurchasedItem strips a sold item type from a neutral passive
  //   seller's stock, permanently deleting trigger-added slots after one sale
  // - the rotation timer would AddItemToStock random creep-drop items into
  //   every marketplace-classified unit (i.e. our shop) from 120s onward
  if (bj_stockItemPurchased != null) DestroyTrigger(bj_stockItemPurchased);
  if (bj_stockUpdateTimer != null) DestroyTimer(bj_stockUpdateTimer);

  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  t.addAction(() => {
    resolvePurchase(GetManipulatedItem(), Unit.fromHandle(GetTriggerUnit()));
  });

  // A purchase made with the SHOP selected has no buying unit, so WC3 drops the
  // item on the ground and fires NO event at all (neither SELL_ITEM nor
  // PICKUP_ITEM — both measured as zero in-game). Without this sweep the
  // upgrade only applied if the player then walked over and picked the item up.
  // Resolving it from the ground makes every purchase take effect immediately.
  onGlobalTick(collectShopDrops);
}

/** Apply a purchased shop item. `buyer` is whoever picked it up, or the unit we
 *  attribute a shop-side (ground) purchase to — it is only used to aim the
 *  purchase effect, so having none is fine. */
function resolvePurchase(item: item | undefined, buyer: Unit | undefined): void {
  if (item == null) return;
  const itemTypeId = GetItemTypeId(item);

  const cost = ITEM_COSTS.get(itemTypeId);
  if (cost == null) return;

  // One-time upgrades already owned — swallow the item without charging
  if (itemTypeId === SUMMON_UPGRADE_ITEM_ID && isSummonUpgradePurchased()) {
    RemoveItem(item);
    return;
  }
  if (itemTypeId === MERC_CONTRACT_ID && isMercUpgradeBought()) {
    RemoveItem(item);
    return;
  }
  // Reroll is only stocked once the contract is owned, but guard anyway
  if (itemTypeId === MERC_REROLL_ID && !isMercUpgradeBought()) {
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
  } else if (itemTypeId === MERC_CONTRACT_ID) {
    buyMercContract();
    // Stop selling the contract; start selling rerolls
    if (currentShop != null && GetUnitTypeId(currentShop.handle) !== 0) {
      RemoveItemFromStock(currentShop.handle, MERC_CONTRACT_ID);
      AddItemToStock(currentShop.handle, MERC_REROLL_ID, 10, 10);
    }
    print('Mercenary Contract purchased: level 2 creep camps unlocked; a mercenary will join your next hero summon.');
    if (buyer != null) effectTargets = [buyer];
  } else if (itemTypeId === MERC_REROLL_ID) {
    // If a dead merc is replaced mid-fight, spawn the new one at a living
    // hero (the fight is at the camp, not the shop); fall back to the buyer
    let bx = buyer != null ? buyer.x : 0;
    let by = buyer != null ? buyer.y : 0;
    for (const h of getSpawnedHeroes()) {
      if (GetUnitState(h.handle, UNIT_STATE_LIFE) > 0) {
        bx = h.x;
        by = h.y;
        break;
      }
    }
    rerollMerc(bx, by, areHeroesSpawned());
    print('Mercenary rerolled — items carry over to the new creep.');
    if (buyer != null) effectTargets = [buyer];
  } else if (itemTypeId === CRITTERPOCALYPSE_ID) {
    armCritterpocalypse();
    print('Critterpocalypse armed! Every grass tile spawns a critter next round — win it for 2 bonus gold.');
    const buyer = Unit.fromEvent();
    if (buyer != null) effectTargets = [buyer];
  } else if (itemTypeId === TOUGH_CAMP_ID) {
    armToughCamp();
    print("Tough Creep Camp armed! Next round's camp hits far harder — defeat it for 2 bonus gold.");
    const buyer = Unit.fromEvent();
    if (buyer != null) effectTargets = [buyer];
  }

  syncState();
  playUpgradeEffect(effectTargets);
  RemoveItem(item);
}

/** Radius around the shop searched for just-purchased items lying on the
 *  ground. Generous: WC3 scatters the drop around the building's footprint. */
const SHOP_DROP_RADIUS = 512;

/** Resolve any shop stock sitting on the ground next to the shop. Shop items
 *  are all consumed the instant they are acquired, so anything of a for-sale
 *  type lying here is a purchase that never reached a buyer. */
function collectShopDrops(): void {
  const shop = currentShop;
  if (shop == null || GetUnitTypeId(shop.handle) === 0) return;
  const sx = shop.x;
  const sy = shop.y;

  const rect = Rect(sx - SHOP_DROP_RADIUS, sy - SHOP_DROP_RADIUS,
                    sx + SHOP_DROP_RADIUS, sy + SHOP_DROP_RADIUS);
  const dropped: item[] = [];
  EnumItemsInRect(rect, undefined, () => {
    const it = GetEnumItem();
    if (it == null) return;
    // Ignore items already held by a unit; only loose ground items are drops.
    if (ITEM_COSTS.get(GetItemTypeId(it)) != null && !IsItemOwned(it)) dropped.push(it);
  });
  RemoveRect(rect);
  if (dropped.length === 0) return;

  // Attribute the purchase to the nearest peasant purely so the effect has
  // something to play on (the shop-selected purchase names no buyer).
  let buyer: Unit | undefined = undefined;
  let bestDist = 0;
  forEachUnitInWorld(u => {
    if (GetUnitTypeId(u) !== PEASANT_ID) return;
    const dx = GetUnitX(u) - sx;
    const dy = GetUnitY(u) - sy;
    const d = dx * dx + dy * dy;
    if (buyer == null || d < bestDist) {
      bestDist = d;
      buyer = Unit.fromHandle(u);
    }
  });

  for (const it of dropped) resolvePurchase(it, buyer);
}
