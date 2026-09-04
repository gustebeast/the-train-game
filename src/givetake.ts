import { noteLoadedMaterial } from './tutorialBoard';
import { Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { nextFrame } from './util';
import { getSlot0Item, giveToStorage, isStorage, isTrackWagon, isTrain, refreshCarrier, rejectOrder, takeFromStorage, validateGive, validateTake } from './items';
import { TRACK_PIECE_ID } from './constants';

import { isBurning } from './train';
import { isInGameplay } from './state';

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
    nextFrame(() => UnitDropItemPoint(unitHandle, itemHandle, x, y));
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
      nextFrame(() => IssueTargetOrderById(unitHandle, SMART_ORDER_ID, targetItem));
      return;
    }

    const targetUnit = GetOrderTargetUnit();
    if (targetUnit == null) return;
    const target = Unit.fromHandle(targetUnit);
    if (target == null) return;
    const item = getSlot0Item(unit);

    // Take flow: empty hand + storage, or holding tracks + track wagon
    if ((item != null && item.typeId === TRACK_PIECE_ID && isTrackWagon(target))
        || (item == null && isStorage(target))) {
      if ((isTrain(target) || isTrackWagon(target)) && isBurning()) {
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

    if (item != null && item.typeId === TRACK_PIECE_ID && isTrackWagon(target)) {
      // Take tracks from the wagon — re-validate in case order-time rejection lost the race
      if (validateTake(unit, target) != null) return;
      takeFromStorage(unit, target);
    } else if (item == null) {
      // Take from storage (empty hand)
      takeFromStorage(unit, target);
    } else {
      // Give item to storage — re-validate in case order-time rejection lost the race
      if (validateGive(item.typeId, target) != null) return;
      if (isTrain(target)) noteLoadedMaterial(unit.owner.id);
      giveToStorage(unit, item, target);
    }
    refreshCarrier(unit);
  });
}
