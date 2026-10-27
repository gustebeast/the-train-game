import { gainGold } from './state';
import { boardChanged } from './boardSignal';
import { registerSaveSegment, parseFields, parseList } from './save';
import { deriveSeed, shuffleSeeded, STREAMS } from './rng';
import { CHALLENGE_BONUS } from './sharedData';

/**
 * Shady Dealer challenges — optional wagers bought in the inter-round lobby for 1 gold
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
 * function of the saved seed and the challenges already offered this lap, so a
 * given save always walks the same sequence. That is also why Reset Purchases
 * cannot be used to shop for a different challenge — it rewinds the purchase,
 * and the same offer comes back. Once every challenge has been offered the lap
 * ends and the sequence starts again.
 */


export interface ChallengeDef {
  /** Stable short key. Persisted, so never renumber or reuse. */
  id: string;
  name: string;
  description: string;
  /** Progress line for the overlay ("7 / 15", "0:08"). Omit for a challenge
   *  with nothing meaningful to count. */
  progress?: (this: void) => string;
  /** Won simply by reaching the end of the line with it armed: nothing to
   *  count, so it pays out when the last track is laid. */
  completesOnFinalTrack?: boolean;
}

const defs: ChallengeDef[] = [];

/** Register a challenge. Call at module scope; import the module from main.ts
 *  so every definition exists before the first inter-round lobby is built. */
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

// --- state -------------------------------------------------------------------

/** The challenge bought and not yet resolved, or null. Only one at a time. */
let armedId: string | null = null;
/** Ids already OFFERED this lap, so the dealer works through the whole list
 *  before repeating. Offered, not bought: gating on purchases meant one
 *  challenge the player never wants to buy would sit on the shelf forever and
 *  block everything behind it. */
let seen: string[] = [];

/** The challenge currently on the shelf. Held rather than recomputed, so
 *  asking twice in an inter-round lobby visit does not burn through the rotation. */
let offeredId: string | null = null;

/** How many times the player has been offered every challenge and come back
 *  round. Folded into the shuffle so each pass through the list is a DIFFERENT
 *  order -- otherwise the dealer would replay the same sequence forever -- while
 *  staying a pure function of the save, so a reload still reproduces it. */
let cycles = 0;
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
  boardChanged();
}

/** Disarm without paying: how a lost wager is spent at the end of a round, so
 *  it never reaches the save. */
export function clearChallenges(): void {
  armedId = null;
  boardChanged();
}

/** Pay out the armed challenge and consume it. Safe to call for a challenge
 *  that is not armed, which is what lets event hooks call it unconditionally. */
export function completeChallenge(id: string): void {
  if (armedId !== id) return;
  const def = findDef(id);
  armedId = null;
  boardChanged();
  gainGold(CHALLENGE_BONUS);
  print('Challenge complete: ' + (def != null ? def.name : id)
    + '! +' + I2S(CHALLENGE_BONUS) + ' bonus gold.');
}

// --- seeded offer ------------------------------------------------------------

/** Deterministic order over the registered ids: the same for a given save
 *  every time it is loaded, and different on every lap (the cycle count is
 *  folded into the seed, by a large odd multiplier so that adjacent laps do
 *  not open alike).
 *
 *  Challenges do NOT repeat within a lap -- `seen` is the history that
 *  enforces that -- which is the opposite of the hero reroll, where repeats are
 *  fine as long as it is not a hero you already have. */
function shuffledIds(): string[] {
  const ids = defs.map(d => d.id);
  shuffleSeeded(ids, (seed !== 0 ? seed : 1) + cycles * 2654435761);
  return ids;
}

/** Put the next challenge on the shelf. Called once per inter-round lobby visit.
 *
 *  Takes the first id of the lap not yet OFFERED, and marks it offered there
 *  and then -- so declining it still moves the rotation on. When the lap is
 *  done the history clears and the cycle count bumps, which reshuffles the
 *  order for the next pass (see shuffledIds), so the dealer never runs dry and
 *  never replays the same sequence. */
export function advanceChallengeOffer(): void {
  if (defs.length === 0) { offeredId = null; return; }
  if (seed === 0) seed = deriveSeed(STREAMS.challenge);

  let order = shuffledIds();
  let next = order.find(id => !seen.includes(id));
  if (next == null) {
    seen = [];
    cycles += 1;
    order = shuffledIds();
    next = order[0];
  }
  offeredId = next;
  seen.push(next);
}

/** The challenge currently for sale, or null if none are registered. */
export function getOfferedChallenge(): ChallengeDef | null {
  if (defs.length === 0) return null;
  // A fresh run has no offer yet: put one out now.
  if (offeredId == null) advanceChallengeOffer();
  return offeredId == null ? null : findDef(offeredId);
}

// --- save --------------------------------------------------------------------

/** "s=<seed>;n=<cycles>;a=<armedId>;o=<offeredId>;p=<id,id,...>" -- n, a, o
 *  and p only when set. */
function encodeChallenges(): string {
  const parts: string[] = ['s=' + tostring(seed)];
  if (cycles > 0) parts.push('n=' + tostring(cycles));
  if (armedId != null) parts.push('a=' + armedId);
  if (offeredId != null) parts.push('o=' + offeredId);
  if (seen.length > 0) parts.push('p=' + table.concat(seen, ','));
  return table.concat(parts, ';');
}

function decodeChallenges(raw: string): void {
  const fields = parseFields(raw);
  const s = fields['s'];
  if (s != null) seed = tonumber(s) ?? 0;
  const n = fields['n'];
  if (n != null) cycles = tonumber(n) ?? 0;
  const a = fields['a'];
  if (a != null && a !== '') armedId = a;
  const o = fields['o'];
  if (o != null && o !== '') offeredId = o;
  const p = fields['p'];
  if (p != null && p !== '') seen = parseList(p);
}

/** Full reset for a new game: the seed is re-rolled, so a fresh save gets a
 *  fresh sequence, while a loaded save keeps the one it was created with. */
function resetChallenges(): void {
  armedId = null;
  seen = [];
  offeredId = null;
  seed = 0;
  cycles = 0;
}

registerSaveSegment('ch', encodeChallenges, decodeChallenges, resetChallenges);
