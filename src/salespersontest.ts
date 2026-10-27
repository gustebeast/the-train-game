import { registerTest, TestReporter } from './testkit';
import { Units } from '@objectdata/units';
import { gameState, syncState } from './state';
import { beginNewRun, loadInterRoundLobby, loadTerrain } from './terrain/load';
import { setCampForTest } from './creeps';
import { CREEP_CAMPS } from './creepCamps';
import { forEachUnitInWorld, forEachUnitOfPlayer, getHumanPlayers, INVENTORY_SLOTS } from './util';
import { stockSalesperson, getOfferedAbilityItem } from './salesperson';
import {
  AXE_ID, PEASANT_ID, SALESPERSON_ID, RESOURCE_VACUUM_ID, GREATER_RESOURCE_VACUUM_ID,
  UNHOLY_BONE_ID, HORSE_ESSENCE_ID, MUSCLE_MILK_ID,
} from './constants';

const LAST = INVENTORY_SLOTS - 1;

/** Selling to the Secret Salesperson, through real give orders.
 *
 *  A peasant sells a Greater Resource Vacuum back for 2; a hero's loot is
 *  handed straight back unpaid; the regular shop hands an ability item back.
 *  After each, the gold on screen must match the shared gold -- the engine
 *  pays its own price after the event, which once showed as phantom gold.
 *
 *  Buying is not here: scripted shop orders only ever buy items that are used
 *  up on purchase, so the salesperson's stock can only be bought by a click. */function runSalesperson(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  t.after(1, () => setup(t));
}

function slotOf(u: unit, typeId: number): number {
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(u, s);
    if (it != null && GetItemTypeId(it) === typeId) return s;
  }
  return -1;
}

function setGold(n: number): void {
  gameState.gold = n;
  syncState();
}

function setup(t: TestReporter): void {
  const me = getHumanPlayers()[0].handle;
  let p: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (p == null && GetUnitTypeId(u) === PEASANT_ID) p = u; });
  let shop: unit | null = null;
  forEachUnitInWorld(u => { if (shop == null && GetUnitTypeId(u) === FourCC(Units.Marketplace)) shop = u; });
  t.expect('peasantFound', p != null ? 1 : 0, 1);
  t.expect('shopFound', shop != null ? 1 : 0, 1);
  if (p == null || shop == null) { t.done(); return; }
  const peasant: unit = p;
  const mainShop: unit = shop;
  for (let s = 0; s < INVENTORY_SLOTS; s++) {
    const it = UnitItemInSlot(peasant, s);
    if (it != null) RemoveItem(it);
  }
  // Beside the regular shop, so the last step can try selling to it too.
  const x = GetUnitX(mainShop) + 400;
  const y = GetUnitY(mainShop) - 250;
  const r = Rect(x - 400, y - 400, x + 400, y + 400)!;
  EnumDestructablesInRect(r, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  RemoveRect(r);
  SetUnitPosition(peasant, x, y);
  const sp = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE)!, SALESPERSON_ID, x, y + 250, 270)!;
  SetUnitInvulnerable(sp, true);
  stockSalesperson(sp);
  const hero = CreateUnit(me, FourCC('Hpal'), x + 150, y + 100, 0)!;
  setGold(20);
  UnitAddItem(peasant, CreateItem(AXE_ID, x, y)!);
  UnitAddItem(peasant, CreateItem(GREATER_RESOURCE_VACUUM_ID, x, y)!);
  t.after(0.5, () => selling(t, sp, peasant, hero, mainShop));
}

function nativeGold(): number {
  return GetPlayerState(getHumanPlayers()[0].handle, PLAYER_STATE_RESOURCE_GOLD);
}

function selling(t: TestReporter, sp: unit, p: unit, hero: unit, mainShop: unit): void {
  UnitDropItemTarget(p, UnitItemInSlot(p, LAST)!, sp);
  t.after(2.5, () => {
    t.expect('soldGreaterFor2', gameState.gold, 22);
    t.expect('screenGoldMatches', nativeGold(), 22);
    t.expect('greaterGone', slotOf(p, GREATER_RESOURCE_VACUUM_ID), -1);
    UnitDropItemTarget(p, UnitItemInSlot(p, 0)!, sp);
    t.after(2.5, () => {
      t.expect('axeHandedBack', slotOf(p, AXE_ID), 0);
      t.expect('axeNotPaid', gameState.gold, 22);
      const loot = CreateItem(FourCC('ratc'), GetUnitX(hero), GetUnitY(hero))!;
      UnitAddItem(hero, loot);
      UnitDropItemTarget(hero, loot, sp);
      t.after(2.5, () => {
        t.expect('heroLootHandedBack', slotOf(hero, FourCC('ratc')) >= 0 ? 1 : 0, 1);
        t.expect('heroLootNotPaid', gameState.gold, 22);
        t.expect('screenGoldStillMatches', nativeGold(), 22);
        const vac = CreateItem(RESOURCE_VACUUM_ID, GetUnitX(p), GetUnitY(p))!;
        UnitAddItem(p, vac);
        UnitDropItemTarget(p, vac, mainShop);
        t.after(3, () => {
          t.expect('regularShopHandsBack', slotOf(p, RESOURCE_VACUUM_ID), LAST);
          t.expect('regularShopNotPaid', gameState.gold, 22);
          t.expect('screenGoldAfterShop', nativeGold(), 22);
          t.done();
        });
      });
    });
  });
}

registerTest('salesperson', runSalesperson);

/** He turns up on every snow round (a level 3 camp's round) and on no other:
 *  five rounds of each, counting him in the world after the real load. Each
 *  visit offers one ability item, and the first four visits offer all four
 *  -- no repeats within a lap. */
function runSalespersonSpawn(t: TestReporter): void {
  beginNewRun();
  let winterCamp = -1;
  let summerCamp = -1;
  for (let i = 0; i < CREEP_CAMPS.length; i++) {
    if (winterCamp === -1 && CREEP_CAMPS[i].level >= 3) winterCamp = i;
    if (summerCamp === -1 && CREEP_CAMPS[i].level === 1) summerCamp = i;
  }
  let winterRounds = 0;
  let summerRounds = 0;
  const offered: number[] = [];
  for (let round = 1; round <= 5; round++) {
    setCampForTest(winterCamp);
    loadTerrain(round);
    if (countSalespeople() === 1) winterRounds += 1;
    offered.push(getOfferedAbilityItem());
    setCampForTest(summerCamp);
    loadTerrain(round);
    if (countSalespeople() === 0) summerRounds += 1;
  }
  t.expect('everySnowRound', winterRounds, 5);
  t.expect('noOtherRound', summerRounds, 5);
  const firstLap = [offered[0], offered[1], offered[2], offered[3]];
  let covered = 0;
  for (const item of [RESOURCE_VACUUM_ID, UNHOLY_BONE_ID, HORSE_ESSENCE_ID, MUSCLE_MILK_ID]) {
    if (firstLap.indexOf(item) !== -1) covered += 1;
  }
  t.expect('firstLapOffersAllFour', covered, 4);
  t.expect('nextLapOffersOne', offered[4] !== 0 ? 1 : 0, 1);
  t.done();
}

function countSalespeople(): number {
  let n = 0;
  forEachUnitInWorld(u => { if (GetUnitTypeId(u) === SALESPERSON_ID) n += 1; });
  return n;
}

registerTest('salespersonspawn', runSalespersonSpawn);
