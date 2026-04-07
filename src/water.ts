import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { getTrain, extinguish } from './train';
import { isTrain, findItemByType, rejectOrder, updateBuildAbility } from './items';
import { BUCKET_FULL_ID, PEASANT_ID } from './constants';
import { updateCarryingVisual } from './carrying';

const WATER_TRAIN_ORDER_ID = 852585; // drunkenhaze
const WATER_TRAIN_ABILITY_ID = FourCC(Abilities.DrunkenHazeChen);

export function initWaterTrain(): void {
  // Intercept target orders — reject non-train targets
  const orderTrigger = Trigger.create();
  orderTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  orderTrigger.addAction(() => {
    if (GetIssuedOrderId() !== WATER_TRAIN_ORDER_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null || unit.typeId !== PEASANT_ID) return;

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;

    if (!isTrain(target)) {
      rejectOrder(unit.handle, 'Must target the train');
    }
  });

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

    const emptyBucket = Item.create(FourCC(Items.EmptyVial), u.x, u.y);
    if (emptyBucket != null) {
      UnitAddItem(u.handle, emptyBucket.handle);
    }

    extinguish();
    const train = getTrain();
    SetUnitState(train.handle, UNIT_STATE_LIFE, train.maxLife);

    const uHandle = u.handle;
    const t = Timer.create();
    t.start(0, false, () => {
      const deferred = Unit.fromHandle(uHandle);
      if (deferred != null) {
        updateBuildAbility(deferred);
        updateCarryingVisual(deferred);
      }
      t.destroy();
    });
  });
}
