import { Item, Trigger, Unit } from 'w3ts';
import { getTrain, extinguish } from './train';
import { findItemByType, isTrain, refreshCarrierNextFrame, registerPeasantTargetCheck } from './items';
import { BUCKET_ID, BUCKET_FULL_ID, WATER_TRAIN_ABILITY_ID } from './constants';
import { noteWateredTrain } from './tutorialBoard';

const WATER_TRAIN_ORDER_ID = 852585; // drunkenhaze

export function initWaterTrain(): void {
  // Intercept target orders — reject non-train targets
  registerPeasantTargetCheck(WATER_TRAIN_ORDER_ID, t => isTrain(t), 'Must target the train');

  // Swap full bucket for empty bucket, restore train HP to full
  const spellTrigger = Trigger.create();
  spellTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  spellTrigger.addAction(() => {
    if (GetSpellAbilityId() !== WATER_TRAIN_ABILITY_ID) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null) return;

    const bucketFull = findItemByType(u, BUCKET_FULL_ID);
    if (bucketFull == null) return;
    RemoveItem(bucketFull.handle);

    const emptyBucket = Item.create(BUCKET_ID, u.x, u.y);
    if (emptyBucket != null) {
      UnitAddItem(u.handle, emptyBucket.handle);
    }

    noteWateredTrain(u.owner.id);
    extinguish();
    const train = getTrain();
    SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
    // Remove the Drunken Haze buff/ability from the train so it doesn't slow it
    UnitRemoveAbility(train.handle, WATER_TRAIN_ABILITY_ID);
    UnitRemoveBuffs(train.handle, false, true); // remove negative buffs

    refreshCarrierNextFrame(u.handle);
  });
}
