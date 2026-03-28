import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import {
  TRACK_PIECE_ID,
  getSlot0Item,
  giveToStorage,
  isStorage,
  isTrain,
  rejectOrder,
  takeFromStorage,
  updateBuildAbility,
  validateGive,
  validateTake,
} from './items';
import { updateCarryingVisual } from './carrying';
import { isBurning, isInGameplay } from './train';


const CHANNEL_ORDER_ID = 852600;
const SMART_ORDER_ID = 851971;
const GIVE_TAKE_ABILITY_ID = FourCC(Abilities.Channel);

export function initGiveTake(): void {
  // --- Intercept Channel spell point orders ---
  const pointOrder = Trigger.create();
  pointOrder.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  pointOrder.addAction(() => {
    if (GetIssuedOrderId() !== CHANNEL_ORDER_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null) return;
    if (!isInGameplay()) {
      rejectOrder(unit.handle, 'Can only be used during gameplay!');
      return;
    }

    const item = getSlot0Item(unit);
    if (item == null) return; // No item = nothing to drop at a point

    const x = GetOrderPointX();
    const y = GetOrderPointY();
    const unitHandle = unit.handle;
    const itemHandle = item.handle;
    const t = Timer.create();
    t.start(0, false, () => {
      UnitDropItemPoint(unitHandle, itemHandle, x, y);
      t.destroy();
    });
  });

  // --- Intercept Channel spell target orders ---
  const targetOrder = Trigger.create();
  targetOrder.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  targetOrder.addAction(() => {
    if (GetIssuedOrderId() !== CHANNEL_ORDER_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null) return;
    if (!isInGameplay()) {
      rejectOrder(unit.handle, 'Can only be used during gameplay!');
      return;
    }

    // Targeting an item on the ground — always pick it up
    const targetItem = GetOrderTargetItem();
    if (targetItem != null) {
      const unitHandle = unit.handle;
      const t = Timer.create();
      t.start(0, false, () => {
        IssueTargetOrderById(unitHandle, SMART_ORDER_ID, targetItem);
        t.destroy();
      });
      return;
    }

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;
    const item = getSlot0Item(unit);

    // Take flow: empty hand + storage, or holding tracks + train
    if ((item != null && item.typeId === TRACK_PIECE_ID && isTrain(target))
        || (item == null && isStorage(target))) {
      if (isTrain(target) && isBurning()) {
        rejectOrder(unit.handle, 'The train is on fire!');
        return;
      }
      const rejection = validateTake(unit, target);
      if (rejection != null) {
        rejectOrder(unit.handle, rejection);
      }
      return;
    }

    // Empty hand + non-storage target → reject
    if (item == null) {
      rejectOrder(unit.handle, "Can't take from that!");
      return;
    }

    // Give flow — pre-validate before walking, execute in SPELL_CHANNEL
    const rejection = validateGive(item.typeId, target);
    if (rejection != null) {
      rejectOrder(unit.handle, rejection);
    }
    // If valid, Channel spell walks up and SPELL_CHANNEL handles the give
  });

  // --- SPELL_CHANNEL: execute take when unit arrives in range ---
  const channelTrigger = Trigger.create();
  channelTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_CHANNEL);
  channelTrigger.addAction(() => {
    if (GetSpellAbilityId() !== GIVE_TAKE_ABILITY_ID) return;
    const unit = Unit.fromEvent();
    if (unit == null) return;

    const targetUnit = GetSpellTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;
    if (!isStorage(target)) return;

    const item = getSlot0Item(unit);

    if (item != null && item.typeId === TRACK_PIECE_ID && isTrain(target)) {
      // Take tracks from train — re-validate in case order-time rejection lost the race
      if (validateTake(unit, target) == null) {
        takeFromStorage(unit, target);
        updateBuildAbility(unit);
        updateCarryingVisual(unit);
      }
    } else if (item == null) {
      // Take from storage (empty hand)
      takeFromStorage(unit, target);
      updateBuildAbility(unit);
      updateCarryingVisual(unit);
    } else if (item != null && isStorage(target)) {
      // Give item to storage — re-validate in case order-time rejection lost the race
      if (validateGive(item.typeId, target) == null) {
        giveToStorage(unit, item, target);
        updateBuildAbility(unit);
        updateCarryingVisual(unit);
      }
    }
  });
}
