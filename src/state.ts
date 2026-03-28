import { Players } from 'w3ts/globals';

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
}

const DEFAULT_STATE: GameState = {
  round: 0,
  gold: 0,
  trainCargoMaxStack: 3,
  trainTrackMaxStack: 3,
  peasantMaxStack: 3,
  crateMaxStack: 10,
  trainMaxHP: 100,
  trainMaxMana: 100,
  trainSpeed: 6,
  crateTrackCount: 0,
  crateStoneCount: 0,
  crateWoodCount: 0,
};

/** The single source of truth for persistent game state. */
export const gameState: GameState = { ...DEFAULT_STATE };

/** Snapshot of gameState taken on lobby entry, used for revert. */
let lobbySnapshot: GameState | null = null;

/** Registered callbacks to run after applyState (e.g. syncTrainStats). */
const syncCallbacks: Array<() => void> = [];

/** Register a callback that runs whenever state is applied (load/revert). */
export function registerSyncCallback(cb: () => void): void {
  syncCallbacks.push(cb);
}

/** Reset state to defaults (for new game). */
export function resetState(): void {
  Object.assign(gameState, DEFAULT_STATE);
}

/** Overwrite state from a loaded object, then sync gold and registered callbacks. */
export function applyState(loaded: GameState): void {
  Object.assign(gameState, loaded);
  syncGold();
  for (const cb of syncCallbacks) cb();
}

/** Set all human players' gold resource to match gameState.gold. */
export function syncGold(): void {
  Players.forEach(p => {
    if (p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER) {
      p.setState(PLAYER_STATE_RESOURCE_GOLD, gameState.gold);
    }
  });
}

/** Save a snapshot of the current gameState for lobby revert. */
export function saveLobbySnapshot(): void {
  lobbySnapshot = { ...gameState };
}

/** Restore gameState from the lobby snapshot. Returns false if no snapshot exists. */
export function revertToLobbySnapshot(): boolean {
  if (lobbySnapshot == null) return false;
  applyState(lobbySnapshot);
  return true;
}
