import { Trigger, Unit } from 'w3ts';
import { TRACK_SIZE } from './track/constants';
import { findItemByType } from './items';
import { VACUUM_ABILITY_ID, GREATER_RESOURCE_VACUUM_ID, WOOD_ID, STONE_ID } from './constants';

/** Vacuum Resources (Q): every log and stone lying within reach of the
 *  caster's tile is pulled into one pile of each, on the caster's tile.
 *  Reach is one tile (a 3x3 area) with a Resource Vacuum and two (5x5) with a
 *  Greater one. Track pieces are left where they are.
 *
 *  A pile is a single item holding every charge. A peasant picking it up takes
 *  a full stack and leaves the rest (items.ts). */
const VACUUMED: ReadonlyArray<readonly [number, number]> = [
  // [item type, pile's offset from the tile centre]
  [WOOD_ID, -TRACK_SIZE / 4],
  [STONE_ID, TRACK_SIZE / 4],
];

/** Tiles of reach for the caster: 1 or 2. */
export function vacuumReach(caster: unit): number {
  const u = Unit.fromHandle(caster);
  return u != null && findItemByType(u, GREATER_RESOURCE_VACUUM_ID) != null ? 2 : 1;
}

/** Pull the loose wood and stone within `reach` tiles of (x, y)'s tile into
 *  one pile of each on that tile. */
export function vacuumResources(x: number, y: number, reach: number): void {
  const cx = Math.floor(x / TRACK_SIZE + 0.5) * TRACK_SIZE;
  const cy = Math.floor(y / TRACK_SIZE + 0.5) * TRACK_SIZE;
  const half = (reach + 0.5) * TRACK_SIZE;
  const area = Rect(cx - half, cy - half, cx + half, cy + half)!;
  for (const [itemType, offset] of VACUUMED) {
    const found: item[] = [];
    EnumItemsInRect(area, undefined, () => {
      const it = GetEnumItem();
      if (it != null && GetItemTypeId(it) === itemType && !IsItemOwned(it) && IsItemVisible(it)
        && GetWidgetLife(it) > 0) {
        found.push(it);
      }
    });
    if (found.length === 0) continue;
    let total = 0;
    for (const it of found) total += math.max(GetItemCharges(it), 1);
    const pile = found[0];
    for (let i = 1; i < found.length; i++) RemoveItem(found[i]);
    SetItemPosition(pile, cx + offset, cy);
    SetItemCharges(pile, total);
  }
  RemoveRect(area);
}

export function initVacuum(): void {
  const t = Trigger.create();
  t.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  t.addAction(() => {
    if (GetSpellAbilityId() !== VACUUM_ABILITY_ID) return;
    const caster = GetTriggerUnit();
    if (caster == null) return;
    vacuumResources(GetUnitX(caster), GetUnitY(caster), vacuumReach(caster));
  });
}
