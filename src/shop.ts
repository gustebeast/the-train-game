import { Trigger, Unit } from 'w3ts';
import { gameState, syncState, TRAIN_INITIAL_MAX_HP } from './state';
import { getTrain, getTrackWagon } from './train';
import { getCrateStart, loadCrateForLobby } from './items';
import {
  SUMMON_UPGRADE_ITEM_ID, PEASANT_ID, REROLL_ITEM_ID,
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, MERC_CONTRACT_ID,
  CRITTERPOCALYPSE_ID, TOUGH_CAMP_ID, RESTORE_HP_ID,
} from './constants';
import { isSummonUpgradePurchased, purchaseSummonUpgrade, registerSummonShop } from './summonUpgrade';
import { hasActiveMerc, isMercDead, buyMercContract } from './mercenary';
import { areHeroesSpawned, getSpawnedHeroes, hadSummonLastRound } from './heroes';
import { forEachUnitInWorld, nextFrame } from './util';
import { armCritterpocalypse, armToughCamp } from './challenges';

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RESISTANCE_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
  [RESOURCE_CAPACITY_ID, 1],
  [TRACK_CAPACITY_ID, 1],
  [CRATE_CAPACITY_ID, 1],
  [SUMMON_UPGRADE_ITEM_ID, 1],
  [MERC_CONTRACT_ID, 1],
  [CRITTERPOCALYPSE_ID, 1],
  [TOUGH_CAMP_ID, 1],
  [RESTORE_HP_ID, 1],
]);

/** Repeatable upgrades every shop sells. Flame Resistance is NOT here: it is
 *  stocked conditionally, because Repair Train replaces it while the train is
 *  damaged (see stockShop). */
const REPEATABLE_STOCK = [
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
 *  upgrades are simply not added once owned; the Mercenary Contract returns to
 *  the shelf whenever no living merc is under contract). Deferred a frame so
 *  the adds land after the unit fully exists. */
export function stockShop(shop: Unit): void {
  registerSummonShop(shop);
  currentShop = shop;
  nextFrame(() => {
    if (GetUnitTypeId(shop.handle) === 0) return; // shop died/removed
    for (const itemId of REPEATABLE_STOCK) {
      AddItemToStock(shop.handle, itemId, 10, 10);
    }
    // Repair Train and Flame Resistance are alternatives, never both. Below the
    // starting max HP the only sensible purchase is getting that HP back, and
    // offering "+10 max HP" at the same time invites players to buy an upgrade
    // that the repair would then throw away.
    if (gameState.trainMaxHP < TRAIN_INITIAL_MAX_HP) {
      AddItemToStock(shop.handle, RESTORE_HP_ID, 1, 1);
    } else {
      AddItemToStock(shop.handle, FLAME_RESISTANCE_ID, 10, 10);
    }
    if (!isSummonUpgradePurchased()) {
      AddItemToStock(shop.handle, SUMMON_UPGRADE_ITEM_ID, 1, 1);
    }
    // On sale whenever there is no living merc -- that is the first hire AND
    // the revive after one dies.
    if (!hasActiveMerc()) {
      AddItemToStock(shop.handle, MERC_CONTRACT_ID, 1, 1);
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
    const item = GetManipulatedItem();
    if (item == null) return;
    const itemTypeId = GetItemTypeId(item);

    const cost = ITEM_COSTS.get(itemTypeId);
    if (cost == null) return;

    // One-time upgrades already owned — swallow the item without charging
    if (itemTypeId === SUMMON_UPGRADE_ITEM_ID && isSummonUpgradePurchased()) {
      RemoveItem(item);
      return;
    }
    if (itemTypeId === MERC_CONTRACT_ID && hasActiveMerc()) {
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
    } else if (itemTypeId === RESTORE_HP_ID) {
      // Back to the starting value, not to whatever it was before the fire:
      // Flame Resistance upgrades bought earlier really are lost.
      gameState.trainMaxHP = TRAIN_INITIAL_MAX_HP;
      effectTargets = [getTrain()];
      // The train is whole again, so the pair swaps back without waiting for
      // the next lobby -- otherwise repairing would cost you the chance to
      // upgrade this visit.
      if (currentShop != null) {
        AddItemToStock(currentShop.handle, FLAME_RESISTANCE_ID, 10, 10);
      }
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
      const wasRevive = isMercDead();
      buyMercContract();
      // Sold out until this one dies, at which point stockShop offers it again.
      if (currentShop != null && GetUnitTypeId(currentShop.handle) !== 0) {
        RemoveItemFromStock(currentShop.handle, MERC_CONTRACT_ID);
      }
      print(wasRevive
        ? 'Mercenary Contract renewed: a fresh mercenary takes the job, carrying the gear the last one was holding. Level 2 creep camps are back.'
        : 'Mercenary Contract purchased: level 2 creep camps unlocked; a mercenary will join your next hero summon.');
      const contractBuyer = Unit.fromHandle(GetTriggerUnit());
      if (contractBuyer != null) effectTargets = [contractBuyer];
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
  });
}
