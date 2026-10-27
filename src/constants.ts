import { Abilities } from '@objectdata/abilities';
import { Items } from '@objectdata/items';
import { Units } from '@objectdata/units';
import { Upgrades } from '@objectdata/upgrades';
import {
  UNKNOWN_UNIT, STRANGE_ROCK, DASH_ABILITY, KEY_THROW_ABILITY, BOSS_UNIT, BOSS_ADD_UNIT,
  BOSS_INFERNO_ABILITY, CRITTER_TYPES, SALESPERSON_UNIT, VACUUM_ABILITY, UNHOLY_FRENZY_ABILITY,
  GREATER_UNHOLY_FRENZY_ABILITY, IMBUE_HORSE_ABILITY, GREATER_IMBUE_HORSE_ABILITY,
} from './sharedData';

// Units
export const PEASANT_ID = FourCC(Units.Peasant);
export const TRAIN_ID = FourCC(Units.WarWagon);
export const TRACK_WAGON_ID = FourCC(Units.Wagon);
export const CRATE_ID = FourCC(Units.GrainWarehouse);
export const WATER_ID = FourCC(Units.Burrow);

// The objects compiletime.ts mints; their rawcodes live in sharedData.ts.
export const UNKNOWN_UNIT_ID = FourCC(UNKNOWN_UNIT);
export const STRANGE_ROCK_ID = FourCC(STRANGE_ROCK);
export const KEY_THROW_ABILITY_ID = FourCC(KEY_THROW_ABILITY);
export const BOSS_ID = FourCC(BOSS_UNIT);
export const BOSS_ADD_ID = FourCC(BOSS_ADD_UNIT);
export const BOSS_INFERNO_ABILITY_ID = FourCC(BOSS_INFERNO_ABILITY);
export const DASH_ABILITY_ID = FourCC(DASH_ABILITY);

/** Dropped by a flawless level 3 camp; opens the way to the boss. */
export const BOSS_KEY_ITEM_ID = FourCC(Items.KeyOfThreeMoons);
/** The gold trophy over a party that beat the boss: "Golden Cup" from Reward
 *  Trophies by stan0033 (Hive Workshop), reworked with a deeper gold and an
 *  environment-mapped shine. It reads its texture from
 *  war3mapImported\TrophyGold.blp, which has to keep that name.
 *
 *  Worn through markUnit, so it is one size on every unit. It still takes on
 *  a tinted creep's colour: the engine multiplies everything attached to a
 *  unit by that unit's tint, and nothing set on the effect undoes it. */
export const TROPHY_MODEL = 'war3mapImported\\Trophy.mdx';
/** The worn trophy's size in the world -- what it measured on a hero, where it
 *  looked right. */
export const TROPHY_SCALE = 0.6;

/** How many players the map seats. */
export const MAX_PLAYERS = 4;
/** The roster: how many heroes a run carries. Two are fielded a round. */
export const HERO_SLOTS = 4;
/** How many mercenaries can be hired at once. */
export const MAX_MERCS = 2;

export const CRITTER_TYPE_IDS: ReadonlyArray<number> = CRITTER_TYPES.map(id => FourCC(id));

// Abilities
export const SUMMON_ABILITY_ID = FourCC(Abilities.Roar);
export const UNSUMMON_ABILITY_ID = FourCC(Abilities.RoarNeutralHostile);
export const BUILD_TRACK_ABILITY_ID = FourCC(Abilities.BuildTinyFarm);
export const BRIDGE_ABILITY_ID = FourCC(Abilities.FingerOfDeathNeutralHostile);
export const FILL_ABILITY_ID = FourCC(Abilities.UndefinedNeutralHostile);
export const WATER_TRAIN_ABILITY_ID = FourCC(Abilities.DrunkenHazeChen);
// The Wand of Illusion's ability repurposed as the Hero Reroll cast (its
// native illusion is irrelevant -- the target is replaced the moment the spell
// lands)
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
/** Shop item: makes the next creep camp a level 3 one. */
export const STRANGE_MEAT_ID = FourCC(Items.BloodfeathersHeart);

/** The Secret Salesperson, a shop that turns up on snow rounds. */
export const SALESPERSON_ID = FourCC(SALESPERSON_UNIT);
/** Peasant ability items, sold by the Secret Salesperson. Each grants its
 *  holder an ability and lives in the last inventory slot. */
export const RESOURCE_VACUUM_ID = FourCC(Items.GlyphOfPurification);
export const GREATER_RESOURCE_VACUUM_ID = FourCC(Items.EnchantedGemstone);
/** Salesperson item: turns the buyer's ability item into its Greater version. */
export const UPGRADE_PEASANT_ABILITY_ID = FourCC(Items.Mooncrystal);
export const UNHOLY_BONE_ID = FourCC(Items.BloodKey);
export const GREATER_UNHOLY_BONE_ID = FourCC(Items.GhostKey);
export const HORSE_ESSENCE_ID = FourCC(Items.MoonKey);
export const GREATER_HORSE_ESSENCE_ID = FourCC(Items.SunKey);
/** No spell: a peasant holding it carries 1 more of any stack (2 Greater). */
export const MUSCLE_MILK_ID = FourCC(Items.TheHeartOfSearinox);
export const GREATER_MUSCLE_MILK_ID = FourCC(Items.UrnOfKingTerenas);
/** The spells they grant, all on Q. Vacuum Resources serves both vacuums (the
 *  reach is read off the item); the others are one ability per item, since
 *  the Greater version differs in its numbers. */
export const VACUUM_ABILITY_ID = FourCC(VACUUM_ABILITY);
export const UNHOLY_FRENZY_ABILITY_ID = FourCC(UNHOLY_FRENZY_ABILITY);
export const GREATER_UNHOLY_FRENZY_ABILITY_ID = FourCC(GREATER_UNHOLY_FRENZY_ABILITY);
export const IMBUE_HORSE_ABILITY_ID = FourCC(IMBUE_HORSE_ABILITY);
export const GREATER_IMBUE_HORSE_ABILITY_ID = FourCC(GREATER_IMBUE_HORSE_ABILITY);

/** Everything the shop sells that is consumed on acquisition. */
export const SHOP_UPGRADE_ITEM_IDS: readonly number[] = [
  FLAME_RESISTANCE_ID, TRACK_MANUFACTURING_ID, RESOURCE_CAPACITY_ID,
  TRACK_CAPACITY_ID, CRATE_CAPACITY_ID, SUMMON_UPGRADE_ITEM_ID,
  MERC_CONTRACT_ID, MERC_CONTRACT_2_ID, CHALLENGE_ITEM_ID, RESTORE_HP_ID,
  STRANGE_MEAT_ID, UPGRADE_PEASANT_ABILITY_ID,
];
