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

export enum Terrain {
  GRASS = 0,
  GRASSY_DIRT = 1,
  ROCK = 2,
  ROUGH_DIRT = 3,
  WHITE_MARBLE = 4,
  BLACK_BRICKS = 5,
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
  TRACK_WITH_TRAIN = 7,
  AXE = 8,
  PICKAXE = 9,
  BUCKET = 10,
  PLAYER_1 = 11,
  PLAYER_2 = 12,
  PLAYER_3 = 13,
  PLAYER_4 = 14,
  START_CIRCLE = 15,
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
  return false;
}

export function gridToWorld(pos: GridPos): GridPos {
  return { x: pos.x * TRACK_SIZE, y: pos.y * TRACK_SIZE };
}

// --- Destructable rawcodes ---
export const TREE_RAW = 'LTlt';  // SummerTreeWall (Lordaeron Summer)
export const ROCK_RAW = 'LTrt';  // RockChunks2 (Lordaeron Summer — 6 variations)
export const GRANITE_RAW = 'LTrc';  // RockChunks1 (Lordaeron Summer — indestructible)
