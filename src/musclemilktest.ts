import { registerTest, TestReporter } from './testkit';
import { gameState } from './state';
import { beginNewRun, loadTerrain } from './terrain/load';
import { getHumanPlayers, INVENTORY_SLOTS } from './util';
import { getTrain } from './train';
import { findItemByType } from './items';
import { Unit } from 'w3ts';
import { PEASANT_ID, WOOD_ID, STONE_ID, MUSCLE_MILK_ID, GREATER_MUSCLE_MILK_ID } from './constants';

/** Muscle Milk™: one more of any stack, two with the Greater.
 *
 *  A peasant's wood stops at 4 with the milk and 5 with the Greater; losing the
 *  milk drops the excess at its feet; and a storage keeps its own limit -- a
 *  5-stack handed to a train that holds 2 stone leaves 2 in the train and the
 *  rest with the peasant. */
function runMuscleMilk(t: TestReporter): void {
  beginNewRun();
  loadTerrain(1);
  t.after(1, () => stacking(t));
}

function carried(p: unit, typeId: number): number {
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(p, s);
    if (it != null && GetItemTypeId(it) === typeId) return GetItemCharges(it);
  }
  return 0;
}

function looseCharges(p: unit, typeId: number): number {
  let n = 0;
  const r = Rect(GetUnitX(p) - 250, GetUnitY(p) - 250, GetUnitX(p) + 250, GetUnitY(p) + 250)!;
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && GetItemTypeId(it) === typeId && !IsItemOwned(it)) n += Math.max(GetItemCharges(it), 1);
  });
  RemoveRect(r);
  return n;
}

function clearLoose(p: unit): void {
  const r = Rect(GetUnitX(p) - 400, GetUnitY(p) - 400, GetUnitX(p) + 400, GetUnitY(p) + 400)!;
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && !IsItemOwned(it)) RemoveItem(it);
  });
  RemoveRect(r);
}

function addWood(p: unit, times: number): void {
  for (let i = 0; i < times; i++) UnitAddItem(p, CreateItem(WOOD_ID, GetUnitX(p), GetUnitY(p))!);
}

function stacking(t: TestReporter): void {
  const train = getTrain();
  if (train == null) { t.fail('train', 'none on the board'); t.done(); return; }
  const x = train.x - 300;
  const y = train.y + 300;
  const p = CreateUnit(getHumanPlayers()[0].handle, PEASANT_ID, x, y, 0)!;
  clearLoose(p);
  UnitAddItem(p, CreateItem(MUSCLE_MILK_ID, x, y)!);
  addWood(p, 5);
  t.after(0.3, () => {
    t.expect('milkCarries4', carried(p, WOOD_ID), 4);
    t.expect('fifthLeftOnGround', looseCharges(p, WOOD_ID), 1);
    clearLoose(p);
    UnitAddItem(p, CreateItem(GREATER_MUSCLE_MILK_ID, x, y)!);
    addWood(p, 2);
    t.after(0.3, () => {
      t.expect('greaterCarries5', carried(p, WOOD_ID), 5);
      t.expect('plainMilkSwappedOut', looseCharges(p, MUSCLE_MILK_ID), 1);
      clearLoose(p);
      const greater = findItemByType(Unit.fromHandle(p)!, GREATER_MUSCLE_MILK_ID)!;
      UnitRemoveItem(p, greater.handle);
      t.after(0.3, () => {
        t.expect('backTo3', carried(p, WOOD_ID), 3);
        t.expect('excessDropped', looseCharges(p, WOOD_ID), 2);
        clearLoose(p);
        storage(t, p, train.handle);
      });
    });
  });
}

/** Handing a 5-stack of stone to a train that holds 2. */
function storage(t: TestReporter, p: unit, train: unit): void {
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(p, s);
    if (it != null) RemoveItem(it);
    const held = UnitItemInSlot(train, s);
    if (held != null && GetItemTypeId(held) === STONE_ID) RemoveItem(held);
  }
  gameState.trainCargoMaxStack = 2;
  // Right beside the train: the give walks over, and a random board can wall
  // a longer walk off.
  SetUnitPosition(p, GetUnitX(train), GetUnitY(train) + 130);
  UnitAddItem(p, CreateItem(GREATER_MUSCLE_MILK_ID, GetUnitX(p), GetUnitY(p))!);
  const stone = CreateItem(STONE_ID, GetUnitX(p), GetUnitY(p))!;
  SetItemCharges(stone, 5);
  UnitAddItem(p, stone);
  t.after(0.3, () => {
    t.expect('carries5Stone', carried(p, STONE_ID), 5);
    UnitDropItemTarget(p, UnitItemInSlot(p, 0)!, train);
    t.after(3, () => {
      t.expect('trainHoldsItsLimit', carried(train, STONE_ID), 2);
      t.expect('restBackWithPeasant', carried(p, STONE_ID), 3);
      t.done();
    });
  });
}

registerTest('musclemilk', runMuscleMilk);
