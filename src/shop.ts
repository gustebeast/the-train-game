import { Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Units } from '@objectdata/units';
import { gameState, syncState, TRAIN_INITIAL_MAX_HP } from './state';
import { getTrain, getTrackWagon } from './train';
import { getCrateStart, loadCrateForInterRoundLobby } from './items';
import {
  SUMMON_UPGRADE_ITEM_ID, PEASANT_ID, REROLL_ITEM_ID,
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, MERC_CONTRACT_ID, MERC_CONTRACT_2_ID,
  CHALLENGE_ITEM_ID, RESTORE_HP_ID,
} from './constants';
import { isSummonUpgradePurchased, purchaseSummonUpgrade, registerSummonShop } from './summonUpgrade';
import {
  isMercDead, buyMercContract, buySecondContract,
  canBuyMercContract, canBuySecondContract,
} from './mercenary';
import { areHeroesSpawned, getSpawnedHeroes } from './heroes';
import { forEachUnitInWorld, nextFrame, getHumanPlayers } from './util';
import { armChallenge, getOfferedChallenge, CHALLENGE_COST } from './challenges';
import { onGlobalTick } from './globalTick';
import { showChallengePreview, clearChallengePreview } from './challengeUI';
import { refreshInterRoundLobbyRoster, hasInterRoundLobbyRerollTargets } from './interRoundLobbyRoster';

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RESISTANCE_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
  [RESOURCE_CAPACITY_ID, 1],
  [TRACK_CAPACITY_ID, 1],
  [CRATE_CAPACITY_ID, 1],
  [SUMMON_UPGRADE_ITEM_ID, 1],
  [MERC_CONTRACT_ID, 1],
  [MERC_CONTRACT_2_ID, 1],
  [CHALLENGE_ITEM_ID, CHALLENGE_COST],
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
    // The two contracts are steps on a ladder, so exactly one is ever on the
    // shelf: none alive offers the first, one alive offers the second, two
    // alive offers neither. A death drops you a rung and puts that rung's
    // contract back up.
    if (canBuyMercContract()) {
      AddItemToStock(shop.handle, MERC_CONTRACT_ID, 1, 1);
    } else if (canBuySecondContract()) {
      AddItemToStock(shop.handle, MERC_CONTRACT_2_ID, 1, 1);
    }
    // Rerolls only make sense when there is someone standing here to reroll
    if (hasInterRoundLobbyRerollTargets()) {
      AddItemToStock(shop.handle, REROLL_ITEM_ID, 10, 10);
    }
  });
}

/** Put whoever a purchase just added into the inter-round lobby, and make sure the Reroll
 *  item is on the shelf for them. Both contracts and Summon Heroes change who
 *  is standing in the corner, and the shop is an inter-round lobby fixture, so the display
 *  can catch up immediately instead of waiting for the next inter-round lobby load. */
function addRosterToInterRoundLobby(): void {
  refreshInterRoundLobbyRoster();
  if (currentShop != null && GetUnitTypeId(currentShop.handle) !== 0
      && hasInterRoundLobbyRerollTargets()) {
    AddItemToStock(currentShop.handle, REROLL_ITEM_ID, 10, 10);
  }
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
    if (itemTypeId === MERC_CONTRACT_ID && !canBuyMercContract()) {
      RemoveItem(item);
      return;
    }
    if (itemTypeId === MERC_CONTRACT_2_ID && !canBuySecondContract()) {
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
      // the next inter-round lobby -- otherwise repairing would cost you the chance to
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
      // The shop is in the inter-round lobby, where the START crate displays capacity as
      // item charges — refresh it and play the effect there (the target
      // crate from getCrate() only exists during gameplay rounds)
      loadCrateForInterRoundLobby();
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
      // The roster is yours from this moment, so show it rather than making the
      // player finish a round to find out who they bought.
      addRosterToInterRoundLobby();
      print('Summon Heroes unlocked!');
    } else if (itemTypeId === MERC_CONTRACT_ID) {
      const wasRevive = isMercDead();
      buyMercContract();
      // Sold out until this one dies, at which point stockShop offers it again.
      if (currentShop != null && GetUnitTypeId(currentShop.handle) !== 0) {
        RemoveItemFromStock(currentShop.handle, MERC_CONTRACT_ID);
      }
      addRosterToInterRoundLobby();
      print(wasRevive
        ? 'Mercenary Contract renewed: a fresh mercenary takes the job, carrying the gear the last one was holding. Level 2 creep camps are back.'
        : 'Mercenary Contract purchased: level 2 creep camps unlocked; a mercenary will join your next hero summon.');
      const contractBuyer = Unit.fromHandle(GetTriggerUnit());
      if (contractBuyer != null) effectTargets = [contractBuyer];
    } else if (itemTypeId === MERC_CONTRACT_2_ID) {
      buySecondContract();
      if (currentShop != null && GetUnitTypeId(currentShop.handle) !== 0) {
        RemoveItemFromStock(currentShop.handle, MERC_CONTRACT_2_ID);
      }
      addRosterToInterRoundLobby();
      print('Second Contract signed: a second mercenary joins you, and level 3 creep camps open up.');
      const secondBuyer = Unit.fromHandle(GetTriggerUnit());
      if (secondBuyer != null) effectTargets = [secondBuyer];
    } else if (itemTypeId === CHALLENGE_ITEM_ID) {
      // One item sells whatever the dealer is currently offering; which one
      // that is comes from the seeded sequence, not from the shelf.
      const offered = getOfferedChallenge();
      if (offered != null) {
        armChallenge(offered.id);
        print('|cffffcc00' + offered.name + '|r armed! ' + offered.description
          + ' Pays 2 gold.');
      }
      const buyer = Unit.fromEvent();
      if (buyer != null) effectTargets = [buyer];
    }

    syncState();
    playUpgradeEffect(effectTargets);
    RemoveItem(item);
  });
}

/** The dealer standing in the current inter-round lobby, if there is one. */
let dealerUnit: Unit | null = null;

/** Remember this inter-round lobby's dealer, so the overlay can tell when he is selected. */
export function registerDealer(dealer: Unit): void {
  dealerUnit = dealer;
}

/** True while any player has the dealer selected. */
function dealerIsSelected(): boolean {
  const d = dealerUnit;
  if (d == null || GetUnitTypeId(d.handle) === 0) return false;
  for (const p of getHumanPlayers()) {
    if (IsUnitSelected(d.handle, p.handle)) return true;
  }
  return false;
}

/** Show the dealer's current offer in the challenge overlay while he is
 *  selected.
 *
 *  The obvious place would be the item's own tooltip in the shop, and that is
 *  the one place it cannot go: a shop button is drawn from the item TYPE's
 *  object data, which is baked at build time, and the tooltip natives
 *  (BlzSetItemTooltip and friends) only take an item INSTANCE -- something on
 *  the ground or in an inventory, which stock is not.
 *
 *  Selection is the trigger because clicking the dealer is already the gesture
 *  for "what have you got?". Earlier attempts said it in chat -- on entering
 *  the inter-round lobby, which was noise, then on selection, which needed a cooldown to
 *  survive a stray double-click. A panel needs neither: re-selecting redraws
 *  the same thing, and it goes away when you look away.
 *
 *  Shown on the SELECTED event so it appears the instant you click, but taken
 *  down by asking the engine who is selected rather than by trusting the
 *  DESELECTED event -- which was measured not firing when clicking away from
 *  the dealer, leaving the panel stuck up. Asking cannot miss an edge. */
export function initDealerOffer(): void {
  const dealerType = FourCC(Units.TombOfRelics);

  const selected = Trigger.create();
  Players.forEach(p => {
    TriggerRegisterPlayerUnitEvent(selected.handle, p.handle, EVENT_PLAYER_UNIT_SELECTED, undefined);
  });
  selected.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null || GetUnitTypeId(u) !== dealerType) return;
    const offered = getOfferedChallenge();
    if (offered != null) showChallengePreview(offered);
  });

  onGlobalTick(() => {
    if (!dealerIsSelected()) clearChallengePreview();
  });
}


