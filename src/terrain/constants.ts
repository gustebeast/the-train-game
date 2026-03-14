import { TRACK_SIZE } from '../track/constants';

// Grid dimensions (in tile coordinates)
export const GRID_MIN_X = -26;
export const GRID_MAX_X = 26;
export const GRID_MIN_Y = -10;
export const GRID_MAX_Y = 10;
export const GRID_W = GRID_MAX_X - GRID_MIN_X + 1; // 53
export const GRID_H = GRID_MAX_Y - GRID_MIN_Y + 1; // 21

// Reserved areas (must remain empty)
export const SPAWN = { minX: -26, maxX: -21, minY: -4, maxY: 0 };
// VICTORY bounds are updated dynamically after path generation: minY = exitY-4, maxY = exitY
export const VICTORY = { minX: 21, maxX: 26, minY: -4, maxY: 0 };

export enum CellType {
  EMPTY = 0,
  TREE = 1,
  ROCK = 2,
  WATER = 3,
  GRANITE = 4,
}

export const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];

export interface Grid {
  cells: CellType[];
  path: boolean[];
  exitY: number; // Y coordinate where the path exits on the right side
}

// --- Grid coordinate helpers ---

export function idx(gx: number, gy: number): number {
  return (gy - GRID_MIN_Y) * GRID_W + (gx - GRID_MIN_X);
}

export function idxToCoords(i: number): { x: number; y: number } {
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
  return false;
}

export function gridToWorld(gx: number, gy: number): { x: number; y: number } {
  return { x: gx * TRACK_SIZE, y: gy * TRACK_SIZE };
}

// --- Destructable rawcodes ---
export const TREE_RAW = 'LTlt';  // SummerTreeWall (Lordaeron Summer)
export const ROCK_RAW = 'LTrt';  // RockChunks2 (Lordaeron Summer — 6 variations)
