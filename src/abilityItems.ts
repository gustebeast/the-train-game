import { Trigger } from 'w3ts';
import { registerSaveSegment } from './save';
import { gameSeconds } from './globalTick';
import { isPeasantAbilityItem } from './itemRules';
import { nextFrame, firstPeasantOf, findInventoryItem, giveItems, onSpellEffect } from './util';
import { PEASANT_ID, ABILITY_ITEM_IDS, ABILITY_ITEM_FAMILIES } from './constants';

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

/**
 * The spell cooldowns, which belong to the item rather than the peasant.
 *
 * A peasant only has an item's spell while holding the item (items.ts adds
 * and removes it), and an ability added afresh starts off cooldown -- so
 * dropping the item and picking it back up, or passing it to another peasant,
 * would skip the cooldown. Instead each cast notes when its item's spell is
 * ready again, and the spell is put back on that cooldown whenever it is
 * granted anew.
 */
const readyAt = new Map<item, number>();

/** The ability items that grant each spell (both vacuums grant the one spell). */
const GRANTED_BY = new Map<number, number[]>();
for (const { plain, greater, spell, greaterSpell } of ABILITY_ITEM_FAMILIES) {
  if (spell != null) GRANTED_BY.set(spell, [...(GRANTED_BY.get(spell) ?? []), plain]);
  if (greaterSpell != null) GRANTED_BY.set(greaterSpell, [...(GRANTED_BY.get(greaterSpell) ?? []), greater]);
}

function itemGranting(u: unit, abilityId: number): item | null {
  const types = GRANTED_BY.get(abilityId);
  if (types == null) return null;
  return findInventoryItem(u, id => types.includes(id));
}

/** A spell was just granted to `u` by an ability item it holds: put it back on
 *  whatever is left of that item's cooldown. Any other ability is ignored. */
export function restoreItemCooldown(u: unit, abilityId: number): void {
  const it = itemGranting(u, abilityId);
  if (it == null) return;
  const ready = readyAt.get(it);
  if (ready == null) return;
  const remaining = ready - gameSeconds();
  if (remaining > 0) BlzStartUnitAbilityCooldown(u, abilityId, remaining);
  else readyAt.delete(it);
}

/** An item replaced by another (the Greater version) keeps its cooldown. Call
 *  before the new item reaches an inventory. */
export function carryItemCooldown(from: item, to: item): void {
  const ready = readyAt.get(from);
  readyAt.delete(from);
  if (ready != null) readyAt.set(to, ready);
}

export function initAbilityItems(): void {
  GRANTED_BY.forEach((_, abilityId) => {
    onSpellEffect(abilityId, caster => {
      const it = itemGranting(caster.handle, abilityId);
      if (it != null) readyAt.set(it, gameSeconds() + BlzGetUnitAbilityCooldown(caster.handle, abilityId, 0));
    });
  });
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
