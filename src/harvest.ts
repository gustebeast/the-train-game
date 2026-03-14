import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Items } from '@objectdata/items';
import { TREE_RAW, ROCK_RAW } from './terrain/spawn';
import { log } from './debug';

const TREE_DEST_ID = FourCC(TREE_RAW);
const ROCK_DEST_ID = FourCC(ROCK_RAW);
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

/** Returns the required tool for a destructable type, or 0 if none needed. */
function requiredToolForDest(destTypeId: number): number {
  if (destTypeId === TREE_DEST_ID) return AXE_ID;
  if (destTypeId === ROCK_DEST_ID) return PICKAXE_ID;
  return 0;
}

function toolName(itemTypeId: number): string {
  if (itemTypeId === AXE_ID) return 'Axe';
  if (itemTypeId === PICKAXE_ID) return 'Pickaxe';
  return '';
}

function showRequiresText(unitHandle: unit, name: string): void {
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
}

function isResourceDest(destTypeId: number): boolean {
  return destTypeId === TREE_DEST_ID || destTypeId === ROCK_DEST_ID;
}

/** Cancel order + show text if unit lacks the required tool for a destructable. */
function checkToolAndCancel(unit: Unit, destTypeId: number): void {
  const tool = requiredToolForDest(destTypeId);
  if (tool === 0) return;
  if (unitHasItemType(unit, tool)) return;

  const unitHandle = unit.handle;
  const t = Timer.create();
  t.start(0, false, () => {
    IssueImmediateOrder(unitHandle, 'stop');
    t.destroy();
  });
  showRequiresText(unitHandle, toolName(tool));
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

  // --- Intercept destructable target orders (in view) ---
  const destTargetTrigger = Trigger.create();
  destTargetTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  destTargetTrigger.addAction(() => {
    const dest = GetOrderTargetDestructable();
    if (dest == null) return;
    if (!isResourceDest(GetDestructableTypeId(dest))) return;

    const unit = Unit.fromEvent();
    if (unit == null) return;
    checkToolAndCancel(unit, GetDestructableTypeId(dest));
  });

  // --- Intercept destructable point orders (out of fog) ---
  const destPointTrigger = Trigger.create();
  destPointTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_POINT_ORDER);
  destPointTrigger.addAction(() => {
    if (GetIssuedOrderId() !== OrderId('smart')) return;

    const x = GetOrderPointX();
    const y = GetOrderPointY();
    const unit = Unit.fromEvent();
    if (unit == null) return;

    // Check if a resource destructable exists at the click point
    let foundType = 0;
    const r = Rect(x - 64, y - 64, x + 64, y + 64);
    EnumDestructablesInRect(r, undefined, () => {
      const d = GetEnumDestructable();
      if (d != null) {
        const dt = GetDestructableTypeId(d);
        if (isResourceDest(dt)) foundType = dt;
      }
    });
    RemoveRect(r);

    if (foundType === 0) return;
    checkToolAndCancel(unit, foundType);
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
