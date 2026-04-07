import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { findItemByType, rejectOrder, updateBuildAbility } from './items';
import { BUCKET_ID, PEASANT_ID } from './constants';
import { updateCarryingVisual } from './carrying';

const FILL_ORDER_ID = 852527; // shadowstrike
const FILL_ABILITY_ID = FourCC(Abilities.UndefinedNeutralHostile);
const WATER_ID = FourCC(Units.Burrow);

export function initFill(): void {
  // Intercept target orders — reject non-water targets
  const orderTrigger = Trigger.create();
  orderTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  orderTrigger.addAction(() => {
    if (GetIssuedOrderId() !== FILL_ORDER_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null || unit.typeId !== PEASANT_ID) return;

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;

    if (target.typeId !== WATER_ID) {
      rejectOrder(unit.handle, 'Must target a water block');
    }
  });

  // Swap empty bucket for full bucket
  const spellTrigger = Trigger.create();
  spellTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  spellTrigger.addAction(() => {
    if (GetSpellAbilityId() !== FILL_ABILITY_ID) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null) return;

    const bucket = findItemByType(u, BUCKET_ID);
    if (bucket == null) return;
    RemoveItem(bucket.handle);

    const fullBucket = Item.create(FourCC(Items.FullVial), u.x, u.y);
    if (fullBucket != null) {
      UnitAddItem(u.handle, fullBucket.handle);
    }

    // Defer ability/visual update so this spell's completion isn't interrupted
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
