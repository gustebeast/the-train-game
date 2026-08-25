import { TRACK_SIZE } from '../track/constants';

// Grid dimensions (in tile coordinates)
export const GRID_MIN_X = -20;
export const GRID_MAX_X = 20;
export const GRID_MIN_Y = -10;
export const GRID_MAX_Y = 10;
export const GRID_W = GRID_MAX_X - GRID_MIN_X + 1; // 41
export const GRID_H = GRID_MAX_Y - GRID_MIN_Y + 1; // 21

// Reserved areas (must remain empty)
export const SPAWN = { minX: GRID_MIN_X, maxX: GRID_MIN_X + 5, minY: -4, maxY: 0 };
// VICTORY bounds are updated dynamically after path generation: minY = exitY-4, maxY = exitY
export const VICTORY = { minX: GRID_MAX_X - 5, maxX: GRID_MAX_X, minY: -4, maxY: 0 };
/** The second exit, the one that leads to the boss. Only on the board in rounds
 *  with a level 3 camp, so it carries its own on/off rather than being sized to
 *  nothing -- an inactive area of zero width would still reserve a column.
 *  Bounds are filled in by the generator, like VICTORY's. */
export const BOSS_EXIT = { active: false, minX: 0, maxX: 0, minY: 0, maxY: 0 };

export enum Terrain {
  GRASS = 0,
  GRASSY_DIRT = 1,
  ROCK = 2,
  ROUGH_DIRT = 3,
  WHITE_MARBLE = 4,
  BLACK_BRICKS = 5,
  // Dungeon tileset — the boss battlefield. DUNGEON_DIRT is its floor, the
  // other two make the diamond pattern, and LAVA_CRACKS is the surround.
  DUNGEON_DIRT = 6,
  DUNGEON_BRICK = 7,
  DUNGEON_RED_STONE = 8,
  LAVA_CRACKS = 9,
}

export enum Entity {
  NONE = 0,
  TREE = 1,
  ROCK = 2,
  GRANITE = 3,
  WATER = 4,
  WATER_VISIBLE = 16,
  CRATE = 5,
  TRACK = 6,
  TRACK_WITH_ENGINE = 7,
  AXE = 8,
  PICKAXE = 9,
  BUCKET = 10,
  PLAYER_1 = 11,
  PLAYER_2 = 12,
  PLAYER_3 = 13,
  PLAYER_4 = 14,
  START_CIRCLE = 15,
  CRATE_START = 17,
  SHOP = 18,
  REVERT_CIRCLE = 19,
  CREEP_CAMP = 20,
  TRACK_WITH_WAGON = 21,
  CRITTER = 22,
  SHADY_DEALER = 23,
  /** Start lobby: begin a brand new run. */
  NEW_GAME_CIRCLE = 24,
  /** Defeat lobby: abandon the run and go back to the start lobby. */
  RESTART_CIRCLE = 25,
  /** Start lobby: open the save chooser. */
  LOAD_CIRCLE = 26,
  /** Save chooser: leave without picking anything. */
  BACK_CIRCLE = 27,
  /** Save chooser: select the next newer / next older save. */
  PREV_CIRCLE = 28,
  NEXT_CIRCLE = 29,
  /** Save chooser: play the selected save. */
  CONFIRM_CIRCLE = 30,
  /** Start lobby: play the tutorial. */
  TUTORIAL_CIRCLE = 31,
  /** Boss battlefield surround: lava you can see but not walk onto. */
  LAVA = 32,
  /** Seals the boss exit until somebody brings the Strange Key. */
  STRANGE_ROCK = 33,
}

export interface Cell {
  terrain: Terrain;
  entity: Entity;
}

export const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];

export interface GridPos { x: number; y: number; }

export interface Grid {
  cells: Cell[];
  path: boolean[];
  exit: GridPos; // Grid coordinate where the path exits on the right side
  /** The second exit, present only in rounds that can reach the boss. */
  bossExit: GridPos | null;
}

// --- Grid coordinate helpers ---

export function idx(gx: number, gy: number): number {
  return (gy - GRID_MIN_Y) * GRID_W + (gx - GRID_MIN_X);
}

export function idxToCoords(i: number): GridPos {
  const iy = Math.floor(i / GRID_W);
  const ix = i % GRID_W;
  return { x: ix + GRID_MIN_X, y: iy + GRID_MIN_Y };
}

export function inBounds(gx: number, gy: number): boolean {
  return gx >= GRID_MIN_X && gx <= GRID_MAX_X && gy >= GRID_MIN_Y && gy <= GRID_MAX_Y;
}

export function isReserved(gx: number, gy: number): boolean {
  if (gx >= SPAWN.minX && gx <= SPAWN.maxX && gy >= SPAWN.minY && gy <= SPAWN.maxY) return true;
  if (gx >= VICTORY.minX && gx <= VICTORY.maxX && gy >= VICTORY.minY && gy <= VICTORY.maxY) return true;
  if (BOSS_EXIT.active
    && gx >= BOSS_EXIT.minX && gx <= BOSS_EXIT.maxX
    && gy >= BOSS_EXIT.minY && gy <= BOSS_EXIT.maxY) return true;
  return false;
}

export function gridToWorld(pos: GridPos): GridPos {
  return { x: pos.x * TRACK_SIZE, y: pos.y * TRACK_SIZE };
}

// --- Destructable rawcodes ---
export const TREE_RAW = 'LTlt';  // SummerTreeWall (Lordaeron Summer)
export const ROCK_RAW = 'LTrt';  // RockChunks2 (Lordaeron Summer — 6 variations)
export const GRANITE_RAW = 'LTrc';  // RockChunks1 (Lordaeron Summer — indestructible)
export const STRANGE_ROCK_RAW = 'BRoc';  // The boss exit's seal (see compiletime.ts)
export const CAGE_RAW = 'LOcg';  // Cage (creep camp spawner)
/** Pathing Blocker (Ground) (Large). No model at all, so it is invisible, and
 *  its 4x4Default pathing texture covers exactly one TRACK_SIZE cell. Used to
 *  wall off terrain that should look walkable but is not -- the lava around the
 *  boss battlefield -- without the visible unit the lobby's water relies on. */
export const PATH_BLOCKER_RAW = 'YTpc';
