import {
  Terrain, Entity, Cell, Grid, GridPos, DIRS, SPAWN, VICTORY,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y, GRID_W, GRID_H,
  idx, idxToCoords, inBounds, isReserved,
} from './constants';


// --- Grid creation ---

function createGrid(): Grid {
  const size = GRID_W * GRID_H;
  const cells: Cell[] = [];
  const path: boolean[] = [];
  for (let i = 0; i < size; i++) {
    cells[i] = { terrain: Terrain.GRASS, entity: Entity.NONE };
    path[i] = false;
  }
  return { cells, path, exit: { x: GRID_MAX_X, y: 0 } };
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
// Lobby grid (post-victory)
// ============================================================

// 9x9 lobby grid (no water border).
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
const TN = c(Terrain.GRASSY_DIRT, Entity.TRACK_WITH_TRAIN);
const CS = c(Terrain.WHITE_MARBLE, Entity.CRATE_START);
// prettier-ignore
// Laid out as it appears in-game (top = north = +y, bottom = south = -y)
const LOBBY_GRID: Cell[][] = [
  [ M, M, M, M, M, M, M, M, M], // y= 4
  [ M, G, G, M,SH, M, G, G, M], // y= 3
  [ M, G, M, G, M, G, M, G, M], // y= 2
  [ M, M, G, G, M, G, G, M, M], // y= 1
  [ M,TN, P1,P2,G, P3,P4,G, M], // y= 0
  [ M,CS, G, G, M, G, G, M, M], // y=-1
  [ M, G, M, G, M, G, M, G, M], // y=-2
  [ M,RC, G, M,SC, M, G, G, M], // y=-3
  [ M, M, M, M, M, M, M, M, M], // y=-4
].reverse();

export function generateLobby(): Grid {
  const grid = createGrid();

  // Default terrain is grass; 6-wide water border around the lobby
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

  // Apply lobby grid to center 9x9
  for (let ly = -4; ly <= 4; ly++) {
    for (let lx = -4; lx <= 4; lx++) {
      const lobbyCell = LOBBY_GRID[ly + 4][lx + 4];
      const cell = grid.cells[idx(lx, ly)];
      cell.terrain = lobbyCell.terrain;
      cell.entity = lobbyCell.entity;
    }
  }

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

  // Entities
  grid.cells[idx(GRID_MIN_X, -1)].entity = Entity.CRATE_START;
  grid.cells[idx(grid.exit.x, grid.exit.y - 1)].entity = Entity.CRATE;
  grid.cells[idx(GRID_MIN_X, 0)].entity = Entity.TRACK_WITH_TRAIN;
  grid.cells[idx(GRID_MIN_X + 1, 0)].entity = Entity.TRACK;
  grid.cells[idx(GRID_MIN_X + 1, -3)].entity = Entity.AXE;
  grid.cells[idx(GRID_MIN_X + 2, -3)].entity = Entity.PICKAXE;
  grid.cells[idx(GRID_MIN_X + 3, -3)].entity = Entity.BUCKET;
  grid.cells[idx(GRID_MIN_X + 3, -2)].entity = Entity.PLAYER_1;
  grid.cells[idx(GRID_MIN_X + 4, -2)].entity = Entity.PLAYER_2;
  grid.cells[idx(GRID_MIN_X + 5, -2)].entity = Entity.PLAYER_3;
  grid.cells[idx(GRID_MIN_X + 6, -2)].entity = Entity.PLAYER_4;
}

export function generateTerrain(difficulty: number, exitX = GRID_MAX_X): Grid {
  const grid = createGrid();
  generatePath(grid, exitX);
  placeGranite(grid, difficulty);
  placeWater(grid, difficulty);
  placeResources(grid, difficulty);
  placeEntities(grid);
  placeCreepCamp(grid);
  return grid;
}

export function generateCheatTerrain(exitX = GRID_MAX_X, exitY = 0): Grid {
  const grid = createGrid();
  generatePath(grid, exitX, exitY);
  placeEntities(grid);
  placeCreepCamp(grid, GRID_MIN_X + 4, SPAWN.minY - 2);
  return grid;
}
