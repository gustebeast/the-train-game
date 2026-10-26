import { Trigger, Unit } from 'w3ts';
import { BOSS_KEY_ITEM_ID, PEASANT_ID, STRANGE_ROCK_ID } from './constants';
import { getNeutralExtra } from './teams';
import { ROCK_MODEL_SCALES } from './terrain/constants';

/**
 * The Strange Rock: what the Strange Key is for.
 *
 * You USE the key on the rock. It is a copy of the Alchemist's Transmute, so
 * the peasant throws, the missile flies, and the rock is destroyed when it
 * lands -- all done by the engine, nothing here watching or timing it.
 *
 * That replaced a proximity watcher: the rock used to sit at granite's health
 * and drop to 1 HP whenever a key-holder stood near it, checked twice a second
 * for the rest of the game. Attacking was the verb then; the first version
 * had keyed off the attack ORDER instead, and broke in the commonest case --
 * re-attacking a target you are already attacking raises no new order event.
 * A cast raises a fresh event every time.
 *
 * Two things keep this the ONLY way in:
 *  - the rock has 999999 HP, so attacks chip at it forever, and Transmute
 *    kills rather than damages, so the HP is no obstacle to the key;
 *  - the key targets "ancient structures", and the rock is the only one in the
 *    map, so the engine's own invalid-target refusal handles everything else.
 *    The Alchemist's real Transmute is untouched: the key casts a copy.
 */

let messaged = false;

/** Stand the seal up. The one place a rock is made: the board spawner and the
 *  tests both come through here. Neutral extra, so it shares no vision. */
export function spawnStrangeRock(x: number, y: number): unit | null {
  messaged = false;
  const rock = CreateUnit(getNeutralExtra().handle, STRANGE_ROCK_ID, x, y, 270);
  if (rock == null) return null;
  // Variation 0 of the rock-chunk model, at the size granite and the resource
  // rocks use for it -- a rock among rocks, singled out by colour, not size.
  SetUnitScale(rock, ROCK_MODEL_SCALES[0], ROCK_MODEL_SCALES[0], ROCK_MODEL_SCALES[0]);
  return rock;
}

/** Does this unit have the Strange Key in hand? */
function carriesKey(u: unit): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const held = UnitItemInSlot(u, slot);
    if (held != null && GetItemTypeId(held) === BOSS_KEY_ITEM_ID) return true;
  }
  return false;
}

/** Point a player at the key the first time they try the rock by hand. Said
 *  differently to a peasant already holding it: attacking was how this used
 *  to work, so a returning player will try it. */
export function initBossRock(): void {
  const onAttack = Trigger.create();
  onAttack.registerAnyUnitEvent(EVENT_PLAYER_UNIT_ISSUED_TARGET_ORDER);
  onAttack.addAction(() => {
    if (GetIssuedOrderId() !== OrderId('attack')) return;
    const target = GetOrderTargetUnit();
    if (target == null || GetUnitTypeId(target) !== STRANGE_ROCK_ID) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null || u.typeId !== PEASANT_ID) return;
    if (carriesKey(u.handle)) {
      DisplayTimedTextToPlayer(u.owner.handle, 0, 0, 8,
        'Hitting it will not help. Use the Strange Key on it.');
      return;
    }
    if (messaged) return;
    messaged = true;
    DisplayTimedTextToPlayer(u.owner.handle, 0, 0, 8,
      'The rock does not move. Something out here is carrying the way in.');
  });
}
