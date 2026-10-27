import { Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Units } from '@objectdata/units';
import { gameState, syncState, syncGold, trySpendGold } from './state';
import {
  SHELF, ShelfItem, TRAIN_INITIAL_MAX_HP, FLAME_RESISTANCE_HP, TRACK_MANUFACTURING_MANA,
  TRACK_MANUFACTURING_MIN_MANA, RESOURCE_CAPACITY_STEP, TRACK_CAPACITY_STEP, CRATE_CAPACITY_STEP,
  CHALLENGE_BONUS,
} from './sharedData';
import { getTrain, getTrackWagon } from './train';
import { getCrateStart, loadCrateForInterRoundLobby } from './items';
import {
  SUMMON_UPGRADE_ITEM_ID, REROLL_ITEM_ID,
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, MERC_CONTRACT_ID, MERC_CONTRACT_2_ID,
  CHALLENGE_ITEM_ID, RESTORE_HP_ID, STRANGE_MEAT_ID,
} from './constants';
import { isSummonUpgradePurchased, purchaseSummonUpgrade } from './summonUpgrade';
import {
  isMercDead, buyMercContract, buySecondContract,
  canBuyMercContract, canBuySecondContract, getLivingMercCount,
} from './mercenary';
import { forceLevel3Camp, restartSparringMatch } from './creeps';
import { nextFrame, getHumanPlayers, unitExists, forEachPeasant } from './util';
import { armChallenge, getOfferedChallenge } from './challenges';
import { showChallengePreview, clearChallengePreview } from './challengeUI';
import { refreshInterRoundLobbyRoster, hasInterRoundLobbyRerollTargets } from './interRoundLobbyRoster';

/** The shelf, by item type id: price and shelf size, from sharedData's SHELF
 *  -- the same table the build sets each item's gold cost and stock from. */
const SHELF_BY_ID = new Map<number, ShelfItem>();
for (const [rawcode, item] of Object.entries(SHELF)) SHELF_BY_ID.set(FourCC(rawcode), item);

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

/** The current shop, if it is still standing. */
function liveShop(): Unit | null {
  if (currentShop == null || !unitExists(currentShop.handle)) return null;
  return currentShop;
}

/** Put an item on the current shop's shelf, as many as SHELF says it holds. */
function stock(itemTypeId: number): void {
  const shop = liveShop();
  const shelf = SHELF_BY_ID.get(itemTypeId);
  if (shop == null || shelf == null) return;
  AddItemToStock(shop.handle, itemTypeId, shelf.stock, shelf.stock);
}

/** Take an item off the current shop's shelf. */
function unstock(itemTypeId: number): void {
  const shop = liveShop();
  if (shop != null) RemoveItemFromStock(shop.handle, itemTypeId);
}

/** Whether a mercenary contract is worth anything yet.
 *
 *  A mercenary only appears alongside a hero summon, so without Summon Heroes
 *  the contract buys a companion for a fight that never happens. Hidden rather
 *  than sold-and-useless: the shelf should only ever hold things that do
 *  something when bought. */
function mercContractsUseful(): boolean {
  return isSummonUpgradePurchased();
}

/** Stock a freshly spawned shop. The shop is a MARKETPLACE-based unit, the
 *  one shop type whose dynamically added stock displays; everything for
 *  sale is added here so availability can depend on game state (one-time
 *  upgrades are simply not added once owned; the Mercenary Contract returns to
 *  the shelf whenever no living merc is under contract). Deferred a frame so
 *  the adds land after the unit fully exists. */
export function stockShop(shop: Unit): void {
  currentShop = shop;
  nextFrame(() => {
    if (liveShop() !== shop) return; // shop died/removed, or replaced
    for (const itemId of REPEATABLE_STOCK) stock(itemId);
    // Repair Train and Flame Resistance are alternatives, never both. Below the
    // starting max HP the only sensible purchase is getting that HP back, and
    // offering "+10 max HP" at the same time invites players to buy an upgrade
    // that the repair would then throw away.
    stock(gameState.trainMaxHP < TRAIN_INITIAL_MAX_HP ? RESTORE_HP_ID : FLAME_RESISTANCE_ID);
    if (!isSummonUpgradePurchased()) stock(SUMMON_UPGRADE_ITEM_ID);
    stockMercContract();
    // Strange Meat is on the shelf only with both mercenaries alive -- which is
    // the same thing as "the second contract is bought and neither has been
    // lost", and also exactly the condition under which a level 3 camp can
    // appear at all. Buying bait for a camp that cannot spawn would be a trap.
    if (getLivingMercCount() >= 2) stock(STRANGE_MEAT_ID);
    // Rerolls only make sense when there is someone standing here to reroll
    if (hasInterRoundLobbyRerollTargets()) stock(REROLL_ITEM_ID);
  });
}

/** The two contracts are steps on a ladder, so at most one is ever on the
 *  shelf: none alive offers the first, one alive offers the second, two alive
 *  offers neither. A death drops you a rung and puts that rung's contract back
 *  up. Neither is offered until Summon Heroes makes a mercenary worth having. */
function stockMercContract(): void {
  if (!mercContractsUseful()) return;
  if (canBuyMercContract()) {
    stock(MERC_CONTRACT_ID);
  } else if (canBuySecondContract()) {
    stock(MERC_CONTRACT_2_ID);
  }
}

/** Put whoever a purchase just added into the inter-round lobby, and make sure the Reroll
 *  item is on the shelf for them. Both contracts and Summon Heroes change who
 *  is standing in the corner, and the shop is an inter-round lobby fixture, so the display
 *  can catch up immediately instead of waiting for the next inter-round lobby load. */
function addRosterToInterRoundLobby(): void {
  refreshInterRoundLobbyRoster();
  // Summon Heroes is what makes a contract worth buying, so the first contract
  // goes up the moment it is owned rather than waiting for the next lobby. Only
  // the first: the second waits for a visit, as the ladder always has.
  if (mercContractsUseful() && canBuyMercContract()) stock(MERC_CONTRACT_ID);
  if (hasInterRoundLobbyRerollTargets()) stock(REROLL_ITEM_ID);
}

/** Whether the shop will honour a purchase of this item right now. One-time
 *  upgrades already owned, and contracts that cannot be signed, are not: the
 *  sale is swallowed without charging. */
function forSale(itemTypeId: number): boolean {
  if (itemTypeId === SUMMON_UPGRADE_ITEM_ID) return !isSummonUpgradePurchased();
  if (itemTypeId === MERC_CONTRACT_ID) return canBuyMercContract() && mercContractsUseful();
  if (itemTypeId === MERC_CONTRACT_2_ID) return canBuySecondContract() && mercContractsUseful();
  return true;
}

/** The units that are actually there, for the upgrade effect. */
function present(...units: Array<Unit | null>): Unit[] {
  return units.filter((u): u is Unit => u != null);
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

    // The Reroll is the one shelf item that is KEPT rather than consumed: it
    // is carried, cast, and can be sold back, all handled in reroll.ts.
    if (itemTypeId === REROLL_ITEM_ID) return;
    const shelf = SHELF_BY_ID.get(itemTypeId);
    if (shelf == null) return;
    const cost = shelf.cost;
    const buyer = Unit.fromEvent();

    if (!forSale(itemTypeId)) {
      RemoveItem(item);
      syncGold(); // put back the native gold the engine took
      return;
    }
    if (!trySpendGold(cost)) {
      RemoveItem(item);
      return;
    }

    let effectTargets: Unit[] = [];

    if (itemTypeId === FLAME_RESISTANCE_ID) {
      gameState.trainMaxHP += FLAME_RESISTANCE_HP;
      effectTargets = present(getTrain());
    } else if (itemTypeId === RESTORE_HP_ID) {
      // Back to the starting value, not to whatever it was before the fire:
      // Flame Resistance upgrades bought earlier really are lost.
      gameState.trainMaxHP = TRAIN_INITIAL_MAX_HP;
      effectTargets = present(getTrain());
      // The train is whole again, so the pair swaps back without waiting for
      // the next inter-round lobby -- otherwise repairing would cost you the chance to
      // upgrade this visit.
      stock(FLAME_RESISTANCE_ID);
    } else if (itemTypeId === TRACK_MANUFACTURING_ID) {
      gameState.trainMaxMana = Math.max(TRACK_MANUFACTURING_MIN_MANA,
        gameState.trainMaxMana - TRACK_MANUFACTURING_MANA);
      effectTargets = present(getTrain());
    } else if (itemTypeId === RESOURCE_CAPACITY_ID) {
      gameState.trainCargoMaxStack += RESOURCE_CAPACITY_STEP;
      effectTargets = present(getTrain());
    } else if (itemTypeId === TRACK_CAPACITY_ID) {
      gameState.trainTrackMaxStack += TRACK_CAPACITY_STEP;
      effectTargets = present(getTrackWagon());
    } else if (itemTypeId === CRATE_CAPACITY_ID) {
      gameState.crateMaxStack += CRATE_CAPACITY_STEP;
      // The shop is in the inter-round lobby, where the START crate displays capacity as
      // item charges — refresh it and play the effect there (the target
      // crate only exists during gameplay rounds)
      loadCrateForInterRoundLobby();
      const crateStart = getCrateStart();
      if (crateStart != null) effectTargets = [crateStart];
    } else if (itemTypeId === SUMMON_UPGRADE_ITEM_ID) {
      purchaseSummonUpgrade();
      unstock(SUMMON_UPGRADE_ITEM_ID);
      // The unlock applies to everyone — play the effect on every peasant
      const targets: Unit[] = [];
      forEachPeasant(u => targets.push(u));
      effectTargets = targets;
      // The roster is yours from this moment, so show it rather than making the
      // player finish a round to find out who they bought.
      addRosterToInterRoundLobby();
      print('Summon Heroes unlocked!');
    } else if (itemTypeId === MERC_CONTRACT_ID) {
      const wasRevive = isMercDead();
      buyMercContract();
      // Sold out until this one dies, at which point stockShop offers it again.
      unstock(MERC_CONTRACT_ID);
      // The party just changed, so the match measuring it has to start over.
      restartSparringMatch();
      addRosterToInterRoundLobby();
      print(wasRevive
        ? 'Mercenary Contract renewed: a fresh mercenary takes the job, carrying the gear the last one was holding. Level 2 creep camps are back.'
        : 'Mercenary Contract purchased: level 2 creep camps unlocked; a mercenary will join your next hero summon.');
      if (buyer != null) effectTargets = [buyer];
    } else if (itemTypeId === MERC_CONTRACT_2_ID) {
      buySecondContract();
      unstock(MERC_CONTRACT_2_ID);
      restartSparringMatch();
      addRosterToInterRoundLobby();
      print('Second Contract signed: a second mercenary joins you, and level 3 creep camps open up.');
      if (buyer != null) effectTargets = [buyer];
    } else if (itemTypeId === STRANGE_MEAT_ID) {
      if (forceLevel3Camp()) {
        print('The meat is out. Something big is coming for it -- a level 3 camp awaits.');
      } else {
        print('Nothing came for the meat.');
      }
      if (buyer != null) effectTargets = [buyer];
    } else if (itemTypeId === CHALLENGE_ITEM_ID) {
      // One item sells whatever the dealer is currently offering; which one
      // that is comes from the seeded sequence, not from the shelf.
      const offered = getOfferedChallenge();
      if (offered != null) {
        armChallenge(offered.id);
        print('|cffffcc00' + offered.name + '|r armed! ' + offered.description
          + ' Pays ' + I2S(CHALLENGE_BONUS) + ' gold.');
      }
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
  // A new dealer means a new lobby: whatever the old one was showing went with
  // the old one, and nobody can have this one selected yet.
  clearChallengePreview();
}

/** True while any player has the dealer selected. */
function dealerIsSelected(): boolean {
  const d = dealerUnit;
  if (d == null || !unitExists(d.handle)) return false;
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
 *  Shown on the SELECTED event and taken down on the DESELECTED event. An
 *  earlier version of this comment said DESELECTED does not fire when you click
 *  away, and that was a misreading. Clicking EMPTY GROUND in WC3 deselects
 *  nothing -- the dealer stays selected, so the preview correctly stays up.
 *  Clicking another unit does deselect him, and the event fires; both checked
 *  with real mouse clicks through the VM.
 *
 *  What IS true of DESELECTED is that inside its handler the engine has not
 *  finished updating the selection, so IsUnitSelected can still answer with
 *  the old state. Hence the one-frame wait before asking whether ANY player
 *  still has the dealer selected -- which still has to be asked, because the
 *  board is shared, and one player looking away must not hide it from another
 *  who is still reading. A one-shot timer, not a poll.
 *
 *  The dealer being removed with the lobby needs no case of its own: a new
 *  board starts with the preview cleared (registerDealer). */
export function initDealerOffer(): void {
  const dealerType = FourCC(Units.TombOfRelics);

  const selected = Trigger.create();
  const deselected = Trigger.create();
  Players.forEach(p => {
    selected.registerPlayerUnitEvent(p, EVENT_PLAYER_UNIT_SELECTED, undefined);
    deselected.registerPlayerUnitEvent(p, EVENT_PLAYER_UNIT_DESELECTED, undefined);
  });
  selected.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null || GetUnitTypeId(u) !== dealerType) return;
    const offered = getOfferedChallenge();
    if (offered != null) showChallengePreview(offered);
  });
  deselected.addAction(() => {
    const u = GetTriggerUnit();
    if (u == null || GetUnitTypeId(u) !== dealerType) return;
    nextFrame(() => {
      if (!dealerIsSelected()) clearChallengePreview();
    });
  });
}


