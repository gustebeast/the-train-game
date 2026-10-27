import { Item, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { registerTest, startRunInLobby, TestReporter } from './testKit';
import { gameState } from '../state';
import { TRAIN_INITIAL_MAX_HP, FLAME_RESISTANCE_HP, SHELF } from '../sharedData';
import { Items } from '@objectdata/items';
import { RESTORE_HP_ID, FLAME_RESISTANCE_ID, PEASANT_ID } from '../constants';
import { getWorldBounds } from '../util';

/** Verify the Repair Train purchase.
 *
 *  The shop's effect runs on item PICKUP, so handing the item to a unit is the
 *  same code path a real purchase takes -- this exercises the item id, the cost
 *  deduction and the max-HP reset together. (Whether the shop *stocks* it is a
 *  call into AddItemToStock that the game gives no way to read back, so that
 *  half is left to the conditional in stockShop.)
 *
 *  Expects:
 *    afterRepair    exactly TRAIN_INITIAL_MAX_HP
 *    goldSpent      the repair's shelf price
 *    afterUpgrade   repair-then-upgrade stacks from the starting max HP,
 *                   proving the reset is a floor and not a permanent cap */
function runRepairTest(t: TestReporter): void {
  // A board of its own. In a batched run the previous test can leave a round
  // standing with the train on fire, and the burn tick would keep taking max
  // HP away while this measures it.
  startRunInLobby();
  const bounds = getWorldBounds();
  const x = GetRectMaxX(bounds) - 400;
  const y = GetRectMaxY(bounds) - 400;
  const buyer = Unit.create(Players[0], PEASANT_ID, x, y, 0)!;

  gameState.gold = 5;
  gameState.trainMaxHP = 37;
  t.report('beforeRepair', gameState.trainMaxHP);
  const goldBefore = gameState.gold;

  const repair = Item.create(RESTORE_HP_ID, x, y);
  if (repair == null) {
    t.fail('repairItem', 'Item.create returned null -- bad item id?');
    t.done();
    return;
  }
  UnitAddItem(buyer.handle, repair.handle);

  t.after(1, () => {
    t.expect('afterRepair', gameState.trainMaxHP, TRAIN_INITIAL_MAX_HP);
    t.expect('goldSpent', goldBefore - gameState.gold, SHELF[Items.HeartOfAszune].cost);

    // A Flame Resistance bought after repairing must build on 100.
    const upgrade = Item.create(FLAME_RESISTANCE_ID, x, y);
    if (upgrade != null) UnitAddItem(buyer.handle, upgrade.handle);
    t.after(1, () => {
      t.expect('afterUpgrade', gameState.trainMaxHP, TRAIN_INITIAL_MAX_HP + FLAME_RESISTANCE_HP);
      buyer.destroy();
      t.done();
    });
  });
}

registerTest('repair', runRepairTest);
