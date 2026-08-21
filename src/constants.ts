import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { Upgrades } from '@objectdata/upgrades';

// Units
export const PEASANT_ID = FourCC(Units.Peasant);
export const TRAIN_ID = FourCC(Units.WarWagon);
export const TRACK_WAGON_ID = FourCC(Units.Wagon);
export const CRATE_ID = FourCC(Units.GrainWarehouse);
export const WATER_ID = FourCC(Units.Burrow);

// Critters: the wandering-animal set from classic 1v1 melee maps
export const CRITTER_TYPE_IDS: ReadonlyArray<number> = [
  FourCC(Units.Rabbit),
  FourCC(Units.Stag),
  FourCC(Units.Sheep),
  FourCC(Units.Pig),
  FourCC(Units.Chicken),
  FourCC(Units.Raccoon),
];

// Abilities
export const SUMMON_ABILITY_ID = FourCC(Abilities.Roar);
export const UNSUMMON_ABILITY_ID = FourCC(Abilities.RoarNeutralHostile);
export const BUILD_TRACK_ABILITY_ID = FourCC(Abilities.BuildTinyFarm);
export const BRIDGE_ABILITY_ID = FourCC(Abilities.FingerOfDeathNeutralHostile);
export const FILL_ABILITY_ID = FourCC(Abilities.UndefinedNeutralHostile);
export const WATER_TRAIN_ABILITY_ID = FourCC(Abilities.DrunkenHazeChen);
export const DASH_ABILITY_ID = FourCC('A000'); // Channel-based dash, authored in the editor
// Wand of Negation repurposed as the Hero Reroll cast (its native purge is
// irrelevant — the target is replaced the moment the spell lands)
export const REROLL_ABILITY_ID = FourCC(Abilities.ItemIllusions);

// Upgrades
// MagicSentry repurposed as the Summon Heroes tech (gates the summon ability)
export const SUMMON_TECH_ID = FourCC(Upgrades.MagicSentry);

// Items
export const SUMMON_UPGRADE_ITEM_ID = FourCC(Items.PendantOfEnergy);
export const AXE_ID = FourCC(Items.SturdyWarAxe);
export const PICKAXE_ID = FourCC(Items.RustyMiningPick);
export const WOOD_ID = FourCC(Items.IronwoodBranch);
export const STONE_ID = FourCC(Items.GemFragment);
export const TRACK_PIECE_ID = FourCC(Items.MechanicalCritter);
export const BUCKET_ID = FourCC(Items.EmptyVial);
export const BUCKET_FULL_ID = FourCC(Items.FullVial);
export const REROLL_ITEM_ID = FourCC(Items.VoodooDoll);

// Shop stock. These are consumed the instant they are acquired (shop.ts turns
// the pickup into the upgrade), so they are never really "held" by anyone --
// which is why the holding rules let every unit accept them.
export const FLAME_RESISTANCE_ID = FourCC(Items.AncientFigurine);
export const TRACK_MANUFACTURING_ID = FourCC(Items.BracerOfAgility);
export const RESOURCE_CAPACITY_ID = FourCC(Items.DruidPouch);
export const TRACK_CAPACITY_ID = FourCC(Items.JadeRing);
export const CRATE_CAPACITY_ID = FourCC(Items.LionsRing);
export const MERC_CONTRACT_ID = FourCC(Items.MogrinsReport);
/** Retired: the Hero Reroll item now rerolls mercenaries too, so the shop no
 *  longer sells a separate one. Kept so the object data still has an owner. */
export const MERC_REROLL_ID = FourCC(Items.HoodOfCunning);
export const CRITTERPOCALYPSE_ID = FourCC(Items.MedallionOfCourage);
export const TOUGH_CAMP_ID = FourCC(Items.PeriaptOfVitality);

/** Everything the shop sells that is consumed on acquisition. */
export const SHOP_UPGRADE_ITEM_IDS: readonly number[] = [
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, SUMMON_UPGRADE_ITEM_ID,
  MERC_CONTRACT_ID, CRITTERPOCALYPSE_ID, TOUGH_CAMP_ID,
];
