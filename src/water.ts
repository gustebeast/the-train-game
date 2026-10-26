import { getTrain, extinguish } from './train';
import { isTrain, registerPeasantTargetCheck, swapCarriedItem } from './items';
import { BUCKET_ID, BUCKET_FULL_ID, WATER_TRAIN_ABILITY_ID } from './constants';
import { noteWateredTrain } from './tutorialBoard';
import { onSpellEffect } from './util';

export function initWaterTrain(): void {
  // The water spell is Drunken Haze underneath, so it is ordered as one.
  registerPeasantTargetCheck(OrderId('drunkenhaze'), t => isTrain(t), 'Must target the train');

  // Pour the full bucket over the train: back to full HP, fire out.
  onSpellEffect(WATER_TRAIN_ABILITY_ID, u => {
    if (!swapCarriedItem(u, BUCKET_FULL_ID, BUCKET_ID)) return;
    noteWateredTrain(u.owner.id);
    extinguish();
    const train = getTrain();
    SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);
    // Remove the Drunken Haze buff/ability from the train so it doesn't slow it
    UnitRemoveAbility(train.handle, WATER_TRAIN_ABILITY_ID);
    UnitRemoveBuffs(train.handle, false, true); // remove negative buffs
  });
}
