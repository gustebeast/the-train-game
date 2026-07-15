import { Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { gameState, syncState } from './state';
import { getTrain, getTrackWagon } from './train';
import { getCrate } from './items';
import { buyMercContract, rerollMerc } from './mercenary';
import { areHeroesSpawned, getSpawnedHeroes } from './heroes';

const FLAME_RESISTANCE_ID = FourCC(Items.AncientFigurine);
const TRACK_MANUFACTURING_ID = FourCC(Items.BracerOfAgility);
const RESOURCE_CAPACITY_ID = FourCC(Items.DruidPouch);
const TRACK_CAPACITY_ID = FourCC(Items.JadeRing);
const CRATE_CAPACITY_ID = FourCC(Items.LionsRing);
const MERC_CONTRACT_ID = FourCC(Items.MedallionOfCourage);
const MERC_REROLL_ID = FourCC(Items.HoodOfCunning);

const ITEM_COSTS: Map<number, number> = new Map([
  [FLAME_RESISTANCE_ID, 1],
  [TRACK_MANUFACTURING_ID, 1],
  [RESOURCE_CAPACITY_ID, 1],
  [TRACK_CAPACITY_ID, 1],
  [CRATE_CAPACITY_ID, 1],
  [MERC_CONTRACT_ID, 1],
  [MERC_REROLL_ID, 1],
]);

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
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  t.addAction(() => {
    const item = GetManipulatedItem();
    if (item == null) return;
    const itemTypeId = GetItemTypeId(item);

    const cost = ITEM_COSTS.get(itemTypeId);
    if (cost == null) return;
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
      const crate = getCrate();
      if (crate != null) effectTargets = [crate];
    } else if (itemTypeId === MERC_CONTRACT_ID) {
      if (buyMercContract()) {
        print('Mercenary Contract purchased: level 2 creep camps unlocked; a mercenary will join your next hero summon.');
        const buyer = Unit.fromHandle(GetTriggerUnit());
        if (buyer != null) effectTargets = [buyer];
      } else {
        gameState.gold += cost; // already owned — refund
        print('Mercenary Contract is already owned.');
      }
    } else if (itemTypeId === MERC_REROLL_ID) {
      // If a dead merc is replaced mid-fight, spawn the new one at a living
      // hero (the fight is at the camp, not the shop); fall back to the buyer
      const buyer = Unit.fromHandle(GetTriggerUnit());
      let bx = buyer != null ? buyer.x : 0;
      let by = buyer != null ? buyer.y : 0;
      for (const h of getSpawnedHeroes()) {
        if (GetUnitState(h.handle, UNIT_STATE_LIFE) > 0) {
          bx = h.x;
          by = h.y;
          break;
        }
      }
      if (rerollMerc(bx, by, areHeroesSpawned())) {
        print('Mercenary rerolled — items carry over to the new creep.');
        if (buyer != null) effectTargets = [buyer];
      } else {
        gameState.gold += cost; // requires the contract — refund
        print('Reroll Mercenary requires the Mercenary Contract.');
      }
    }

    syncState();
    playUpgradeEffect(effectTargets);
    RemoveItem(item);
  });
}
