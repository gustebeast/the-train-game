import { getHumanPlayers } from './util';
import { TRAIN_INITIAL_MAX_HP, TRAIN_INITIAL_MAX_MANA } from './sharedData';

export interface GameState {
  round: number;
  gold: number;
  trainCargoMaxStack: number;
  trainTrackMaxStack: number;
  peasantMaxStack: number;
  crateMaxStack: number;
  trainMaxHP: number;
  trainMaxMana: number;
  trainSpeed: number;
  crateTrackCount: number;
  crateStoneCount: number;
  crateWoodCount: number;
  /** Seed for outcomes that must survive a reload identically (see rng.ts).
   *  0 means "not yet minted" -- saves written before seeding existed. */
  randomSeed: number;
  /** How many seeded draws this run has taken. Saved with the seed so a
   *  restored save resumes at the same point in the sequence. */
  randomDraws: number;
  /** Position in the shared hero-reroll queue. One queue for all heroes: which
   *  hero you reroll does not change which hero comes next. */
  heroQueuePos: number;
}


export const DEFAULT_STATE: GameState = {
  round: 0,
  gold: 0,
  trainCargoMaxStack: 3,
  trainTrackMaxStack: 3,
  peasantMaxStack: 3,
  crateMaxStack: 10,
  trainMaxHP: TRAIN_INITIAL_MAX_HP,
  trainMaxMana: TRAIN_INITIAL_MAX_MANA,
  trainSpeed: 6,
  crateTrackCount: 0,
  crateStoneCount: 0,
  crateWoodCount: 0,
  randomSeed: 0,
  randomDraws: 0,
  heroQueuePos: 0,
};

/** The single source of truth for persistent game state. */
export const gameState: GameState = { ...DEFAULT_STATE };

/** Whether the game is currently in gameplay (not inter-round lobby). */
let inGameplay = false;

export function isInGameplay(): boolean {
  return inGameplay;
}

export function setInGameplay(value: boolean): void {
  inGameplay = value;
}

/** Registered callbacks to run after syncState (e.g. syncTrainStats). */
const syncCallbacks: Array<() => void> = [];

/** Register a callback that runs whenever state is synced. */
export function registerSyncCallback(cb: () => void): void {
  syncCallbacks.push(cb);
}

/** Ensure all in-game representations match gameState. Idempotent. */
export function syncState(): void {
  syncGold();
  for (const cb of syncCallbacks) cb();
}

/** Overwrite state from a loaded object, then sync everything.
 *  Reset-then-apply: fields missing from the save (e.g. legacy saves
 *  predating a field) fall back to defaults, never session values. */
export function applyState(loaded: GameState): void {
  Object.assign(gameState, DEFAULT_STATE, loaded);
  syncState();
}

/** Set all human players' gold resource to match gameState.gold. */
export function syncGold(): void {
  getHumanPlayers().forEach(p => p.setState(PLAYER_STATE_RESOURCE_GOLD, gameState.gold));
}

/** Pay `cost` from the shared purse. False, with nothing taken, when it holds
 *  less. Either way native gold is put back to match the purse: a shop sale
 *  has already taken the engine's own price from the buyer by the time any
 *  handler runs. */
export function trySpendGold(cost: number): boolean {
  const affordable = gameState.gold >= cost;
  if (affordable) gameState.gold -= cost;
  syncGold();
  return affordable;
}

/** Add to the shared purse and show it. */
export function gainGold(amount: number): void {
  gameState.gold += amount;
  syncGold();
}

