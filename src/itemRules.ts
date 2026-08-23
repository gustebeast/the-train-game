import { Unit } from 'w3ts';
import {
  AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID, TRACK_PIECE_ID,
  BUCKET_ID, BUCKET_FULL_ID, REROLL_ITEM_ID,
  PEASANT_ID, TRAIN_ID, TRACK_WAGON_ID, CRATE_ID,
  SHOP_UPGRADE_ITEM_IDS,
} from './constants';

/**
 * Who is allowed to hold what — the ONE place that answers it.
 *
 * Every route an item can travel by (the give/take spell, a manual inventory
 * right-click, or picking one up off the ground) ends in the same question, so
 * they all ask it here rather than each re-deriving the rules. Adding an item
 * or a carrier means editing this file and nothing else.
 *
 * Transfer POLICY lives elsewhere on purpose: "the wagon is filled by the
 * engine, never by a player" is a rule about the direction of a hand-off, not
 * about what the wagon is able to hold, so it stays in validateGive/the pickup
 * handler. This file only answers "may this unit have this item at all".
 */

// --- item classes ---------------------------------------------------------

/** Wood, stone, track pieces — the things the train logistics run on. */
export function isResourceItem(itemTypeId: number): boolean {
  return itemTypeId === WOOD_ID || itemTypeId === STONE_ID || itemTypeId === TRACK_PIECE_ID;
}

/** Peasant tools (and the bucket in both states). */
export function isToolItem(itemTypeId: number): boolean {
  return itemTypeId === AXE_ID || itemTypeId === PICKAXE_ID
    || itemTypeId === BUCKET_ID || itemTypeId === BUCKET_FULL_ID;
}

/** Consumed the moment it is acquired (shop.ts turns the pickup into the
 *  upgrade), so it is never really carried and everyone may accept one --
 *  otherwise buying an upgrade would be rejected before it could apply. */
export function isShopUpgrade(itemTypeId: number): boolean {
  for (const id of SHOP_UPGRADE_ITEM_IDS) {
    if (id === itemTypeId) return true;
  }
  return false;
}

/** Bought by a peasant and carried in the inter-round lobby until cast on a hero. */
export function isPeasantUtility(itemTypeId: number): boolean {
  return itemTypeId === REROLL_ITEM_ID;
}

/** Anything the train game does not define is treated as hero loot (claws,
 *  rings, tomes — the creep-camp drop pools). Defaulting this way means a new
 *  drop is automatically hero-only rather than silently becoming carryable by
 *  a peasant. */
export function isHeroItem(itemTypeId: number): boolean {
  return !isResourceItem(itemTypeId) && !isToolItem(itemTypeId)
    && !isShopUpgrade(itemTypeId) && !isPeasantUtility(itemTypeId);
}

// --- carriers -------------------------------------------------------------

export function isPeasantUnit(u: Unit): boolean {
  return u.typeId === PEASANT_ID;
}

export function isHeroUnit(u: Unit): boolean {
  return IsUnitType(u.handle, UNIT_TYPE_HERO);
}

/**
 * May `holder` hold `itemTypeId`? Returns null when allowed, otherwise a short
 * player-facing reason.
 *
 * Units with no rule (the mercenary creep, for instance) are unrestricted —
 * this answers only the cases the game actually defines, so an unlisted unit is
 * never accidentally locked out of everything.
 */
export function canHold(holder: Unit, itemTypeId: number): string | null {
  // Upgrades are consumed on acquisition; never block them.
  if (isShopUpgrade(itemTypeId)) return null;

  if (holder.typeId === TRAIN_ID) {
    return (itemTypeId === WOOD_ID || itemTypeId === STONE_ID)
      ? null : 'The engine carries wood and stone only!';
  }
  if (holder.typeId === TRACK_WAGON_ID) {
    return itemTypeId === TRACK_PIECE_ID ? null : 'The wagon carries tracks only!';
  }
  if (holder.typeId === CRATE_ID) {
    return isResourceItem(itemTypeId) ? null : "Can't store that!";
  }
  if (isPeasantUnit(holder)) {
    return (isResourceItem(itemTypeId) || isToolItem(itemTypeId) || isPeasantUtility(itemTypeId))
      ? null : "Peasants can't carry hero items!";
  }
  // Everything else fights alongside the heroes -- the mercenaries above all --
  // so it lives by the hero rules. Defaulting the other way (unrestricted) let
  // a mercenary be handed the Reroll, or a peasant's bucket, purely because it
  // is a creep rather than a UNIT_TYPE_HERO.
  return isHeroItem(itemTypeId)
    ? null
    : (isHeroUnit(holder) ? "Heroes can't carry that!" : "Mercenaries can't carry that!");
}
