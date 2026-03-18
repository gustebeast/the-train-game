import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { WOOD_ID, findItemByType, rejectOrder, updateBuildAbility } from './items';

const BRIDGE_ORDER_ID = 852662; // acidbomb
const BRIDGE_ABILITY_ID = FourCC(Abilities.AcidBomb);
const WATER_ID = FourCC(Units.Burrow);
const TERRAIN_BRICKS = 'Zbkl'; // Dalaran Large Bricks

export function initBridge(): void {
  // Intercept target orders for bridge spell — reject non-water targets
  const orderTrigger = Trigger.create();
  orderTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  orderTrigger.addAction(() => {
    if (GetIssuedOrderId() !== BRIDGE_ORDER_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null) return;

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;

    if (target.typeId !== WATER_ID) {
      rejectOrder(unit.handle, 'Must target a water block');
    }
  });

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
      const t = Timer.create();
      t.start(0, false, () => {
        const deferred = Unit.fromHandle(uHandle);
        if (deferred != null) updateBuildAbility(deferred);
        t.destroy();
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
