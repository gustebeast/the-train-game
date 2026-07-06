import { Item, Trigger, Unit } from 'w3ts';
import { findItemByType, registerPeasantTargetCheck, updateBuildAbility } from './items';
import { BUCKET_ID, BUCKET_FULL_ID, WATER_ID, FILL_ABILITY_ID } from './constants';
import { updateCarryingVisual } from './carrying';
import { nextFrame } from './util';

const FILL_ORDER_ID = 852527; // shadowstrike

export function initFill(): void {
  // Intercept target orders — reject non-water targets
  registerPeasantTargetCheck(FILL_ORDER_ID, t => t.typeId === WATER_ID, 'Must target a water block');

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

    const fullBucket = Item.create(BUCKET_FULL_ID, u.x, u.y);
    if (fullBucket != null) {
      UnitAddItem(u.handle, fullBucket.handle);
    }

    // Defer ability/visual update so this spell's completion isn't interrupted
    const uHandle = u.handle;
    nextFrame(() => {
      const deferred = Unit.fromHandle(uHandle);
      if (deferred != null) {
        updateBuildAbility(deferred);
        updateCarryingVisual(deferred);
      }
    });
  });
}
