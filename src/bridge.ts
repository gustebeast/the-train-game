import { Unit } from 'w3ts';
import { refreshCarrierNextFrame, registerPeasantTargetCheck, spendCharge } from './items';
import { WOOD_ID, WATER_ID, BRIDGE_ABILITY_ID } from './constants';
import { noteBuiltBridge } from './tutorialBoard';
import { onSpellEffect } from './util';
import { FIXED_TILES } from './terrain/tiles';

export function initBridge(): void {
  // The bridge spell is Finger of Death underneath, so it is ordered as one.
  registerPeasantTargetCheck(OrderId('fingerofdeath'), t => t.typeId === WATER_ID, 'Must target a water block');

  // Consume one wood, destroy the water unit, paint a bridge tile
  onSpellEffect(BRIDGE_ABILITY_ID, u => {
    // Defer the ability update: revoking the ability cancels this very spell
    if (spendCharge(u, WOOD_ID)) refreshCarrierNextFrame(u.handle);

    const target = Unit.fromHandle(GetSpellTargetUnit());
    if (target == null) return;
    const tx = target.x;
    const ty = target.y;
    target.destroy();
    SetTerrainType(tx, ty, FourCC(FIXED_TILES.bridge), -1, 1, 0);
    noteBuiltBridge(u.owner.id);
  });
}
