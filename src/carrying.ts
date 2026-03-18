import { Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import { Items } from '@objectdata/items';
import { Abilities } from '@objectdata/abilities';

const PEASANT_ID = FourCC(Units.Peasant);
const AXE_ID = FourCC(Items.SturdyWarAxe);
const PICKAXE_ID = FourCC(Items.RustyMiningPick);
const WOOD_ID = FourCC(Items.IronwoodBranch);
const STONE_ID = FourCC(Items.GemFragment);
const TRACK_ID = FourCC(Items.MechanicalCritter);
const BUCKET_ID = FourCC(Items.EmptyVial);
const BUCKET_FULL_ID = FourCC(Items.FullVial);

const AXE_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus1);
const PICK_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus2);
const TRACK_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus3);
const BUCKET_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus4);
const BUCKET_FULL_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus5);

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
  } else if (typeId === TRACK_ID) {
    UnitAddAbility(h, TRACK_ABILITY_ID);
  } else if (typeId === BUCKET_ID) {
    UnitAddAbility(h, BUCKET_ABILITY_ID);
  } else if (typeId === BUCKET_FULL_ID) {
    UnitAddAbility(h, BUCKET_FULL_ABILITY_ID);
  }
}
