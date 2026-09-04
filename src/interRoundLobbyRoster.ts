import { gridToWorld } from './terrain/constants';
import { syncInterRoundLobbyHeroes, clearInterRoundLobbyHeroes } from './heroes';
import { syncInterRoundLobbyMercs, clearInterRoundLobbyMercs, hasActiveMerc } from './mercenary';
import { isSummonUpgradePurchased } from './summonUpgrade';

/**
 * Where everyone you own stands while you shop.
 *
 * One column down the east edge of the 9x9 inter-round lobby, straddling the
 * east-west centre line -- three of each side of it, and nothing standing on
 * it:
 *
 *     y= 3   M     <- the mercenaries, contract slots 0 and 1
 *     y= 2   M
 *     y= 1   H     <- hero 0
 *     y= 0   .        the centre line, left clear
 *     y=-1   H     <- heroes 1, 2, 3
 *     y=-2   H
 *     y=-3   H
 *
 * A single file against the edge rather than a block in the corner: the column
 * reads top to bottom in roster order, and it keeps the whole middle of the
 * floor -- the shop, the dealer, the two ready circles and the player spawns --
 * clear of anything you could mistake for scenery or lose a hero behind.
 *
 * A hero's spot is its index into the roster, and a mercenary's spot is its
 * contract slot, so a given hero or contract always stands in the same place
 * -- including across a reroll, which replaces the unit where it stands.
 */
const ROSTER_COLUMN_X = 4;

const HERO_SPOTS = [
  { x: ROSTER_COLUMN_X, y: 1 },
  { x: ROSTER_COLUMN_X, y: -1 },
  { x: ROSTER_COLUMN_X, y: -2 },
  { x: ROSTER_COLUMN_X, y: -3 },
].map(p => gridToWorld(p));

const MERC_SPOTS = [
  { x: ROSTER_COLUMN_X, y: 3 },
  { x: ROSTER_COLUMN_X, y: 2 },
].map(p => gridToWorld(p));

/** The roster's spots, in world coordinates. Exposed so a test can hold the
 *  LAYOUT to the shape above without needing every slot to be filled -- a
 *  second mercenary you have not bought leaves no unit to measure. */
export function getRosterSpots(): { heroes: typeof HERO_SPOTS; mercs: typeof MERC_SPOTS } {
  return { heroes: HERO_SPOTS, mercs: MERC_SPOTS };
}

/** Forget the display units. Call after the terrain sweep has removed them,
 *  and before refreshing: the handles are dead, and WC3 recycles handles, so a
 *  stale reference can otherwise start reading as some unrelated new unit. */
export function resetInterRoundLobbyRoster(): void {
  clearInterRoundLobbyHeroes();
  clearInterRoundLobbyMercs();
}

/** Stand up anyone who is missing from the roster.
 *
 *  Additive rather than a rebuild, so it is safe to call mid-lobby: buying a
 *  contract puts that mercenary on the floor immediately instead of making you
 *  wait a whole round to meet what you paid for, and the heroes and
 *  mercenaries already standing (and whatever they are holding) are untouched. */
export function refreshInterRoundLobbyRoster(): void {
  syncInterRoundLobbyHeroes(HERO_SPOTS);
  syncInterRoundLobbyMercs(MERC_SPOTS);
}

/** Whether the inter-round lobby currently holds anything the Reroll item could target.
 *  Drives whether the shop bothers stocking it. */
export function hasInterRoundLobbyRerollTargets(): boolean {
  return isSummonUpgradePurchased() || hasActiveMerc();
}
