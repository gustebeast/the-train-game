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

/** The "?" placeholder for a hero or mercenary you have rolled but not yet seen.
 *  A custom unit authored in compiletime.ts (copied from the peasant); the
 *  rawcode is duplicated there as UNKNOWN_UNIT_RAWCODE. */
export const UNKNOWN_UNIT_ID = FourCC('qmrk');
/** The final boss and the lesser infernals it calls down, both minted in
 *  compiletime.ts. */
/** Dropped by a flawless level 3 camp; opens the way to the boss. */
export const BOSS_KEY_ITEM_ID = FourCC(Items.KeyOfThreeMoons);
export const BOSS_ID = FourCC('ubos');
export const BOSS_ADD_ID = FourCC('uinl');
/** The boss's Inferno (a Tichondrius-campaign copy) and the add's Thunder Clap
 *  (a copy with the hero flag cleared). */
export const BOSS_INFERNO_ABILITY_ID = FourCC('A010');
export const BOSS_ADD_CLAP_ABILITY_ID = FourCC('A011');

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
// A000: a Channel copy authored in the world editor (no generated constant).
// Keep in step with DASH_ABILITY in compiletime.ts.
export const DASH_ABILITY_ID = FourCC('A000');
// Dance spells for the idle players in the start lobby. Minted in
// compiletime.ts as Channel copies -- keep the two lists in step.
// Wand of Negation repurposed as the Hero Reroll cast (its native purge is
// irrelevant — the target is replaced the moment the spell lands)
export const REROLL_ABILITY_ID = FourCC(Abilities.ItemIllusions);

// Upgrades
// MagicSentry repurposed as the Summon Heroes tech (gates the summon ability)
export const SUMMON_TECH_ID = FourCC(Upgrades.MagicSentry);

// Items
export const SUMMON_UPGRADE_ITEM_ID = FourCC(Items.HornOfCenarius);
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
//
// Every rawcode here must be one creeps never drop: the map identifies its
// items by rawcode alone, so an item that can come off a corpse is a free
// upgrade. Miscellaneous/Campaign/Purchasable items are safe (WC3 ships them
// with "Include As Random Choice" false); Permanent ones usually are not.
export const FLAME_RESISTANCE_ID = FourCC(Items.AncientFigurine);
export const TRACK_MANUFACTURING_ID = FourCC(Items.BracerOfAgility);
export const RESOURCE_CAPACITY_ID = FourCC(Items.DruidPouch);
export const TRACK_CAPACITY_ID = FourCC(Items.JadeRing);
export const CRATE_CAPACITY_ID = FourCC(Items.LionsRing);
export const MERC_CONTRACT_ID = FourCC(Items.MogrinsReport);
export const MERC_CONTRACT_2_ID = FourCC(Items.SkullOfGuldan);
/** Repairs the fire damage: resets max HP to its starting value. Sold only
 *  while the train is below that, and never alongside Flame Resistance. */
export const RESTORE_HP_ID = FourCC(Items.HeartOfAszune);
/** The Shady Deal: one shelf slot that sells whichever challenge the seeded
 *  sequence is up to. Which one that is comes from challenges.ts, so this
 *  item's name and tooltip are deliberately generic. */
export const CHALLENGE_ITEM_ID = FourCC(Items.Shimmerweed);

/** Everything the shop sells that is consumed on acquisition. */
export const SHOP_UPGRADE_ITEM_IDS: readonly number[] = [
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, SUMMON_UPGRADE_ITEM_ID,
  MERC_CONTRACT_ID, MERC_CONTRACT_2_ID, CHALLENGE_ITEM_ID, RESTORE_HP_ID,
];
