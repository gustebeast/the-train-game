import { Trigger, Unit } from 'w3ts';
import { findItemByType, registerPeasantTargetCheck, updateBuildAbility } from './items';
import { WOOD_ID, WATER_ID, BRIDGE_ABILITY_ID } from './constants';
import { nextFrame } from './util';

const BRIDGE_ORDER_ID = 852230; // fingerofdeath
const TERRAIN_BRICKS = 'Zbkl'; // Dalaran Large Bricks

export function initBridge(): void {
  // Intercept target orders for bridge spell — reject non-water targets
  registerPeasantTargetCheck(BRIDGE_ORDER_ID, t => t.typeId === WATER_ID, 'Must target a water block');

  // Consume one wood, destroy water unit, paint bridge tile
  const spellTrigger = Trigger.create();
  spellTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  spellTrigger.addAction(() => {
    if (GetSpellAbilityId() !== BRIDGE_ABILITY_ID) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null) return;

    // Consume wood (defer ability update so revoking the ability doesn't cancel this spell)
    const wood = findItemByType(u, WOOD_ID);
    if (wood != null) {
      wood.charges -= 1;
      if (wood.charges <= 0) {
        RemoveItem(wood.handle);
      }
      const uHandle = u.handle;
      nextFrame(() => {
        const deferred = Unit.fromHandle(uHandle);
        if (deferred != null) updateBuildAbility(deferred);
      });
    }

    // Replace water with bridge tile
    const targetHandle = GetSpellTargetUnit();
    if (targetHandle != null) {
      const target = Unit.fromHandle(targetHandle);
      if (target != null) {
        const tx = target.x;
        const ty = target.y;
        target.destroy();
        SetTerrainType(tx, ty, FourCC(TERRAIN_BRICKS), -1, 1, 0);
      }
    }
  });
}
