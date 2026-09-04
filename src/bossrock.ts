import { Timer, Trigger, Unit } from 'w3ts';
import { BOSS_KEY_ITEM_ID, PEASANT_ID } from './constants';
import { STRANGE_ROCK_RAW } from './terrain/constants';

/**
 * The Strange Rock: what the Strange Key is for.
 *
 * The rock has granite's health, so attacking it without the key is a way to
 * spend the rest of the round. Bring the key within reach and it drops to a
 * single point, so the next blow finishes it -- the rock still dies to an
 * attack, which is what makes it read as a rock rather than a trigger.
 *
 * Proximity rather than the attack ORDER, which was the first attempt and is
 * broken in the obvious case: a player hits the rock, learns they need the key,
 * fetches it and attacks again -- and the engine raises no order event the
 * second time, because the peasant was already attacking that exact target.
 * Measured in game: the rock sat at full health with the key in hand. Watching
 * where the key is instead has no such gap.
 *
 * It re-seals when the key leaves, so the rock is only ever fragile while
 * somebody is standing there with the way to open it.
 */

/** How close the key has to be. A little over a tile, so standing next to the
 *  rock counts and shouting at it from across the clearing does not. */
const KEY_RANGE = 200;
/** Full health, matching the object data. */
const SEALED_LIFE = 999999.0;
/** How often the rock looks around for the key. */
const CHECK_SECONDS = 0.5;

let watched: destructable | null = null;
let watcher: Timer | null = null;
let messaged = false;

/** Does this unit have the Strange Key in hand? */
function carriesKey(u: unit): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const held = UnitItemInSlot(u, slot);
    if (held != null && GetItemTypeId(held) === BOSS_KEY_ITEM_ID) return true;
  }
  return false;
}

/** Is a peasant holding the key standing at the rock? */
function keyIsAtRock(rock: destructable): boolean {
  let found = false;
  const g = CreateGroup()!;
  GroupEnumUnitsInRange(g, GetDestructableX(rock), GetDestructableY(rock), KEY_RANGE, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (found || u == null) return;
    if (GetUnitTypeId(u) !== PEASANT_ID) return;
    if (carriesKey(u)) found = true;
  });
  DestroyGroup(g);
  return found;
}

/** Watch the boss exit's seal. Called by the spawner when it places one; the
 *  previous round's rock is dropped at the same time, since the map it stood on
 *  no longer exists. */
export function registerStrangeRock(rock: destructable): void {
  watched = rock;
  messaged = false;
  if (watcher != null) return;
  const timer = Timer.create();
  watcher = timer;
  timer.start(CHECK_SECONDS, true, () => {
    const rock2 = watched;
    if (rock2 == null) return;
    // Already broken: nothing left to guard.
    if (GetDestructableLife(rock2) <= 0) { watched = null; return; }
    SetDestructableLife(rock2, keyIsAtRock(rock2) ? 1 : SEALED_LIFE);
  });
}

/** Tell a player why the rock will not budge, the moment they try it. */
export function initBossRock(): void {
  const onAttack = Trigger.create();
  onAttack.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  onAttack.addAction(() => {
    if (GetIssuedOrderId() !== OrderId('attack')) return;
    const target = GetOrderTargetDestructable();
    if (target == null || GetDestructableTypeId(target) !== FourCC(STRANGE_ROCK_RAW)) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null || u.typeId !== PEASANT_ID) return;
    if (carriesKey(u.handle) || messaged) return;
    messaged = true;
    DisplayTimedTextToPlayer(u.owner.handle, 0, 0, 8,
      'The rock does not move. Something out here is carrying the way in.');
  });
}
