import { Unit } from 'w3ts';
import { TRACK_SIZE } from './track/constants';
import { worldToTile } from './terrain/constants';
import { abilityItemTier } from './items';
import { onSpellEffect } from './util';
import { VACUUM_ABILITY_ID, WOOD_ID, STONE_ID, RESOURCE_VACUUM_ID } from './constants';

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
  return u != null && abilityItemTier(u, RESOURCE_VACUUM_ID) === 2 ? 2 : 1;
}

/** Pull the loose wood and stone within `reach` tiles of (x, y)'s tile into
 *  one pile of each on that tile. */
export function vacuumResources(x: number, y: number, reach: number): void {
  const cx = worldToTile(x) * TRACK_SIZE;
  const cy = worldToTile(y) * TRACK_SIZE;
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
    for (const it of found) total += Math.max(GetItemCharges(it), 1);
    const pile = found[0];
    for (let i = 1; i < found.length; i++) RemoveItem(found[i]);
    SetItemPosition(pile, cx + offset, cy);
    SetItemCharges(pile, total);
  }
  RemoveRect(area);
}

export function initVacuum(): void {
  onSpellEffect(VACUUM_ABILITY_ID, caster => {
    vacuumResources(caster.x, caster.y, vacuumReach(caster.handle));
  });
}
