import { registerPeasantTargetCheck, swapCarriedItem } from './items';
import { BUCKET_ID, BUCKET_FULL_ID, WATER_ID, FILL_ABILITY_ID } from './constants';
import { onSpellEffect } from './util';

export function initFill(): void {
  // The fill spell is ShadowStrike underneath, so it is ordered as one.
  registerPeasantTargetCheck(OrderId('shadowstrike'), t => t.typeId === WATER_ID, 'Must target a water block');

  onSpellEffect(FILL_ABILITY_ID, u => {
    swapCarriedItem(u, BUCKET_ID, BUCKET_FULL_ID);
  });
}
