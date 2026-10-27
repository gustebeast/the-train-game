import { registerTest, TestReporter } from './testKit';
import { gameState, syncState } from '../state';
import { Units } from '@objectdata/units';
import { beginNewRun, loadInterRoundLobby } from '../terrain/load';
import { forEachUnitInWorld, forEachUnitOfPlayer, getHumanPlayers } from '../util';
import { AXE_ID, PEASANT_ID, REROLL_ITEM_ID, RESOURCE_CAPACITY_ID } from '../constants';

function firstUnitOfType(typeId: number): unit | null {
  let found: unit | null = null;
  forEachUnitInWorld(u => { if (found == null && GetUnitTypeId(u) === typeId) found = u; });
  return found;
}

/** Type in each of the six slots, as a string like "axe,0,0,0,0,0" in raw ids. */
function slotTypes(u: unit): number[] {
  const out: number[] = [];
  for (let s = 0; s < 6; s++) {
    const it = UnitItemInSlot(u, s);
    out.push(it == null ? 0 : GetItemTypeId(it));
  }
  return out;
}

function slotOf(u: unit, typeId: number): number {
  const types = slotTypes(u);
  for (let s = 0; s < 6; s++) if (types[s] === typeId) return s;
  return -1;
}

function countHeld(u: unit, typeId: number): number {
  let n = 0;
  for (const id of slotTypes(u)) if (id === typeId) n++;
  return n;
}

/** Items of a type lying on the ground (not carried) near a point. */
function groundCount(x: number, y: number, typeId: number): number {
  let n = 0;
  const r = Rect(x - 300, y - 300, x + 300, y + 300);
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && GetItemTypeId(it) === typeId && !IsItemOwned(it) && IsItemVisible(it)) n++;
  });
  RemoveRect(r);
  return n;
}

function clearGround(x: number, y: number): void {
  const r = Rect(x - 300, y - 300, x + 300, y + 300);
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && !IsItemOwned(it)) RemoveItem(it);
  });
  RemoveRect(r);
}

function setGold(n: number): void {
  gameState.gold = n;
  syncState();
}

function clearInventory(p: unit): void {
  for (let s = 0; s < 6; s++) {
    const it = UnitItemInSlot(p, s);
    if (it != null) RemoveItem(it);
  }
}

/** Peasant inventory holds one item, in slot 0, and every way of acquiring one
 *  follows the same rule as picking it up off the ground:
 *    A  picking up a Reroll while holding the axe puts the axe at the feet
 *    A2 picking the axe back up drops the Reroll -- it swaps like any item
 *    B  buying an upgrade (used up on the spot) leaves the held axe alone
 *    D  dragging the axe to another slot is put back, and stays put back
 *
 *  The upgrade goes through the real shop (IssueNeutralImmediateOrderById),
 *  since the question is how the shop's own events interleave with the pickup
 *  rules. Scripted orders never buy the Reroll, so its swap is tested by
 *  pickup -- the same handler a purchase reaches. */
function runInventoryFlow(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  // The lobby's peasants are replaced just after it loads.
  t.after(1, () => runInventoryFlowLoaded(t));
}

function runInventoryFlowLoaded(t: TestReporter): void {
  const shop = firstUnitOfType(FourCC(Units.Marketplace));
  const me = getHumanPlayers()[0].handle;
  let peasant: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (peasant == null && GetUnitTypeId(u) === PEASANT_ID) peasant = u; });
  t.expectTrue('shopFound', shop != null);
  t.expectTrue('peasantFound', peasant != null);
  if (shop == null || peasant == null) { t.done(); return; }
  const p: unit = peasant;
  const here = (): [number, number] => [GetUnitX(p), GetUnitY(p)];

  clearInventory(p);
  SetUnitPosition(p, GetUnitX(shop), GetUnitY(shop) - 250);
  clearGround(...here());
  UnitAddItem(p, CreateItem(AXE_ID, ...here())!);

  SelectUnitForPlayerSingle(shop, me);
  // Aneu ("Select Hero"): the unit the shop hands purchases to.
  IssueNeutralTargetOrderById(me, shop, 852566, p);
  // The first scripted purchase only settles who the buyer is and buys
  // nothing; spend it on an upgrade the player can't afford.
  setGold(0);
  IssueNeutralImmediateOrderById(me, shop, RESOURCE_CAPACITY_ID);

  t.after(0.5, () => {
    clearGround(...here());
    // --- A -------------------------------------------------------------------
    UnitAddItem(p, CreateItem(REROLL_ITEM_ID, ...here())!);
    t.after(0.5, () => {
      t.expect('A_rerollSlot', slotOf(p, REROLL_ITEM_ID), 0);
      t.expect('A_axeHeld', countHeld(p, AXE_ID), 0);
      t.expect('A_axeAtFeet', groundCount(...here(), AXE_ID), 1);

      // --- A2 ----------------------------------------------------------------
      let groundAxe: item | null = null;
      const r = Rect(GetUnitX(p) - 300, GetUnitY(p) - 300, GetUnitX(p) + 300, GetUnitY(p) + 300);
      EnumItemsInRect(r, undefined, () => {
        const it = GetEnumItem();
        if (it != null && GetItemTypeId(it) === AXE_ID && !IsItemOwned(it)) groundAxe = it;
      });
      RemoveRect(r);
      if (groundAxe != null) UnitAddItem(p, groundAxe);
      t.after(0.5, () => {
        t.expect('A2_axeSlot', slotOf(p, AXE_ID), 0);
        t.expect('A2_rerollHeld', countHeld(p, REROLL_ITEM_ID), 0);
        t.expect('A2_rerollAtFeet', groundCount(...here(), REROLL_ITEM_ID), 1);

        // --- B ---------------------------------------------------------------
        clearGround(...here());
        setGold(5);
        const goldBefore = gameState.gold;
        IssueNeutralImmediateOrderById(me, shop, RESOURCE_CAPACITY_ID);
        t.after(1, () => {
          t.expect('B_goldSpent', goldBefore - gameState.gold, 1);
          t.expect('B_axeSlot', slotOf(p, AXE_ID), 0);
          t.expect('B_axeAtFeet', groundCount(...here(), AXE_ID), 0);
          t.expect('B_upgradeHeld', countHeld(p, RESOURCE_CAPACITY_ID), 0);

          runMoveSlot(t, p);
        });
      });
    });
  });
}

function runMoveSlot(t: TestReporter, p: unit): void {
  const axe = UnitItemInSlot(p, slotOf(p, AXE_ID));
  if (axe == null) { t.fail('D_axe', 'no axe to move'); t.done(); return; }
  // The same order an inventory drag issues: 852002 + destination slot.
  IssueTargetOrderById(p, 852002 + 4, axe);
  // The engine moves it at once; the game puts it back a frame later.
  t.report('D_slotAfterDrag', slotOf(p, AXE_ID));
  t.after(0.5, () => {
    t.expect('D_slotAfterRevert', slotOf(p, AXE_ID), 0);
    t.expect('D_axeHeld', countHeld(p, AXE_ID), 1);
    t.done();
  });
}

registerTest('inventoryflow', runInventoryFlow);