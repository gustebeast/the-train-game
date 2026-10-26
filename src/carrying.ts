import { Unit } from 'w3ts';
import { STONE_ID, WOOD_ID, PEASANT_ID } from './constants';
import { CARRIED_TOOLS } from './sharedData';

/** The ability that shows each tool in a peasant's hand, by item type id. The
 *  pairs are sharedData's CARRIED_TOOLS, the same table the build authors the
 *  abilities from. */
const TOOL_ABILITIES = new Map<number, number>();
for (const [item, attachment] of Object.entries(CARRIED_TOOLS)) {
  TOOL_ABILITIES.set(FourCC(item), FourCC(attachment.ability));
}

/** Update the peasant's carrying visual based on their slot 0 item. */
export function updateCarryingVisual(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  const h = u.handle;

  // Clear previous state
  for (const [, abilityId] of TOOL_ABILITIES) UnitRemoveAbility(h, abilityId);
  AddUnitAnimationProperties(h, 'gold', false);
  AddUnitAnimationProperties(h, 'lumber', false);

  const item = u.getItemInSlot(0);
  if (item == null) return;

  // Wood and stone use the peasant's own carry animations; tools are models.
  const typeId = item.typeId;
  if (typeId === STONE_ID) {
    AddUnitAnimationProperties(h, 'gold', true);
  } else if (typeId === WOOD_ID) {
    AddUnitAnimationProperties(h, 'lumber', true);
  } else {
    const abilityId = TOOL_ABILITIES.get(typeId);
    if (abilityId != null) UnitAddAbility(h, abilityId);
  }
}
