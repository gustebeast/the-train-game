import { Units } from '@objectdata/units';
import { Items } from '@objectdata/items';
import { Abilities } from '@objectdata/abilities';

/**
 * Values that BOTH sides of the build need: compiletime.ts, which authors the
 * object data, and the game code that uses it.
 *
 * They used to be typed twice -- a rawcode in compiletime.ts and again in
 * constants.ts, a "+10 health" in a tooltip and again in shop.ts -- with
 * comments asking for the two to be kept in step. A mismatch failed silently:
 * a CreateUnit returning null, a tooltip quoting the wrong number. Now each is
 * written here once. The game imports this module like any other;
 * compiletime.ts loads it through loadShared (see the top of that file).
 *
 * The rule that makes the second half possible: this is DATA. It may import
 * only @objectdata constants, and must not call anything -- no FourCC, no
 * natives -- because at build time none of that exists. Convert at the use
 * site (FourCC(STRANGE_ROCK)) instead. track/constants.ts lives by the same
 * rule, and is loaded the same way.
 */

// --- Objects compiletime.ts mints ---------------------------------------------
// Fresh rawcodes for copies, so a copy can never collide with a stock object
// something else relies on. A000 is the exception: it was authored in the World
// Editor and has no generated constant, so it is named here too.

/** The "?" standing in for a hero or mercenary rolled but not yet seen. */
export const UNKNOWN_UNIT = 'qmrk';
/** The Strange Rock sealing the boss exit -- a unit, so the key can target it. */
export const STRANGE_ROCK = 'srok';
/** The dash: a Channel copy, since stock Channel is the give/take spell. */
export const DASH_ABILITY = 'A000';
/** The Strange Key's throw: a copy of Transmute, leaving the Alchemist's alone. */
export const KEY_THROW_ABILITY = 'A012';
/** The final boss. */
export const BOSS_UNIT = 'ubos';
/** The lesser infernal the boss calls down. */
export const BOSS_ADD_UNIT = 'uinl';
/** The boss's Inferno: a copy of the neutral hostile one, the only version a
 *  non-hero can cast. */
export const BOSS_INFERNO_ABILITY = 'A010';
/** The lesser infernal's Thunder Clap, a copy so the Mountain King's is untouched. */
export const ADD_THUNDER_CLAP_ABILITY = 'A011';

// --- Pools ----------------------------------------------------------------------

/** Every hero a run can roll: the standard heroes, tavern included. The build
 *  sizes and paths each of them to match the peasant. */
export const HERO_POOL: string[] = [
  // Human
  Units.Paladin, Units.Archmage, Units.MountainKing, Units.BloodMage,
  // Orc
  Units.Blademaster, Units.FarSeer, Units.TaurenChieftain, Units.ShadowHunter,
  // Undead
  Units.DeathKnight, Units.Lich, Units.Dreadlord, Units.CryptLord,
  // Night Elf
  Units.DemonHunter, Units.KeeperOfTheGrove, Units.PriestessOfTheMoon, Units.Warden,
  // Tavern
  Units.Beastmaster, Units.DarkRanger, Units.PitLord, Units.Tinker,
  Units.Firelord, Units.Alchemist, Units.Brewmaster, Units.SeaWitch,
];

/** The wandering animals of the classic 1v1 melee maps. Already small, so the
 *  build leaves them out of its blanket shrink. */
export const CRITTER_TYPES: string[] = [
  Units.Rabbit, Units.Stag, Units.Sheep, Units.Pig, Units.Chicken, Units.Raccoon,
];

// --- Movement -------------------------------------------------------------------

/** WC3's gameplay-constant ceiling on move speed. A unit's own maximum clamps
 *  SetUnitMoveSpeed, so everything that has to reach it -- the dash, the train
 *  and its wagon -- is authored with this as its maximum. */
export const MAX_MOVE_SPEED = 522;

// --- How the materials look -------------------------------------------------------
// Each is worn twice: as the item's own model on the ground, and as the load
// the engine or wagon is visibly carrying (cargoVisuals.ts).

export const STONE_MODEL = 'Doodads\\LordaeronSummer\\Rocks\\Lords_Rock\\Lords_Rock6.mdx';
export const WOOD_MODEL = 'Doodads\\Felwood\\Props\\FelwoodLogStraight\\FelwoodLogStraight.mdx';
/** A track piece small enough to carry: in a peasant's hand, and in the wagon. */
export const SMALL_TRACK_MODEL = 'war3mapImported\\OmniTrackSmall.mdx';

// --- What a peasant shows it is carrying ----------------------------------------

/** A model shown on a unit through an ability: one of the stock Item Damage
 *  Bonus abilities, repurposed purely for its attachment art (the build zeroes
 *  its bonus, which the damage test holds it to). */
export interface Attachment { ability: string; model: string; point: string; }

/** The tool in a peasant's hand, by the item it is carrying. Wood and stone
 *  are not here: they use the peasant's own lumber and gold carry animations. */
export const CARRIED_TOOLS: { [itemRawcode: string]: Attachment } = {
  [Items.SturdyWarAxe]: { ability: Abilities.ItemDamageBonusPlus7, model: 'war3mapImported\\Axe.mdx', point: 'left,hand' },
  [Items.RustyMiningPick]: { ability: Abilities.ItemDamageBonusPlus8, model: 'war3mapImported\\Pickaxe.mdx', point: 'left,hand' },
  [Items.MechanicalCritter]: { ability: Abilities.ItemDamageBonusPlus10, model: SMALL_TRACK_MODEL, point: 'left,hand' },
  [Items.EmptyVial]: { ability: Abilities.ItemDamageBonusPlus2, model: 'war3mapImported\\Bucket.mdx', point: 'left,hand' },
  [Items.FullVial]: { ability: Abilities.ItemDamageBonusPlus4, model: 'war3mapImported\\BucketFull.mdx', point: 'left,hand' },
};

/** The orb over a peasant standing in a ready circle. */
export const READY_ORB: Attachment = {
  ability: Abilities.ItemDamageBonusPlus6, model: 'war3mapImported\\ReadyOrb.mdx', point: 'head',
};

// --- The train --------------------------------------------------------------------

/** The train's max HP at the start of a run. Repair Train resets to exactly
 *  this, so Flame Resistance upgrades bought earlier are not refunded. */
export const TRAIN_INITIAL_MAX_HP = 100;

// --- The shop ---------------------------------------------------------------------

/** What each shop upgrade does, quoted by its tooltip and applied on purchase. */
export const FLAME_RESISTANCE_HP = 10;
export const TRACK_MANUFACTURING_MANA = 10;
/** Track Manufacturing never takes the train's mana below this. */
export const TRACK_MANUFACTURING_MIN_MANA = 10;
export const RESOURCE_CAPACITY_STEP = 2;
export const TRACK_CAPACITY_STEP = 2;
export const CRATE_CAPACITY_STEP = 4;

/** The Shady Deal: what it costs, and what completing the challenge pays. */
export const CHALLENGE_COST = 1;
export const CHALLENGE_BONUS = 2;

/** The Reroll's price, refunded in full if it is sold back. */
export const REROLL_COST = 1;

/** One item on a shelf: its price in gold, and how many the shelf holds. */
export interface ShelfItem { cost: number; stock: number; }

/** Everything the shop and the dealer sell, by item rawcode.
 *
 *  The price is charged twice over, which is why it lives here: the engine
 *  takes the object-data gold cost from the buyer's native gold, and shop.ts
 *  takes it from gameState.gold, the map's real purse. The two have to agree
 *  or the engine either refuses a purchase the map would allow, or lets one
 *  through that the map then has to undo. */
export const SHELF: { [itemRawcode: string]: ShelfItem } = {
  [Items.AncientFigurine]: { cost: 1, stock: 10 },     // Flame Resistance
  [Items.BracerOfAgility]: { cost: 1, stock: 10 },     // Track Manufacturing
  [Items.DruidPouch]: { cost: 1, stock: 10 },          // Train Resource Capacity
  [Items.JadeRing]: { cost: 1, stock: 10 },            // Train Track Capacity
  [Items.LionsRing]: { cost: 1, stock: 10 },           // Crate Capacity
  [Items.HeartOfAszune]: { cost: 1, stock: 1 },        // Repair Train
  [Items.HornOfCenarius]: { cost: 1, stock: 1 },       // Summon Heroes Upgrade
  [Items.MogrinsReport]: { cost: 1, stock: 1 },        // Mercenary Contract
  [Items.SkullOfGuldan]: { cost: 1, stock: 1 },        // Second Contract
  [Items.BloodfeathersHeart]: { cost: 1, stock: 10 },  // Strange Meat
  [Items.Shimmerweed]: { cost: CHALLENGE_COST, stock: 1 }, // Shady Deal
  [Items.VoodooDoll]: { cost: REROLL_COST, stock: 10 }, // Reroll
};
