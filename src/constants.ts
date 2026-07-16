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

// Abilities
export const SUMMON_ABILITY_ID = FourCC(Abilities.Roar);
export const UNSUMMON_ABILITY_ID = FourCC(Abilities.RoarNeutralHostile);
export const BUILD_TRACK_ABILITY_ID = FourCC(Abilities.BuildTinyFarm);
export const BRIDGE_ABILITY_ID = FourCC(Abilities.FingerOfDeathNeutralHostile);
export const FILL_ABILITY_ID = FourCC(Abilities.UndefinedNeutralHostile);
export const WATER_TRAIN_ABILITY_ID = FourCC(Abilities.DrunkenHazeChen);
// Wand of Negation repurposed as the Hero Reroll cast (its native purge is
// irrelevant — the target is replaced the moment the spell lands)
export const REROLL_ABILITY_ID = FourCC(Abilities.ItemPurgeWandOfNegation);

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
