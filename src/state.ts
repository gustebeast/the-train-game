export interface GameState {
  round: number;
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

/** Reset state to defaults (for new game). */
export function resetState(): void {
  Object.assign(gameState, DEFAULT_STATE);
}

/** Overwrite state from a loaded object. */
export function applyState(loaded: GameState): void {
  Object.assign(gameState, loaded);
}
