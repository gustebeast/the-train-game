import { TRACK_SIZE } from '../track/constants';
import { TREE_WALLS } from '../sharedData';

// Grid dimensions (in tile coordinates)
export const GRID_MIN_X = -20;
export const GRID_MAX_X = 20;
export const GRID_MIN_Y = -10;
export const GRID_MAX_Y = 10;
export const GRID_W = GRID_MAX_X - GRID_MIN_X + 1; // 41
export const GRID_H = GRID_MAX_Y - GRID_MIN_Y + 1; // 21

/** A rectangle of tiles, bounds inclusive. */
export interface Area { minX: number; maxX: number; minY: number; maxY: number; }

/** The cleared ground the players, tools and train start on. Kept empty. */
export const SPAWN: Area = { minX: GRID_MIN_X, maxX: GRID_MIN_X + 5, minY: -4, maxY: 0 };

/** How far the cleared ground around an exit reaches: this many columns west
 *  of it and rows south of it, so 6 x 5 tiles with the exit at the north-east
 *  corner. Kept empty, like SPAWN, so the last stretch of line is buildable. */
export const EXIT_AREA_WEST = 5;
export const EXIT_AREA_SOUTH = 4;

/** The middle of the back row in the 9x9 lobbies: the shop's square in the
 *  inter-round lobby (LOBBY_GRID), the trophy's in the victory lobby, and where
 *  the save chooser stands the party it is showing. */
export const LOBBY_BACK_CENTRE: GridPos = { x: 0, y: 3 };

/** Where the line ends on the cheat map and the tutorial: a short, straight
 *  run from the start, on row 0. */
export const CHEAT_EXIT_X = GRID_MIN_X + 11;

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
  // Under a round's water. Like GRASS and GRASSY_DIRT, the tile it paints
  // depends on the round's biome.
  POOL = 10,
}

/** The look of a round, set by its creep camp's level: the harder the camp,
 *  the later the season. Lobbies and the boss arena stay SUMMER. */
export enum Biome {
  SUMMER = 0,
  FALL = 1,
  WINTER = 2,
}

export interface BiomeArt {
  grass: string;
  grassyDirt: string;
  pool: string;
  tree: string;
}

export const BIOMES: Record<Biome, BiomeArt> = {
  [Biome.SUMMER]: { grass: 'Lgrs', grassyDirt: 'Lgrd', pool: 'Lrok', tree: TREE_WALLS.summer },
  [Biome.FALL]: { grass: 'Fgrs', grassyDirt: 'Fgrd', pool: 'Frok', tree: TREE_WALLS.fall },
  [Biome.WINTER]: { grass: 'Wsnw', grassyDirt: 'Wsng', pool: 'Wrok', tree: TREE_WALLS.winter },
};

/** Camp level 1/2/3 -> summer/fall/winter. No camp (or anything out of range)
 *  is summer. */
export function biomeForCampLevel(level: number | null): Biome {
  if (level === 2) return Biome.FALL;
  if (level != null && level >= 3) return Biome.WINTER;
  return Biome.SUMMER;
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
  /** Boss battlefield: where a hero, a mercenary or the boss itself stands.
   *  Marks a place rather than making anything -- who ends up on each spot is
   *  decided when the arena loads, since it depends on who is playing. */
  HERO_SPOT = 34,
  MERC_SPOT = 35,
  BOSS_SPOT = 36,
  /** Snow rounds only: the Secret Salesperson. */
  SALESPERSON = 37,
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
  biome: Biome;
}

/** The cleared ground around an exit (see EXIT_AREA_WEST). */
export function exitArea(exit: GridPos): Area {
  return {
    minX: exit.x - EXIT_AREA_WEST, maxX: exit.x,
    minY: exit.y - EXIT_AREA_SOUTH, maxY: exit.y,
  };
}

export function inArea(area: Area, gx: number, gy: number): boolean {
  return gx >= area.minX && gx <= area.maxX && gy >= area.minY && gy <= area.maxY;
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

/** Whether a tile must stay clear on this grid: the spawn, and the ground
 *  around each of its exits.
 *
 *  Read off the grid's own exits. These used to be module-level areas the round
 *  generator rewrote, so a board that placed its exit some other way -- the cheat
 *  map, the tutorial -- kept clearing ground around wherever the LAST round's
 *  exits had been. */
export function isReserved(grid: Grid, gx: number, gy: number): boolean {
  if (inArea(SPAWN, gx, gy)) return true;
  if (inArea(exitArea(grid.exit), gx, gy)) return true;
  return grid.bossExit != null && inArea(exitArea(grid.bossExit), gx, gy);
}

export function gridToWorld(pos: GridPos): GridPos {
  return { x: pos.x * TRACK_SIZE, y: pos.y * TRACK_SIZE };
}

// --- Destructables ---
// The ones the build retunes (trees, rocks, granite, the cage) are named in
// sharedData.ts.

/** Scale for each variation of the rock-chunk model, so every rock -- resource,
 *  granite, and the Strange Rock -- comes out the same size for the same shape. */
export const ROCK_MODEL_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];
/** Pathing Blocker (Ground) (Large). No model at all, so it is invisible, and
 *  its 4x4Default pathing texture covers exactly one TRACK_SIZE cell. Used to
 *  wall off terrain that should look walkable but is not -- the lava around the
 *  boss battlefield -- without the visible unit the lobby's water relies on. */
export const PATH_BLOCKER_RAW = 'YTpc';
