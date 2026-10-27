import { registerTest, TestReporter } from './testkit';
import { beginNewRun, loadInterRoundLobby } from './terrain/load';
import { forEachUnitOfPlayer, getHumanPlayers, INVENTORY_SLOTS } from './util';
import { saveToFile, listSaves, loadFromSlot, resetToNewRun } from './save';
import { getHeldAbilityItem } from './abilityItems';
import { getTrain } from './train';
import { TRACK_SIZE } from './track/constants';
import {
  AXE_ID, PEASANT_ID, CRATE_ID, WOOD_ID, STONE_ID, TRACK_PIECE_ID,
  RESOURCE_VACUUM_ID, GREATER_RESOURCE_VACUUM_ID, VACUUM_ABILITY_ID,
} from './constants';

/** Peasant ability items (the Resource Vacuum) and Vacuum Resources.
 *
 *  Holding: the item takes the last slot beside the carried item, grants Q,
 *  swaps like any item, and nothing but a peasant (or the ground) will take
 *  it -- not a hero, a mercenary, the crate or the train, whether handed over
 *  directly or by a real right-click give.
 *  Vacuum: wood and stone within one tile (two with the Greater) end up in one
 *  pile of each on the caster's tile; tracks and anything farther stay put;
 *  picking a pile up takes a full stack and leaves the rest.
 *  Keeping: the item comes back on the next board and through a save, and an
 *  item left on the ground is gone at the next board. */
function runAbilityItems(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  // The lobby's peasants are replaced just after it loads.
  t.after(1, () => holding(t));
}

function myPeasant(): unit | null {
  let found: unit | null = null;
  forEachUnitOfPlayer(getHumanPlayers()[0].handle, u => {
    if (found == null && GetUnitTypeId(u) === PEASANT_ID) found = u;
  });
  return found;
}

function slotOf(u: unit, typeId: number): number {
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(u, s);
    if (it != null && GetItemTypeId(it) === typeId) return s;
  }
  return -1;
}

function clearInventory(u: unit): void {
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(u, s);
    if (it != null) RemoveItem(it);
  }
}

/** Loose items of a type in the square `reach` tiles around a tile centre. */
function looseItems(cx: number, cy: number, reach: number, typeId: number): item[] {
  const half = (reach + 0.5) * TRACK_SIZE;
  const r = Rect(cx - half, cy - half, cx + half, cy + half)!;
  const out: item[] = [];
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && GetItemTypeId(it) === typeId && !IsItemOwned(it)) out.push(it);
  });
  RemoveRect(r);
  return out;
}

function clearArea(cx: number, cy: number, keep: unit): void {
  const r = Rect(cx - 700, cy - 700, cx + 700, cy + 700)!;
  EnumDestructablesInRect(r, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  EnumItemsInRect(r, undefined, () => {
    const it = GetEnumItem();
    if (it != null && !IsItemOwned(it)) RemoveItem(it);
  });
  const g = CreateGroup()!;
  GroupEnumUnitsInRect(g, r, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit()!;
    if (u !== keep && u !== getTrain().handle) RemoveUnit(u);
  });
  DestroyGroup(g);
  RemoveRect(r);
}

let cx = 0;
let cy = 0;

function holding(t: TestReporter): void {
  const p = myPeasant();
  t.expect('peasantFound', p != null ? 1 : 0, 1);
  if (p == null) { t.done(); return; }
  clearInventory(p);
  cx = Math.floor(GetUnitX(p) / TRACK_SIZE + 0.5) * TRACK_SIZE;
  cy = Math.floor(GetUnitY(p) / TRACK_SIZE + 0.5) * TRACK_SIZE;
  clearArea(cx, cy, p);
  SetUnitX(p, cx);
  SetUnitY(p, cy);

  UnitAddItem(p, CreateItem(AXE_ID, cx, cy)!);
  UnitAddItem(p, CreateItem(RESOURCE_VACUUM_ID, cx, cy)!);
  t.after(0.2, () => {
    t.expect('vacuumInLastSlot', slotOf(p, RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
    t.expect('axeKept', slotOf(p, AXE_ID), 0);
    t.expect('grantsQ', GetUnitAbilityLevel(p, VACUUM_ABILITY_ID), 1);
    // A carried-item swap leaves the ability item alone.
    UnitAddItem(p, CreateItem(WOOD_ID, cx, cy)!);
    t.after(0.2, () => {
      t.expect('woodSwappedIn', slotOf(p, WOOD_ID), 0);
      t.expect('vacuumStillHeld', slotOf(p, RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
      for (const it of looseItems(cx, cy, 3, AXE_ID)) RemoveItem(it);
      const w = UnitItemInSlot(p, 0);
      if (w != null) RemoveItem(w);
      refusals(t, p);
    });
  });
}

/** Nothing but a peasant takes an ability item. */
function refusals(t: TestReporter, p: unit): void {
  const me = getHumanPlayers()[0].handle;
  const targets: [string, unit][] = [
    ['hero', CreateUnit(me, FourCC('Hpal'), cx + 200, cy, 0)!],
    ['merc', CreateUnit(me, FourCC('nftr'), cx + 200, cy + 150, 0)!],
    ['crate', CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE)!, CRATE_ID, cx - 300, cy, 0)!],
    ['train', getTrain().handle],
  ];
  for (const [name, target] of targets) {
    const it = CreateItem(RESOURCE_VACUUM_ID, GetUnitX(target), GetUnitY(target))!;
    UnitAddItem(target, it);
    t.expect(name + 'Refused', UnitHasItem(target, it) ? 0 : 1, 1);
    RemoveItem(it);
  }
  const other = CreateUnit(me, PEASANT_ID, cx - 150, cy + 150, 0)!;
  const handed = CreateItem(RESOURCE_VACUUM_ID, cx, cy)!;
  UnitAddItem(other, handed);
  t.expect('peasantAccepts', slotOf(other, RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
  RemoveUnit(other);

  // A real right-click give: the peasant walks the item over and the crate
  // refuses it, handing it back.
  const held = UnitItemInSlot(p, INVENTORY_SLOTS - 1)!;
  UnitDropItemTarget(p, held, targets[2][1]);
  t.after(3, () => {
    t.expect('giveToCrateReturned', slotOf(p, RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
    t.expect('crateNeverHolds', slotOf(targets[2][1], RESOURCE_VACUUM_ID), -1);
    for (const [name, target] of targets) if (name !== 'train') RemoveUnit(target);
    SetUnitX(p, cx);
    SetUnitY(p, cy);
    IssueImmediateOrder(p, 'stop');
    vacuuming(t, p);
  });
}

function vacuuming(t: TestReporter, p: unit): void {
  const T = TRACK_SIZE;
  for (const [dx, dy] of [[-1, -1], [0, 1], [1, 0]]) CreateItem(WOOD_ID, cx + dx * T, cy + dy * T);
  for (const [dx, dy] of [[-1, 0], [0.8, 0.8]]) CreateItem(STONE_ID, cx + dx * T, cy + dy * T);
  const track = CreateItem(TRACK_PIECE_ID, cx, cy - T)!;
  const farWood = CreateItem(WOOD_ID, cx + 2 * T, cy + 2 * T)!;
  CreateItem(STONE_ID, cx - 4 * T, cy);
  t.expect('castAccepted', IssueImmediateOrder(p, 'whirlwind') ? 1 : 0, 1);
  t.after(0.5, () => {
    const wood = looseItems(cx, cy, 1, WOOD_ID);
    const stone = looseItems(cx, cy, 1, STONE_ID);
    t.expect('woodPiles', wood.length, 1);
    t.expect('woodPileSize', wood.length === 1 ? GetItemCharges(wood[0]) : -1, 3);
    t.expect('stonePiles', stone.length, 1);
    t.expect('stonePileSize', stone.length === 1 ? GetItemCharges(stone[0]) : -1, 2);
    t.expect('trackLeftAlone', GetItemY(track) === cy - T ? 1 : 0, 1);
    t.expect('farWoodLeftAlone', GetItemX(farWood) === cx + 2 * T ? 1 : 0, 1);
    const cd = BlzGetUnitAbilityCooldownRemaining(p, VACUUM_ABILITY_ID);
    t.expect('cooldown60', cd > 55 && cd <= 60 ? 1 : 0, 1);

    // Greater: picking it up swaps the plain one out, and reaches two tiles.
    UnitAddItem(p, CreateItem(GREATER_RESOURCE_VACUUM_ID, cx, cy)!);
    t.after(0.2, () => {
      t.expect('greaterInLastSlot', slotOf(p, GREATER_RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
      t.expect('plainSwappedOut', looseItems(cx, cy, 2, RESOURCE_VACUUM_ID).length, 1);
      t.expect('stillGrantsQ', GetUnitAbilityLevel(p, VACUUM_ABILITY_ID), 1);
      for (const it of looseItems(cx, cy, 2, RESOURCE_VACUUM_ID)) RemoveItem(it);
      // Skip the cooldown rather than wait a minute for it.
      BlzEndUnitAbilityCooldown(p, VACUUM_ABILITY_ID);
      t.after(0.2, () => {
        IssueImmediateOrder(p, 'whirlwind');
        t.after(0.5, () => {
          const wood2 = looseItems(cx, cy, 2, WOOD_ID);
          t.expect('greaterWoodPiles', wood2.length, 1);
          t.expect('greaterWoodPileSize', wood2.length === 1 ? GetItemCharges(wood2[0]) : -1, 4);
          t.expect('outsideStoneLeftAlone', looseItems(cx, cy, 2, STONE_ID).length === 1
            && looseItems(cx, cy, 5, STONE_ID).length === 2 ? 1 : 0, 1);
          // A pile is picked up a full stack at a time.
          if (wood2.length === 1) UnitAddItem(p, wood2[0]);
          t.after(0.2, () => {
            const carried = UnitItemInSlot(p, 0);
            t.expect('pickedFullStack', carried != null && GetItemTypeId(carried) === WOOD_ID
              ? GetItemCharges(carried) : -1, 3);
            const left = looseItems(cx, cy, 2, WOOD_ID);
            t.expect('restLeftOnGround', left.length === 1 ? GetItemCharges(left[0]) : -1, 1);
            keeping(t, p);
          });
        });
      });
    });
  });
}

/** Carried to the next board and through a save; lost if left on the ground. */
function keeping(t: TestReporter, p: unit): void {
  const myId = GetPlayerId(GetOwningPlayer(p));
  t.expect('recorded', getHeldAbilityItem(myId), GREATER_RESOURCE_VACUUM_ID);
  saveToFile();
  let newest = listSaves()[0];
  for (const info of listSaves()) if (info.seq > newest.seq) newest = info;
  resetToNewRun();
  t.expect('clearedByNewRun', getHeldAbilityItem(myId), 0);
  t.expect('loaded', loadFromSlot(newest.slot) ? 1 : 0, 1);
  t.expect('restoredFromSave', getHeldAbilityItem(myId), GREATER_RESOURCE_VACUUM_ID);
  loadInterRoundLobby();
  t.after(1, () => {
    const p2 = myPeasant();
    t.expect('nextBoardPeasant', p2 != null ? 1 : 0, 1);
    if (p2 == null) { t.done(); return; }
    t.expect('carriedToNextBoard', slotOf(p2, GREATER_RESOURCE_VACUUM_ID), INVENTORY_SLOTS - 1);
    t.expect('carriedGrantsQ', GetUnitAbilityLevel(p2, VACUUM_ABILITY_ID), 1);
    UnitRemoveItem(p2, UnitItemInSlot(p2, INVENTORY_SLOTS - 1)!);
    t.after(0.2, () => {
      t.expect('droppedClearsRecord', getHeldAbilityItem(myId), 0);
      t.expect('droppedRemovesQ', GetUnitAbilityLevel(p2, VACUUM_ABILITY_ID), 0);
      loadInterRoundLobby();
      t.after(1, () => {
        const p3 = myPeasant();
        t.expect('lostOnNextBoard', p3 != null ? slotOf(p3, GREATER_RESOURCE_VACUUM_ID) : -2, -1);
        t.done();
      });
    });
  });
}

registerTest('abilityitems', runAbilityItems);
