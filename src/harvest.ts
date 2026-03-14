import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { TREE_UNIT_RAWS, ROCK_UNIT_RAWS } from './terrain/spawn';
import { log } from './debug';

const TREE_IDS = new Set(TREE_UNIT_RAWS.map(r => FourCC(r)));
const ROCK_IDS = new Set(ROCK_UNIT_RAWS.map(r => FourCC(r)));
const AXE_ID = FourCC(Items.SturdyWarAxe);
const PICKAXE_ID = FourCC(Items.RustyMiningPick);

/** Check whether a unit is carrying an item of the given type. */
function unitHasItemType(u: Unit, itemTypeId: number): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const it = u.getItemInSlot(slot);
    if (it != null && it.typeId === itemTypeId) return true;
  }
  return false;
}

/** Returns the required item type for a target unit, or 0 if no tool needed. */
function requiredTool(targetTypeId: number): number {
  if (TREE_IDS.has(targetTypeId)) return AXE_ID;
  if (ROCK_IDS.has(targetTypeId)) return PICKAXE_ID;
  return 0;
}

function toolName(itemTypeId: number): string {
  if (itemTypeId === AXE_ID) return 'Axe';
  if (itemTypeId === PICKAXE_ID) return 'Pickaxe';
  return '';
}

/** Returns true if the target unit is a resource (tree or rock). */
function isResourceUnit(typeId: number): boolean {
  return TREE_IDS.has(typeId) || ROCK_IDS.has(typeId);
}

export function initHarvest(): void {
  // --- Debug: log ALL order types to find what fires on destructable right-click ---
  const debugTarget = Trigger.create();
  debugTarget.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  debugTarget.addAction(() => {
    const orderId = GetIssuedOrderId();
    const orderStr = OrderId2String(orderId);
    const destTarget = GetOrderTargetDestructable();
    const unitTarget = GetOrderTargetUnit();
    log('TARGET_ORDER: id=' + orderId + ' str=' + (orderStr || 'null') +
      ' hasDest=' + (destTarget != null) +
      ' hasUnit=' + (unitTarget != null));
  });

  const debugPoint = Trigger.create();
  debugPoint.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  debugPoint.addAction(() => {
    const orderId = GetIssuedOrderId();
    const orderStr = OrderId2String(orderId);
    const x = GetOrderPointX();
    const y = GetOrderPointY();
    const destTarget = GetOrderTargetDestructable();
    log('POINT_ORDER: id=' + orderId + ' str=' + (orderStr || 'null') +
      ' x=' + x + ' y=' + y + ' hasDest=' + (destTarget != null));
  });

  const debugNoTarget = Trigger.create();
  debugNoTarget.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_ORDER);
  debugNoTarget.addAction(() => {
    const orderId = GetIssuedOrderId();
    const orderStr = OrderId2String(orderId);
    log('NO_TARGET_ORDER: id=' + orderId + ' str=' + (orderStr || 'null'));
  });

  // --- Intercept target orders on resource units ---
  const orderTrigger = Trigger.create();
  orderTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  orderTrigger.addAction(() => {
    const unit = Unit.fromEvent();
    if (unit == null) return;

    const targetHandle = GetOrderTargetUnit();
    if (targetHandle != null) {
      const target = Unit.fromHandle(targetHandle);
      if (target != null && isResourceUnit(target.typeId)) {
        const tool = requiredTool(target.typeId);
        if (tool !== 0 && !unitHasItemType(unit, tool)) {
          // No tool — cancel order
          const unitHandle = unit.handle;
          const t = Timer.create();
          t.start(0, false, () => {
            IssueImmediateOrder(unitHandle, 'stop');
            t.destroy();
          });
          const name = toolName(tool);
          const tt = CreateTextTag();
          if (tt != null) {
            SetTextTagText(tt, 'Requires ' + name + '!', 0.024);
            SetTextTagPosUnit(tt, unitHandle, 0);
            SetTextTagColor(tt, 255, 200, 200, 255);
            SetTextTagVelocity(tt, 0, 0.03);
            SetTextTagPermanent(tt, false);
            SetTextTagLifespan(tt, 2.0);
            SetTextTagFadepoint(tt, 1.5);
          }
          return;
        }

        // Has tool — redirect smart/right-click to attack
        const unitHandle = unit.handle;
        const targetH = target.handle;
        const t = Timer.create();
        t.start(0, false, () => {
          IssueTargetOrder(unitHandle, 'attack', targetH);
          t.destroy();
        });
      }
    }
  });

  // --- Tree hit animation on damage ---
  const damageTrigger = Trigger.create();
  damageTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DAMAGED);
  damageTrigger.addAction(() => {
    const damaged = Unit.fromHandle(GetTriggerUnit());
    if (damaged != null && TREE_IDS.has(damaged.typeId)) {
      SetUnitAnimation(damaged.handle, 'hit');
      QueueUnitAnimation(damaged.handle, 'stand');
    }
  });

  // --- Rock death effect (recreate destructable rock explosion) ---
  const deathTrigger = Trigger.create();
  deathTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  deathTrigger.addAction(() => {
    const dying = Unit.fromHandle(GetTriggerUnit());
    if (dying != null && ROCK_IDS.has(dying.typeId)) {
      const x = dying.x;
      const y = dying.y;
      const fx = AddSpecialEffect(
        'Objects\\Spawnmodels\\Undead\\ImpaleTargetDust\\ImpaleTargetDust.mdl',
        x, y,
      );
      if (fx != null) DestroyEffect(fx);
      const snd = CreateSound(
        'Sound\\Destructable\\BoulderMedium\\BoulderMediumHit1.flac',
        false, false, false, 10, 10, '',
      );
      if (snd != null) {
        SetSoundPosition(snd, x, y, 0);
        SetSoundVolume(snd, 127);
        StartSound(snd);
        KillSoundWhenDone(snd);
      }
    }
  });

  // --- Enforce one item at a time ---
  const pickupTrigger = Trigger.create();
  pickupTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickupTrigger.addAction(() => {
    const unit = Unit.fromEvent();
    const picked = Item.fromEvent();
    if (unit == null || picked == null) return;

    // Count items in inventory (excluding the one just picked up)
    let otherItem: Item | undefined;
    for (let slot = 0; slot < 6; slot++) {
      const it = unit.getItemInSlot(slot);
      if (it != null && it.handle !== picked.handle) {
        otherItem = it;
        break;
      }
    }

    // If carrying another item, drop it
    if (otherItem != null) {
      unit.removeItem(otherItem);
    }
  });

  log('Harvest system initialized');
}
