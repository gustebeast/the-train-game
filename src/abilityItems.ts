import { Trigger } from 'w3ts';
import { registerSaveSegment } from './save';
import { isPeasantAbilityItem } from './itemRules';
import { nextFrame, firstPeasantOf, findInventoryItem, giveItems } from './util';
import { PEASANT_ID, ABILITY_ITEM_IDS } from './constants';

/**
 * Which peasant holds which ability item, kept across boards and in the save.
 *
 * Every board change removes every unit and item and spawns fresh peasants, so
 * an ability item only survives because it is written down here and handed
 * back when its owner's peasant spawns. One peasant per player, so the record
 * is keyed by player.
 *
 * The record is re-read from the peasant whenever an ability item is picked up
 * or dropped, never counted. Dropping one on the ground therefore clears it,
 * and an item nobody picks back up is gone at the next board -- the save, which
 * is written from this record, never holds it. A player with no peasant in the
 * world (the moment a board is torn down) keeps their entry.
 */
const held = new Map<number, number>();

/** Save codes, so a save holds a digit instead of a rawcode: the item's index
 *  in ABILITY_ITEM_IDS. */
const SAVE_CODES = ABILITY_ITEM_IDS;

function abilityItemOf(u: unit): number {
  const it = findInventoryItem(u, isPeasantAbilityItem);
  return it != null ? GetItemTypeId(it) : 0;
}

function rereadPlayer(playerId: number): void {
  const peasant = firstPeasantOf(Player(playerId)!);
  if (peasant == null) return;
  const itemType = abilityItemOf(peasant.handle);
  if (itemType === 0) held.delete(playerId);
  else held.set(playerId, itemType);
}

/** Hand a freshly spawned peasant the ability item its player was holding. */
export function restoreAbilityItem(peasant: unit): void {
  const itemType = held.get(GetPlayerId(GetOwningPlayer(peasant)));
  if (itemType == null) return;
  giveItems(peasant, [itemType]);
}

/** The ability item type a player is recorded as holding, or 0. */
export function getHeldAbilityItem(playerId: number): number {
  return held.get(playerId) ?? 0;
}

export function initAbilityItems(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DROP_ITEM);
  t.addAction(() => {
    const u = GetTriggerUnit();
    const it = GetManipulatedItem();
    if (u == null || it == null || GetUnitTypeId(u) !== PEASANT_ID) return;
    if (!isPeasantAbilityItem(GetItemTypeId(it))) return;
    const playerId = GetPlayerId(GetOwningPlayer(u));
    // A drop fires while the item is still in the inventory, and a swap is a
    // drop and a pickup in one frame: read the settled result.
    nextFrame(() => rereadPlayer(playerId));
  });
}

registerSaveSegment('ai',
  () => {
    const parts: string[] = [];
    held.forEach((itemType, playerId) => {
      const code = SAVE_CODES.indexOf(itemType);
      if (code !== -1) parts.push(playerId + '-' + code);
    });
    return parts.join('.');
  },
  (raw) => {
    for (const part of raw.split('.')) {
      const [playerText, codeText] = part.split('-');
      const playerId = tonumber(playerText);
      const code = tonumber(codeText);
      if (playerId == null || code == null) continue;
      const itemType = SAVE_CODES[code];
      if (itemType != null) held.set(playerId, itemType);
    }
  },
  () => held.clear(),
);
