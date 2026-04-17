import { Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { AXE_ID, PICKAXE_ID, WOOD_ID, STONE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID, PEASANT_ID } from './constants';

const AXE_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus7);
const PICK_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus8);
const TRACK_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus10);
const BUCKET_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus20);
const BUCKET_FULL_ABILITY_ID = FourCC(Abilities.ItemArmorBonusPlus7);

/** Update the peasant's carrying visual based on their slot 0 item. */
export function updateCarryingVisual(u: Unit): void {
  if (u.typeId !== PEASANT_ID) return;
  const h = u.handle;

  // Clear previous state
  UnitRemoveAbility(h, AXE_ABILITY_ID);
  UnitRemoveAbility(h, PICK_ABILITY_ID);
  UnitRemoveAbility(h, TRACK_ABILITY_ID);
  UnitRemoveAbility(h, BUCKET_ABILITY_ID);
  UnitRemoveAbility(h, BUCKET_FULL_ABILITY_ID);
  AddUnitAnimationProperties(h, 'gold', false);
  AddUnitAnimationProperties(h, 'lumber', false);

  const item = u.getItemInSlot(0);
  if (item == null) return;

  const typeId = item.typeId;
  if (typeId === STONE_ID) {
    AddUnitAnimationProperties(h, 'gold', true);
  } else if (typeId === WOOD_ID) {
    AddUnitAnimationProperties(h, 'lumber', true);
  } else if (typeId === AXE_ID) {
    UnitAddAbility(h, AXE_ABILITY_ID);
  } else if (typeId === PICKAXE_ID) {
    UnitAddAbility(h, PICK_ABILITY_ID);
  } else if (typeId === TRACK_PIECE_ID) {
    UnitAddAbility(h, TRACK_ABILITY_ID);
  } else if (typeId === BUCKET_ID) {
    UnitAddAbility(h, BUCKET_ABILITY_ID);
  } else if (typeId === BUCKET_FULL_ID) {
    UnitAddAbility(h, BUCKET_FULL_ABILITY_ID);
  }
}
