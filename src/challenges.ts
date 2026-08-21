import { gameState, syncGold } from './state';
import { registerSaveSegment, parseFields } from './save';

/**
 * Shady Dealer challenges — optional wagers bought in the lobby for 1 gold
 * that pay 2 gold when their condition is met, so a completed challenge is a
 * net win of 1.
 *
 * A challenge is a definition plus a bit of state. Definitions live here in one
 * registry; the code that can actually *see* the condition (a track being laid,
 * a dash being cast, the last creep dying) lives with that event and calls
 * `completeChallenge` when it fires. That keeps this file from growing a switch
 * over every system in the map.
 *
 * WHICH challenge is on sale is seeded, not rolled: the offer is a pure
 * function of the saved seed and the list of challenges already bought, so a
 * given save always walks the same sequence. That is also why Reset Purchases
 * cannot be used to shop for a different challenge — it rewinds the purchase,
 * and the same offer comes back. Once every challenge has been bought the
 * history clears and the sequence starts again.
 */

const CHALLENGE_BONUS = 2;
export const CHALLENGE_COST = 1;

export interface ChallengeDef {
  /** Stable short key. Persisted, so never renumber or reuse. */
  id: string;
  name: string;
  description: string;
  /** Progress line for the overlay ("7 / 15", "0:08"). Omit for a challenge
   *  with nothing meaningful to count. */
  progress?: () => string;
}

const defs: ChallengeDef[] = [];

/** Register a challenge. Call at module scope; import the module from main.ts
 *  so every definition exists before the first lobby is built. */
export function defineChallenge(def: ChallengeDef): void {
  defs.push(def);
}

export function getChallengeDefs(): readonly ChallengeDef[] {
  return defs;
}

function findDef(id: string): ChallengeDef | null {
  for (const d of defs) {
    if (d.id === id) return d;
  }
  return null;
}

// --- state ----------------------------------------------------------------

/** The challenge bought and not yet resolved, or null. Only one at a time. */
let armedId: string | null = null;
/** Ids already bought, so the dealer works through the list before repeating. */
let purchased: string[] = [];
/** Fixed per save, so the offer sequence is reproducible. 0 = not yet chosen. */
let seed = 0;

export function isChallengeArmed(id: string): boolean {
  return armedId === id;
}

export function getArmedChallenge(): ChallengeDef | null {
  return armedId == null ? null : findDef(armedId);
}

export function armChallenge(id: string): void {
  armedId = id;
  if (!purchased.includes(id)) purchased.push(id);
}

/** Disarm without paying. Segment reset, and how a lost wager is spent at the
 *  end of a round so it never reaches the save. */
export function clearChallenges(): void {
  armedId = null;
}

/** Pay out the armed challenge and consume it. Safe to call for a challenge
 *  that is not armed, which is what lets event hooks call it unconditionally. */
export function completeChallenge(id: string): void {
  if (armedId !== id) return;
  const def = findDef(id);
  armedId = null;
  gameState.gold += CHALLENGE_BONUS;
  syncGold();
  print('Challenge complete: ' + (def != null ? def.name : id)
    + '! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}

// --- seeded offer ---------------------------------------------------------

/** Deterministic order over the registered ids.
 *
 *  A Fisher-Yates shuffle driven by a small LCG rather than GetRandomInt: the
 *  order has to be identical every time a given save is loaded, and the game's
 *  RNG is neither seedable from here nor safe to disturb (other systems draw
 *  from it, and doing so would desync a multiplayer game). */
function shuffledIds(): string[] {
  const ids = defs.map(d => d.id);
  let state = seed !== 0 ? seed : 1;
  for (let i = ids.length - 1; i > 0; i--) {
    // Numerical Recipes LCG constants, kept inside 32 bits.
    state = (1664525 * state + 1013904223) % 4294967296;
    const j = state % (i + 1);
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  return ids;
}

/** The challenge currently for sale, or null if none are registered.
 *
 *  First unbought id in the seeded order. When everything has been bought the
 *  history clears and the sequence starts over, so the dealer never runs dry. */
export function getOfferedChallenge(): ChallengeDef | null {
  if (defs.length === 0) return null;
  if (seed === 0) seed = GetRandomInt(1, 2147483646);
  const order = shuffledIds();
  for (const id of order) {
    if (!purchased.includes(id)) {
      const def = findDef(id);
      if (def != null) return def;
    }
  }
  // Every challenge bought: wrap around rather than leaving the shelf empty.
  purchased = [];
  return findDef(order[0]);
}

// --- save -----------------------------------------------------------------

/** "s=<seed>;a=<armedId>;p=<id,id,...>" */
function encodeChallenges(): string {
  const parts: string[] = ['s=' + tostring(seed)];
  if (armedId != null) parts.push('a=' + armedId);
  if (purchased.length > 0) parts.push('p=' + table.concat(purchased, ','));
  return table.concat(parts, ';');
}

function decodeChallenges(raw: string): void {
  const fields = parseFields(raw);
  const s = fields['s'];
  if (s != null) seed = tonumber(s) ?? 0;
  const a = fields['a'];
  if (a != null && a !== '') armedId = a;
  const p = fields['p'];
  if (p != null && p !== '') {
    purchased = [];
    for (const [id] of string.gmatch(p, '([^,]+)')) {
      purchased.push(id as string);
    }
  }
  // Legacy saves used "c=1"/"t=1" for the two original challenges.
  if (fields['c'] === '1') armedId = 'crit';
  if (fields['t'] === '1') armedId = 'camp';
}

/** Full reset for a new game: the seed is re-rolled, so a fresh save gets a
 *  fresh sequence, while a loaded save keeps the one it was created with. */
function resetChallenges(): void {
  armedId = null;
  purchased = [];
  seed = 0;
}

registerSaveSegment('ch', encodeChallenges, decodeChallenges, resetChallenges);
