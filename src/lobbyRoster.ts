import { gridToWorld } from './terrain/constants';
import { syncLobbyHeroes, clearLobbyHeroes } from './heroes';
import { syncLobbyMercs, clearLobbyMercs, hasActiveMerc } from './mercenary';
import { isSummonUpgradePurchased } from './summonUpgrade';

/**
 * Where everyone you own stands while you shop.
 *
 * The roster fills the south-east corner of the 9x9 lobby, laid out as it
 * reads on screen (north up):
 *
 *     .  .  .  .
 *     .  .  .  M     <- second mercenary
 *     .  .  .  M     <- first mercenary
 *     H  H  H  H     <- the four heroes
 *
 * Tucked into the corner deliberately: it keeps the roster clear of the shop,
 * the dealer and the two ready circles in the middle, so nothing you walk
 * over is ever hidden behind a hero.
 *
 * A hero's spot is its index into the roster, and a mercenary's spot is its
 * contract slot, so a given hero or contract always stands in the same place
 * -- including across a reroll, which replaces the unit where it stands.
 */
const HERO_SPOTS = [
  { x: 1, y: -4 }, { x: 2, y: -4 }, { x: 3, y: -4 }, { x: 4, y: -4 },
].map(p => gridToWorld(p));

const MERC_SPOTS = [
  { x: 4, y: -3 }, { x: 4, y: -2 },
].map(p => gridToWorld(p));

/** Forget the display units. Call after the terrain sweep has removed them,
 *  and before refreshing: the handles are dead, and WC3 recycles handles, so a
 *  stale reference can otherwise start reading as some unrelated new unit. */
export function resetLobbyRoster(): void {
  clearLobbyHeroes();
  clearLobbyMercs();
}

/** Stand up anyone who is missing from the roster.
 *
 *  Additive rather than a rebuild, so it is safe to call mid-lobby: buying a
 *  contract puts that mercenary on the floor immediately instead of making you
 *  wait a whole round to meet what you paid for, and the heroes and
 *  mercenaries already standing (and whatever they are holding) are untouched. */
export function refreshLobbyRoster(): void {
  syncLobbyHeroes(HERO_SPOTS);
  syncLobbyMercs(MERC_SPOTS);
}

/** Whether the lobby currently holds anything the Reroll item could target.
 *  Drives whether the shop bothers stocking it. */
export function hasLobbyRerollTargets(): boolean {
  return isSummonUpgradePurchased() || hasActiveMerc();
}
