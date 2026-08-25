import {
  Terrain, Entity, Cell, Grid, GridPos, DIRS, SPAWN, VICTORY, BOSS_EXIT,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y, GRID_W, GRID_H,
  idx, idxToCoords, inBounds, isReserved,
} from './constants';
import { isChallengeArmed } from '../challenges';
import { CH_CRITTERPOCALYPSE } from '../challengeList';


// --- Grid creation ---

function createGrid(): Grid {
  const size = GRID_W * GRID_H;
  const cells: Cell[] = [];
  const path: boolean[] = [];
  for (let i = 0; i < size; i++) {
    cells[i] = { terrain: Terrain.GRASS, entity: Entity.NONE };
    path[i] = false;
  }
  return { cells, path, exit: { x: GRID_MAX_X, y: 0 }, bossExit: null };
}

// --- Find a random empty tile (no entity, not reserved) ---

function findEmpty(
  grid: Grid,
  minX: number, maxX: number, minY: number, maxY: number,
): GridPos | null {
  const candidates: GridPos[] = [];
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const i = idx(gx, gy);
      if (grid.cells[i].entity === Entity.NONE && !isReserved(gx, gy)) {
        candidates.push({ x: gx, y: gy });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[GetRandomInt(0, candidates.length - 1)];
}

// --- Grow a blob of connected tiles ---

function growBlob(
  grid: Grid,
  seedX: number, seedY: number,
  targetSize: number,
  entity: Entity,
): number {
  const seedIdx = idx(seedX, seedY);
  if (grid.cells[seedIdx].entity !== Entity.NONE) return 0;

  grid.cells[seedIdx].entity = entity;
  let placed = 1;

  // Frontier: indices of neighboring empty tiles
  const frontier: number[] = [];

  function addNeighbors(gx: number, gy: number): void {
    for (const [dx, dy] of DIRS) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (!inBounds(nx, ny) || isReserved(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (grid.cells[ni].entity !== Entity.NONE) continue;
      frontier.push(ni);
    }
  }

  addNeighbors(seedX, seedY);

  while (placed < targetSize && frontier.length > 0) {
    // Pick random frontier tile (swap-remove for speed)
    const fi = GetRandomInt(0, frontier.length - 1);
    const ci = frontier[fi];
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();

    if (grid.cells[ci].entity !== Entity.NONE) continue;
    const coords = idxToCoords(ci);

    grid.cells[ci].entity = entity;
    placed++;
    addNeighbors(coords.x, coords.y);
  }

  return placed;
}

// ============================================================
// Step 1: Generate guaranteed path from start to end
// ============================================================

function generatePath(grid: Grid, exitX: number, exitY?: number): void {
  let x = GRID_MIN_X;
  let y = 0;
  grid.path[idx(x, y)] = true;

  // Update VICTORY area X bounds around the target exit
  VICTORY.minX = exitX - 5;
  VICTORY.maxX = exitX;

  if (exitY != null) {
    // Fixed exit: straight path to the target
    while (x < exitX) {
      x++;
      grid.path[idx(x, y)] = true;
    }
    y = exitY;
  } else {
    // Minimum exit Y so the victory area (exitY-4 to exitY) fits in bounds
    const MIN_EXIT_Y = GRID_MIN_Y + 4;

    while (x < exitX) {
      // Take 2-4 eastward steps
      const eastSteps = GetRandomInt(2, 4);
      for (let i = 0; i < eastSteps && x < exitX; i++) {
        x++;
        grid.path[idx(x, y)] = true;
      }
      if (x >= exitX) break;

      // How many columns remain to the victory area
      const colsToVictory = VICTORY.minX - x;

      // If we're too low and running out of room, force northward
      if (y < MIN_EXIT_Y && colsToVictory <= (MIN_EXIT_Y - y) * 2) {
        const stepsNeeded = MIN_EXIT_Y - y;
        for (let i = 0; i < stepsNeeded; i++) {
          y++;
          grid.path[idx(x, y)] = true;
        }
        continue;
      }

      // Take 1-4 N/S steps in one consistent direction
      const nsSteps = GetRandomInt(1, 4);
      let dir: number;
      if (y < MIN_EXIT_Y && colsToVictory <= 10) {
        // Bias northward when low and getting close
        dir = 1;
      } else {
        dir = GetRandomInt(0, 1) === 0 ? 1 : -1;
      }
      for (let i = 0; i < nsSteps; i++) {
        const newY = y + dir;
        if (newY >= GRID_MIN_Y + 1 && newY <= GRID_MAX_Y - 1) {
          y = newY;
          grid.path[idx(x, y)] = true;
        }
      }
    }
  }

  // If the path ended too low for the victory area, walk it up one column west of the exit
  // so the path always connects to the victory tile from the west
  if (y < GRID_MIN_Y + 4) {
    const correctionX = exitX - 1;
    grid.path[idx(correctionX, y)] = true;
    while (y < GRID_MIN_Y + 4) {
      y++;
      grid.path[idx(correctionX, y)] = true;
    }
    grid.path[idx(exitX, y)] = true;
  }

  // Store exit point and update VICTORY area Y bounds around it
  grid.exit = { x: exitX, y };
  VICTORY.minY = y - 4;
  VICTORY.maxY = y;
}

/** How far the boss exit must sit from the ordinary one, in tiles. Enough that
 *  the two reserved areas cannot touch: each is 5 tall. */
const BOSS_EXIT_GAP = 7;
/** The boss exit's reserved area, matching VICTORY's 6x5. */
const BOSS_EXIT_W = 5;
const BOSS_EXIT_H = 4;

/**
 * A second exit on the right edge, leading to the boss.
 *
 * Placed as far from the ordinary exit as the map allows, so the two are never
 * confused for each other, and given the same guarantee: the corridor to it is
 * marked as path, and placeGranite leaves path tiles alone. Without that a run
 * of granite could seal the boss off entirely and the round would be
 * unwinnable-by-that-route through no fault of the player.
 *
 * The connection is an L drawn back to the ordinary exit's row rather than a
 * fresh route from the start. The main path already reaches that row, so
 * joining it is enough to reach everything -- and it keeps the branch short,
 * which matters because every path tile is a tile granite may not use.
 */
function generateBossExit(grid: Grid, exitX: number): void {
  const mainY = grid.exit.y;
  // Both directions are tried and the roomier one wins, so the boss exit lands
  // on whichever side of the main exit actually has space.
  const low = GRID_MIN_Y + BOSS_EXIT_H;
  const high = GRID_MAX_Y;
  const below = mainY - BOSS_EXIT_GAP;
  const above = mainY + BOSS_EXIT_GAP;
  let bossY: number;
  if (above <= high && (mainY - low) < (high - mainY)) {
    bossY = above;
  } else if (below >= low) {
    bossY = below;
  } else if (above <= high) {
    bossY = above;
  } else {
    // No room either way: give up rather than stack the exits on top of one
    // another. The round simply has no boss route.
    return;
  }

  grid.bossExit = { x: exitX, y: bossY };
  BOSS_EXIT.active = true;
  BOSS_EXIT.minX = exitX - BOSS_EXIT_W;
  BOSS_EXIT.maxX = exitX;
  BOSS_EXIT.minY = bossY - BOSS_EXIT_H;
  BOSS_EXIT.maxY = bossY;

  // The L: up or down the column just west of the edge, then one step east
  // onto the tile itself.
  const spineX = exitX - 1;
  const step = bossY > mainY ? 1 : -1;
  for (let y = mainY; y !== bossY + step; y += step) {
    grid.path[idx(spineX, y)] = true;
  }
  grid.path[idx(exitX, bossY)] = true;
}

// ============================================================
// Step 2: Place granite using open-space-carving approach
// Guarantees no enclosures by construction: all non-granite
// tiles form one connected region.
// ============================================================

function placeGranite(grid: Grid, difficulty: number): void {
  const density = 0.10 + (difficulty / 100) * 0.40; // 10% at diff 0, 50% at diff 100

  // Collect candidate tiles (non-reserved, non-path)
  const candidates: number[] = [];
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      if (!isReserved(gx, gy) && !grid.path[idx(gx, gy)]) {
        candidates.push(idx(gx, gy));
      }
    }
  }

  const targetGranite = Math.floor(candidates.length * density);
  const targetOpen = candidates.length - targetGranite;

  // Start by marking ALL candidates as granite
  for (const ci of candidates) {
    grid.cells[ci].entity = Entity.GRANITE;
  }

  // Build initial "open" set: path tiles + reserved tiles + scattered carving seeds
  const open: boolean[] = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    open[i] = false;
  }
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const i = idx(gx, gy);
      if (grid.path[i] || isReserved(gx, gy)) {
        open[i] = true;
      }
    }
  }

  // Place granite anchors: protected clusters that carving skips.
  // This ensures granite appears in the interior, not just at edges.
  const anchored: boolean[] = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    anchored[i] = false;
  }

  const anchorCount = 3 + GetRandomInt(0, 3); // 3-6 anchor clusters
  for (let a = 0; a < anchorCount; a++) {
    const ax = GetRandomInt(GRID_MIN_X + 5, GRID_MAX_X - 5);
    const ay = GetRandomInt(GRID_MIN_Y + 2, GRID_MAX_Y - 2);
    // Anchor a small cluster (2-4 wide, 2-3 tall)
    const aw = GetRandomInt(2, 4);
    const ah = GetRandomInt(2, 3);
    for (let dy = 0; dy < ah; dy++) {
      for (let dx = 0; dx < aw; dx++) {
        const nx = ax + dx;
        const ny = ay + dy;
        if (inBounds(nx, ny) && grid.cells[idx(nx, ny)].entity === Entity.GRANITE) {
          anchored[idx(nx, ny)] = true;
        }
      }
    }
  }

  // Frontier: granite tiles adjacent to open space (excluding anchored tiles)
  const frontier: number[] = [];
  const inFrontier: boolean[] = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    inFrontier[i] = false;
  }

  for (const ci of candidates) {
    if (grid.cells[ci].entity !== Entity.GRANITE) continue;
    const coords = idxToCoords(ci);
    for (const [dx, dy] of DIRS) {
      const nx = coords.x + dx;
      const ny = coords.y + dy;
      if (inBounds(nx, ny) && open[idx(nx, ny)]) {
        frontier.push(ci);
        inFrontier[ci] = true;
        break;
      }
    }
  }

  // Carve open space from granite, growing outward from path/reserved
  let openCount = 0;
  while (openCount < targetOpen && frontier.length > 0) {
    const fi = GetRandomInt(0, frontier.length - 1);
    const ci = frontier[fi];
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();

    if (grid.cells[ci].entity !== Entity.GRANITE || anchored[ci]) continue;

    // Carve this tile
    grid.cells[ci].entity = Entity.NONE;
    open[ci] = true;
    openCount++;

    // Add newly-exposed granite neighbors to frontier
    const coords = idxToCoords(ci);
    for (const [dx, dy] of DIRS) {
      const nx = coords.x + dx;
      const ny = coords.y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (grid.cells[ni].entity === Entity.GRANITE && !inFrontier[ni]) {
        frontier.push(ni);
        inFrontier[ni] = true;
      }
    }
  }
}

// ============================================================
// Step 3: Place water blobs, spread east-to-west
// ============================================================

function placeWater(grid: Grid, difficulty: number): void {
  // Count non-granite tiles
  let nonGranite = 0;
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      if (grid.cells[idx(gx, gy)].entity !== Entity.GRANITE && !isReserved(gx, gy)) {
        nonGranite++;
      }
    }
  }

  // More water at low difficulty (20%), tapering to 15% at high difficulty
  const waterPct = 0.20 - (difficulty / 100) * 0.05;
  const minWater = Math.ceil(nonGranite * waterPct);

  // Blob sizes: larger at low difficulty for big lakes, smaller at high difficulty
  const maxBlobSize = Math.floor(16 - (difficulty / 100) * 8); // 16 at diff 0, 8 at diff 100
  const minBlobSize = Math.floor(6 - (difficulty / 100) * 3);  // 6 at diff 0, 3 at diff 100

  // Divide map into 5 east-west strips for even distribution
  const stripWidth = Math.floor(GRID_W / 5);
  let totalWater = 0;

  for (let strip = 0; strip < 5; strip++) {
    const stripMinX = GRID_MIN_X + strip * stripWidth;
    const stripMaxX = strip === 4 ? GRID_MAX_X : stripMinX + stripWidth - 1;

    const blobsInStrip = GetRandomInt(1, 3);
    for (let b = 0; b < blobsInStrip; b++) {
      const seed = findEmpty(grid, stripMinX, stripMaxX, GRID_MIN_Y, GRID_MAX_Y);
      if (seed == null) continue;

      const blobSize = GetRandomInt(minBlobSize, maxBlobSize);
      totalWater += growBlob(grid, seed.x, seed.y, blobSize, Entity.WATER);
    }
  }

  // Top up if we haven't reached the minimum
  let attempts = 0;
  while (totalWater < minWater && attempts < 50) {
    const seed = findEmpty(grid, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(minBlobSize, maxBlobSize);
    totalWater += growBlob(grid, seed.x, seed.y, blobSize, Entity.WATER);
    attempts++;
  }
}

// ============================================================
// Step 4: Place trees and rocks
// ============================================================

function placeResources(grid: Grid, difficulty: number): void {
  // Count path length and water-on-path
  let pathLength = 0;
  let waterOnPath = 0;
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    if (grid.path[i]) {
      pathLength++;
      if (grid.cells[i].entity === Entity.WATER) {
        waterOnPath++;
      }
    }
  }

  // Resource surplus: 1.75x at difficulty 0, 1x at difficulty 100
  const surplus = 1.75 - (difficulty / 100) * 0.75;
  const minTrees = Math.ceil((pathLength + waterOnPath) * surplus);
  const minRocks = Math.ceil(pathLength * surplus);
  const maxTrees = Math.ceil(minTrees * 1.15);
  const maxRocks = Math.ceil(minRocks * 1.15);

  const targetTrees = GetRandomInt(minTrees, maxTrees);
  const targetRocks = GetRandomInt(minRocks, maxRocks);

  // Place tree blobs
  let treesPlaced = 0;
  let attempts = 0;
  while (treesPlaced < targetTrees && attempts < 200) {
    const seed = findEmpty(grid, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(3, 10);
    treesPlaced += growBlob(grid, seed.x, seed.y, blobSize, Entity.TREE);
    attempts++;
  }

  // Place rock blobs
  let rocksPlaced = 0;
  attempts = 0;
  while (rocksPlaced < targetRocks && attempts < 200) {
    const seed = findEmpty(grid, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(3, 8);
    rocksPlaced += growBlob(grid, seed.x, seed.y, blobSize, Entity.ROCK);
    attempts++;
  }
}

// ============================================================
// Step 5: Place creep camp (one per level)
// ============================================================

function placeCreepCamp(grid: Grid, fixedX?: number, fixedY?: number): void {
  // Valid X range: at least 1 tile gap from start and victory areas
  const minX = SPAWN.maxX + 2;
  const maxX = VICTORY.minX - 2;
  // Valid Y range: at least 1 tile from top/bottom edges
  const minY = GRID_MIN_Y + 1;
  const maxY = GRID_MAX_Y - 1;

  let cx: number;
  let cy: number;

  if (fixedX != null && fixedY != null) {
    // Fixed placement (cheat mode) — skip area gap checks, clamp to grid bounds only
    cx = Math.max(GRID_MIN_X, Math.min(GRID_MAX_X, fixedX));
    cy = Math.max(GRID_MIN_Y + 1, Math.min(GRID_MAX_Y - 1, fixedY));
  } else {
    if (minX > maxX) return; // no room
    // Flood-fill from start tile through non-granite to find reachable tiles
    const reachable: boolean[] = [];
    for (let i = 0; i < GRID_W * GRID_H; i++) reachable[i] = false;
    const startIdx = idx(GRID_MIN_X, 0);
    reachable[startIdx] = true;
    const queue: number[] = [startIdx];
    while (queue.length > 0) {
      const ci = queue.pop()!;
      const coords = idxToCoords(ci);
      for (const [dx, dy] of DIRS) {
        const nx = coords.x + dx;
        const ny = coords.y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (reachable[ni]) continue;
        if (grid.cells[ni].entity === Entity.GRANITE) continue;
        reachable[ni] = true;
        queue.push(ni);
      }
    }

    // Pick from reachable, non-reserved tiles in the valid range
    const candidates: GridPos[] = [];
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (isReserved(gx, gy)) continue;
        if (!reachable[idx(gx, gy)]) continue;
        candidates.push({ x: gx, y: gy });
      }
    }
    if (candidates.length === 0) return;
    const pick = candidates[GetRandomInt(0, candidates.length - 1)];
    cx = pick.x;
    cy = pick.y;
  }

  // Clear surrounding 8 tiles to NONE
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (inBounds(nx, ny)) {
        grid.cells[idx(nx, ny)].entity = Entity.NONE;
      }
    }
  }

  // Place the creep camp
  grid.cells[idx(cx, cy)].entity = Entity.CREEP_CAMP;
}

// ============================================================
// Train start layout (shared by inter-round lobby and round generation)
// ============================================================

/** Place the train start: track wagon on the anchor tile, engine one tile
 *  east, start crate below the wagon. With runway (gameplay), one empty
 *  track is added ahead of the engine so players have time to gather
 *  materials before the train reaches the end of the line. West→east scan
 *  order means placedTracks[0] is the wagon's tile, [1] the engine's, and
 *  [2] the runway. The inter-round lobby train doesn't move, so it skips the runway. */
function placeTrainStart(grid: Grid, gx: number, gy: number, runway: boolean): void {
  grid.cells[idx(gx, gy)].entity = Entity.TRACK_WITH_WAGON;
  grid.cells[idx(gx + 1, gy)].entity = Entity.TRACK_WITH_ENGINE;
  if (runway) {
    grid.cells[idx(gx + 2, gy)].entity = Entity.TRACK;
  }
  grid.cells[idx(gx, gy - 1)].entity = Entity.CRATE_START;
}

// ============================================================
// Inter-round lobby grid (post-victory)
// ============================================================

// 9x9 inter-round lobby grid (no water border).
// Shorthand: terrain + optional entity
function c(terrain: Terrain, entity = Entity.NONE): Cell { return { terrain, entity }; }
const M = c(Terrain.WHITE_MARBLE);
const G = c(Terrain.GRASSY_DIRT);
const P1 = c(Terrain.WHITE_MARBLE, Entity.PLAYER_1);
const P2 = c(Terrain.WHITE_MARBLE, Entity.PLAYER_2);
const P3 = c(Terrain.WHITE_MARBLE, Entity.PLAYER_3);
const P4 = c(Terrain.WHITE_MARBLE, Entity.PLAYER_4);
const SC = c(Terrain.GRASSY_DIRT, Entity.START_CIRCLE);
const RC = c(Terrain.GRASSY_DIRT, Entity.REVERT_CIRCLE);
const SH = c(Terrain.GRASSY_DIRT, Entity.SHOP);
const DL = c(Terrain.GRASSY_DIRT, Entity.SHADY_DEALER);
// prettier-ignore
// Laid out as it appears in-game (top = north = +y, bottom = south = -y).
// The train start (wagon, engine, start crate) is placed by placeTrainStart
// anchored at (-4, 0) — the west edge of the y=0 and y=-1 rows.
const LOBBY_GRID: Cell[][] = [
  [ M, M, M, M, M, M, M, M, M], // y= 4
  [ M, G, G, M,SH, M,DL, G, M], // y= 3
  [ M, G, M, G, M, G, M, G, M], // y= 2
  [ M, M, G, G, M, G, G, M, M], // y= 1
  [ M, G, P1,P2,G, P3,P4,G, M], // y= 0
  [ M, M, G, G, M, G, G, M, M], // y=-1
  [ M, G, M, G, M, G, M, G, M], // y=-2
  [ M,RC, G, M,SC, M, G, G, M], // y=-3
  [ M, M, M, M, M, M, M, M, M], // y=-4
].reverse();

// ============================================================
// Boss battlefield
// ============================================================

/** Half-width of the playable floor, matching the inter-round lobby's 9x9. */
const BOSS_HALF = 4;
/** How far the lava reaches beyond the floor. Same 6 cells the lobby's water
 *  uses, which is more than the camera ever shows. */
const BOSS_SURROUND = 6;

/**
 * One period of the floor pattern, laid out as it appears in game (north up).
 *
 * Two diamonds of the SAME shape -- a centre and its four neighbours -- on a
 * period-4 lattice, the red stone offset from the brick by half a period in
 * both directions so the two interleave. Every cell is either one of the two
 * diamonds or the dirt between them.
 *
 * Written out rather than computed, the way the inter-round lobby's LOBBY_GRID
 * is: what ships is exactly the reference rather than a formula that
 * approximates it, and the shape is quicker to read as a picture than as a
 * distance test. Tiled across the floor it gives:
 *
 *     o o X o o o X o o
 *     o X O X o X O X o
 *     X O O O X O O O X     O = brick diamond
 *     o X O X o X O X o     o = red stone diamond
 *     o o X o o o X o o     X = dirt
 */
const BOSS_FLOOR_PERIOD = 4;
// prettier-ignore
const BOSS_FLOOR: Terrain[][] = (() => {
  const X = Terrain.DUNGEON_DIRT;
  const O = Terrain.DUNGEON_BRICK;
  const o = Terrain.DUNGEON_RED_STONE;
  return [
    [o, o, X, o],
    [o, X, O, X],
    [X, O, O, O],
    [o, X, O, X],
  ];
})();

/** The floor tile for a cell, tiling BOSS_FLOOR across the arena. */
function bossFloorTerrain(gx: number, gy: number): Terrain {
  const wrap = (n: number): number =>
    ((n % BOSS_FLOOR_PERIOD) + BOSS_FLOOR_PERIOD) % BOSS_FLOOR_PERIOD;
  // Row 0 of the table is its NORTH row and +y is north, so the row index runs
  // the opposite way to y.
  return BOSS_FLOOR[wrap(-gy)][wrap(gx)];
}

/**
 * The boss arena: a square of dungeon floor patterned with diamonds, ringed by
 * lava that cannot be walked onto.
 *
 * Built through the same Grid the rounds and lobbies use, so it spawns, paints
 * and cleans up through exactly one code path -- the lava's pathing blockers
 * included, since they are destructables and the terrain sweep already removes
 * every destructable on load.
 */
/** Hero places, north to south along the west wall. */
const BOSS_HERO_SPOTS: ReadonlyArray<GridPos> = [
  { x: -3, y: 2 }, { x: -3, y: 1 }, { x: -3, y: -1 }, { x: -3, y: -2 },
];
/** Mercenary places, a step behind the heroes. */
const BOSS_MERC_SPOTS: ReadonlyArray<GridPos> = [
  { x: -4, y: 1 }, { x: -4, y: -1 },
];
/** Where the boss waits. */
const BOSS_SPOT: GridPos = { x: 3, y: 0 };

export function generateBossBattlefield(): Grid {
  const grid = createGrid();

  const reach = BOSS_HALF + BOSS_SURROUND;
  for (let gy = -reach; gy <= reach; gy++) {
    for (let gx = -reach; gx <= reach; gx++) {
      if (!inBounds(gx, gy)) continue;
      const cell = grid.cells[idx(gx, gy)];
      const onFloor = gx >= -BOSS_HALF && gx <= BOSS_HALF
        && gy >= -BOSS_HALF && gy <= BOSS_HALF;
      if (onFloor) {
        cell.terrain = bossFloorTerrain(gx, gy);
        cell.entity = Entity.NONE;
      } else {
        cell.terrain = Terrain.LAVA_CRACKS;
        cell.entity = Entity.LAVA;
      }
    }
  }

  // Who stands where. The template says the PLACES; the arena decides who
  // fills them, because that depends on how many people are playing.
  //
  // The party comes in along the west wall with the mercenaries a step behind
  // the heroes, and the boss waits east with the width of the floor between
  // them -- so the fight starts with a charge rather than on top of everyone,
  // and nobody spawns inside the meteor.
  for (let i = 0; i < BOSS_HERO_SPOTS.length; i++) {
    const spot = BOSS_HERO_SPOTS[i];
    grid.cells[idx(spot.x, spot.y)].entity = Entity.HERO_SPOT;
  }
  for (const spot of BOSS_MERC_SPOTS) {
    grid.cells[idx(spot.x, spot.y)].entity = Entity.MERC_SPOT;
  }
  grid.cells[idx(BOSS_SPOT.x, BOSS_SPOT.y)].entity = Entity.BOSS_SPOT;

  return grid;
}

export function generateInterRoundLobby(): Grid {
  const grid = createGrid();

  // Default terrain is grass; 6-wide water border around the inter-round lobby
  // Inner ring (-5..+5) uses WATER_VISIBLE for shared vision via train player
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      if (gx >= -10 && gx <= 10 && gy >= -10 && gy <= 10) {
        const cell = grid.cells[idx(gx, gy)];
        cell.terrain = Terrain.BLACK_BRICKS;
        const innerRing = gx >= -5 && gx <= 5 && gy >= -5 && gy <= 5;
        cell.entity = innerRing ? Entity.WATER_VISIBLE : Entity.WATER;
      }
    }
  }

  // Apply inter-round lobby grid to center 9x9
  for (let ly = -4; ly <= 4; ly++) {
    for (let lx = -4; lx <= 4; lx++) {
      const lobbyCell = LOBBY_GRID[ly + 4][lx + 4];
      const cell = grid.cells[idx(lx, ly)];
      cell.terrain = lobbyCell.terrain;
      cell.entity = lobbyCell.entity;
    }
  }

  // Train start (wagon, engine, start crate) — same layout as a round,
  // minus the runway (the inter-round lobby train never moves)
  placeTrainStart(grid, -4, 0, false);

  // DPS test area: 6x3 at far bottom-right of grid
  // [N, N, N, N, N, N]
  // [N, N, N, N, C, N]
  // [N, N, N, N, N, N]
  const dpsBaseX = GRID_MAX_X - 5;  // 15
  const dpsBaseY = GRID_MIN_Y;      // -10
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 6; dx++) {
      const gx = dpsBaseX + dx;
      const gy = dpsBaseY + dy;
      if (inBounds(gx, gy)) {
        const cell = grid.cells[idx(gx, gy)];
        cell.terrain = Terrain.GRASS;
        cell.entity = Entity.NONE;
      }
    }
  }
  // Place cage at (dpsBaseX+4, dpsBaseY+1) — the C in the diagram
  if (inBounds(dpsBaseX + 4, dpsBaseY + 1)) {
    grid.cells[idx(dpsBaseX + 4, dpsBaseY + 1)].entity = Entity.CREEP_CAMP;
  }

  return grid;
}

/** The inter-round lobby's tileset with nothing in it.
 *
 *  Same floor and water boundary as the inter-round lobby -- built from it, so the
 *  two can never drift -- but stripped of every unit and building: no shop,
 *  crates, ready circles, train or creep cage. Player spawns are kept, since
 *  the point is to have somewhere to stand and walk after a defeat, and the
 *  water border is kept because it is the map edge rather than scenery. */
function generateEmptyLobby(): Grid {
  const grid = generateInterRoundLobby();
  for (const cell of grid.cells) {
    if (cell.entity === Entity.NONE) continue;
    const isBoundary = cell.entity === Entity.WATER || cell.entity === Entity.WATER_VISIBLE;
    const isPlayerSpawn = cell.entity >= Entity.PLAYER_1 && cell.entity <= Entity.PLAYER_4;
    if (!isBoundary && !isPlayerSpawn) cell.entity = Entity.NONE;
  }
  return grid;
}

/** Move players 2-4 to the back row, where they stand as dancers. Used by the
 *  lobbies only the host acts in. */
function parkTheGuests(grid: Grid): void {
  for (const cell of grid.cells) {
    if (cell.entity >= Entity.PLAYER_2 && cell.entity <= Entity.PLAYER_4) cell.entity = Entity.NONE;
  }
  grid.cells[idx(-2, 3)].entity = Entity.PLAYER_2;
  grid.cells[idx(0, 3)].entity = Entity.PLAYER_3;
  grid.cells[idx(2, 3)].entity = Entity.PLAYER_4;
}

export function generateDefeatLobby(): Grid {
  const grid = generateEmptyLobby();
  // The one thing you can do from here: give up on this run and go back to the
  // start lobby. Every player has to agree, the way Reset Purchases works,
  // because it ends the run for all of them.
  grid.cells[idx(0, -3)].entity = Entity.RESTART_CIRCLE;
  return grid;
}

/** The lobby the map boots into, and the one a defeated run restarts to.
 *
 *  Only player 1 stands here: the choices on offer -- new run, tutorial, load a
 *  save -- belong to the host, and the other players have nothing to decide
 *  until a game is actually running. Built from the empty defeat-lobby shell so
 *  the three lobbies cannot drift apart in floor or boundary. */
export function generateStartLobby(): Grid {
  const grid = generateEmptyLobby();
  // Players 2-4 move to the back row and stay there as dancers (see dance.ts).
  // They keep a spawn rather than losing one: the point is that they have
  // something to do while the host decides, not that they are absent.
  parkTheGuests(grid);
  grid.cells[idx(-2, -3)].entity = Entity.TUTORIAL_CIRCLE;
  grid.cells[idx(0, -3)].entity = Entity.NEW_GAME_CIRCLE;
  grid.cells[idx(2, -3)].entity = Entity.LOAD_CIRCLE;
  return grid;
}

/** The tutorial map: the cheat layout, so the target track sits exactly where
 *  -cheatmode puts it, with a tree, a rock and a pool of water placed within a
 *  few steps of the spawn. Everything a first-timer needs to try is in sight
 *  rather than somewhere out on a procedural map. */
export function generateTutorial(): Grid {
  const grid = generateCheatTerrain(GRID_MIN_X + 11);
  // SPAWN is the generator's reserved box -- the cleared ground the players,
  // tools and train start on. Props go OUTSIDE it, just beyond its eastern
  // edge and just south of it, so they are a couple of steps away without
  // standing in the ground the map keeps clear on purpose.
  //
  // Dropping one inside is exactly what went wrong first time: a tree landed on
  // the cell that places player 1, so the tutorial began with no peasant -- and
  // with no peasant there was no vision, which read as the fog never resetting.
  // Plenty of everything, so nobody runs out mid-experiment: two columns of
  // trees and two of rock running south to the map edge, and a broad pool to
  // the north to practise bridging across.
  const teach: Array<[number, number, Entity]> = [];
  for (let gy = GRID_MIN_Y; gy <= -1; gy++) {
    teach.push([GRID_MIN_X + 6, gy, Entity.TREE]);
    teach.push([GRID_MIN_X + 7, gy, Entity.TREE]);
    teach.push([GRID_MIN_X + 8, gy, Entity.ROCK]);
    teach.push([GRID_MIN_X + 9, gy, Entity.ROCK]);
  }
  for (let gy = 2; gy <= 6; gy++) {
    for (let gx = GRID_MIN_X + 4; gx <= GRID_MIN_X + 10; gx++) {
      teach.push([gx, gy, Entity.WATER_VISIBLE]);
    }
  }
  for (const [gx, gy, entity] of teach) {
    if (!inBounds(gx, gy)) continue;
    // Honour the generator's reserved box by rule rather than by choosing
    // coordinates carefully, so a later nudge cannot wander back into it.
    const inReserve = gx >= SPAWN.minX && gx <= SPAWN.maxX
      && gy >= SPAWN.minY && gy <= SPAWN.maxY;
    if (inReserve) continue;
    const cell = grid.cells[idx(gx, gy)];
    // Anything already placed wins -- the track corridor, the creep camp and
    // the crate all matter more than a prop.
    if (cell.entity !== Entity.NONE) continue;
    cell.entity = entity;
  }
  return grid;
}

/** Picking which save to resume. Player 1 only, like the start lobby it comes
 *  from: the four circles are back, older, newer and confirm, and the selected
 *  save's heroes are displayed above them by chooseSaveLobby.ts. */
export function generateChooseSaveLobby(): Grid {
  // Built from the empty shell, not from the start lobby: a lobby places what
  // it wants rather than inheriting another's furniture and unpicking it.
  const grid = generateEmptyLobby();
  parkTheGuests(grid);
  // Older on the left, newer on the right, so paging right walks forward in
  // time the way a timeline reads.
  grid.cells[idx(-3, -3)].entity = Entity.BACK_CIRCLE;
  grid.cells[idx(-1, -3)].entity = Entity.NEXT_CIRCLE;
  grid.cells[idx(1, -3)].entity = Entity.PREV_CIRCLE;
  grid.cells[idx(3, -3)].entity = Entity.CONFIRM_CIRCLE;
  return grid;
}

// ============================================================
// Main orchestrator
// ============================================================

function placeEntities(grid: Grid): void {
  // Fill reserved areas with grassy dirt terrain
  for (let gy = SPAWN.minY; gy <= SPAWN.maxY; gy++) {
    for (let gx = SPAWN.minX; gx <= SPAWN.maxX; gx++) {
      grid.cells[idx(gx, gy)].terrain = Terrain.GRASSY_DIRT;
    }
  }
  for (let gy = VICTORY.minY; gy <= VICTORY.maxY; gy++) {
    for (let gx = VICTORY.minX; gx <= VICTORY.maxX; gx++) {
      grid.cells[idx(gx, gy)].terrain = Terrain.GRASSY_DIRT;
    }
  }

  // Start/end marble tiles
  grid.cells[idx(GRID_MIN_X, 0)].terrain = Terrain.WHITE_MARBLE;
  grid.cells[idx(grid.exit.x, grid.exit.y)].terrain = Terrain.WHITE_MARBLE;

  // The boss exit: the arena's own lava tile, so where it goes is legible
  // before you have ever been there, sealed by the Strange Rock. Terrain only
  // -- the arena pairs LAVA_CRACKS with a pathing blocker, and this one has to
  // be walked onto and built on.
  const bossExit = grid.bossExit;
  if (bossExit != null) {
    for (let gy = BOSS_EXIT.minY; gy <= BOSS_EXIT.maxY; gy++) {
      for (let gx = BOSS_EXIT.minX; gx <= BOSS_EXIT.maxX; gx++) {
        grid.cells[idx(gx, gy)].terrain = Terrain.GRASSY_DIRT;
        grid.cells[idx(gx, gy)].entity = Entity.NONE;
      }
    }
    grid.cells[idx(bossExit.x, bossExit.y)].terrain = Terrain.LAVA_CRACKS;
    grid.cells[idx(bossExit.x, bossExit.y)].entity = Entity.STRANGE_ROCK;
  }

  // Entities
  grid.cells[idx(grid.exit.x, grid.exit.y - 1)].entity = Entity.CRATE;
  placeTrainStart(grid, GRID_MIN_X, 0, true);
  grid.cells[idx(GRID_MIN_X + 1, -3)].entity = Entity.AXE;
  grid.cells[idx(GRID_MIN_X + 2, -3)].entity = Entity.PICKAXE;
  grid.cells[idx(GRID_MIN_X + 3, -3)].entity = Entity.BUCKET;
  grid.cells[idx(GRID_MIN_X + 3, -2)].entity = Entity.PLAYER_1;
  grid.cells[idx(GRID_MIN_X + 4, -2)].entity = Entity.PLAYER_2;
  grid.cells[idx(GRID_MIN_X + 5, -2)].entity = Entity.PLAYER_3;
  grid.cells[idx(GRID_MIN_X + 6, -2)].entity = Entity.PLAYER_4;
}

// ============================================================
// Step 6: Place critters on random grass tiles
// ============================================================

const CRITTER_COUNT = 15;

/** Mark `count` random empty grass tiles as critter spawns. Runs last so no
 *  later step overwrites them. */
function placeCritters(grid: Grid, count: number): void {
  const candidates: number[] = [];
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const i = idx(gx, gy);
      if (
        grid.cells[i].terrain === Terrain.GRASS &&
        grid.cells[i].entity === Entity.NONE &&
        !isReserved(gx, gy)
      ) {
        candidates.push(i);
      }
    }
  }
  for (let n = 0; n < count && candidates.length > 0; n++) {
    const ci = GetRandomInt(0, candidates.length - 1);
    grid.cells[candidates[ci]].entity = Entity.CRITTER;
    candidates[ci] = candidates[candidates.length - 1];
    candidates.pop();
  }
}

export function generateTerrain(difficulty: number, exitX = GRID_MAX_X, withBossExit = false): Grid {
  const grid = createGrid();
  BOSS_EXIT.active = false;
  generatePath(grid, exitX);
  if (withBossExit) generateBossExit(grid, exitX);
  placeGranite(grid, difficulty);
  placeWater(grid, difficulty);
  placeResources(grid, difficulty);
  placeEntities(grid);
  placeCreepCamp(grid);
  // Critterpocalypse: every eligible grass tile instead of the default count
  placeCritters(grid, isChallengeArmed(CH_CRITTERPOCALYPSE) ? GRID_W * GRID_H : CRITTER_COUNT);
  return grid;
}

export function generateCheatTerrain(exitX = GRID_MAX_X, exitY = 0): Grid {
  const grid = createGrid();
  generatePath(grid, exitX, exitY);
  placeEntities(grid);
  placeCreepCamp(grid, GRID_MIN_X + 4, SPAWN.minY - 2);
  placeCritters(grid, isChallengeArmed(CH_CRITTERPOCALYPSE) ? GRID_W * GRID_H : CRITTER_COUNT);
  return grid;
}
