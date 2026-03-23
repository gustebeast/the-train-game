import {
  CellType, Grid, GridPos, DIRS, VICTORY,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y, GRID_W, GRID_H,
  idx, idxToCoords, inBounds, isReserved,
} from './constants';


// --- Grid creation ---

function createGrid(): Grid {
  const size = GRID_W * GRID_H;
  const cells: CellType[] = [];
  const path: boolean[] = [];
  for (let i = 0; i < size; i++) {
    cells[i] = CellType.EMPTY;
    path[i] = false;
  }
  return { cells, path, exit: { x: GRID_MAX_X, y: 0 } };
}

// --- Find a random empty tile ---

function findEmpty(
  grid: Grid,
  minX: number, maxX: number, minY: number, maxY: number,
): GridPos | null {
  const candidates: GridPos[] = [];
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const i = idx(gx, gy);
      if (grid.cells[i] === CellType.EMPTY && !isReserved(gx, gy)) {
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
  type: CellType,
): number {
  const seedIdx = idx(seedX, seedY);
  if (grid.cells[seedIdx] !== CellType.EMPTY) return 0;

  grid.cells[seedIdx] = type;
  let placed = 1;

  // Frontier: indices of neighboring empty tiles
  const frontier: number[] = [];

  function addNeighbors(gx: number, gy: number): void {
    for (const [dx, dy] of DIRS) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (!inBounds(nx, ny) || isReserved(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (grid.cells[ni] !== CellType.EMPTY) continue;
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

    if (grid.cells[ci] !== CellType.EMPTY) continue;
    const coords = idxToCoords(ci);

    grid.cells[ci] = type;
    placed++;
    addNeighbors(coords.x, coords.y);
  }

  return placed;
}

// ============================================================
// Step 1: Generate guaranteed path from start to end
// ============================================================

function generatePath(grid: Grid, exitX: number): void {
  let x = GRID_MIN_X;
  let y = 0;
  grid.path[idx(x, y)] = true;

  // Minimum exit Y so the victory area (exitY-4 to exitY) fits in bounds
  const MIN_EXIT_Y = GRID_MIN_Y + 4;

  // Update VICTORY area X bounds around the target exit
  VICTORY.minX = exitX - 5;
  VICTORY.maxX = exitX;

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
    grid.cells[ci] = CellType.GRANITE;
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
        if (inBounds(nx, ny) && grid.cells[idx(nx, ny)] === CellType.GRANITE) {
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
    if (grid.cells[ci] !== CellType.GRANITE) continue;
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

    if (grid.cells[ci] !== CellType.GRANITE || anchored[ci]) continue;

    // Carve this tile
    grid.cells[ci] = CellType.EMPTY;
    open[ci] = true;
    openCount++;

    // Add newly-exposed granite neighbors to frontier
    const coords = idxToCoords(ci);
    for (const [dx, dy] of DIRS) {
      const nx = coords.x + dx;
      const ny = coords.y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (grid.cells[ni] === CellType.GRANITE && !inFrontier[ni]) {
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
      if (grid.cells[idx(gx, gy)] !== CellType.GRANITE && !isReserved(gx, gy)) {
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
      const seed = findEmpty(grid,stripMinX, stripMaxX, GRID_MIN_Y, GRID_MAX_Y);
      if (seed == null) continue;

      const blobSize = GetRandomInt(minBlobSize, maxBlobSize);
      totalWater += growBlob(grid, seed.x, seed.y, blobSize, CellType.WATER);
    }
  }

  // Top up if we haven't reached the minimum
  let attempts = 0;
  while (totalWater < minWater && attempts < 50) {
    const seed = findEmpty(grid,GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(minBlobSize, maxBlobSize);
    totalWater += growBlob(grid, seed.x, seed.y, blobSize, CellType.WATER);
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
      if (grid.cells[i] === CellType.WATER) {
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
    const seed = findEmpty(grid,GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(3, 10);
    treesPlaced += growBlob(grid, seed.x, seed.y, blobSize, CellType.TREE);
    attempts++;
  }

  // Place rock blobs
  let rocksPlaced = 0;
  attempts = 0;
  while (rocksPlaced < targetRocks && attempts < 200) {
    const seed = findEmpty(grid,GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y);
    if (seed == null) break;
    const blobSize = GetRandomInt(3, 8);
    rocksPlaced += growBlob(grid, seed.x, seed.y, blobSize, CellType.ROCK);
    attempts++;
  }

}

// ============================================================
// Main orchestrator
// ============================================================

// ============================================================
// Lobby grid (post-victory)
// ============================================================

// Triangle rows for lobby pattern, tiled 4x for radial symmetry.
// Row 0 is the outermost border, row 5 is the center cell.
// W = WATER, M = MARBLE, E = EMPTY (grass)
const { WATER: _W, MARBLE: _M, EMPTY: _E } = CellType;
const LOBBY_ROWS: CellType[][] = [
  [_W,_W,_W,_W,_W,_W,_W,_W,_W,_W,_W],
  [_M,_M,_M,_M,_M,_M,_M,_M,_M],
  [_E,_E,_M,_E,_M,_E,_E],
  [_M,_E,_M,_E,_M],
  [_E,_M,_E],
  [_E],
];

function getLobbyTile(lx: number, ly: number): CellType {
  const d = Math.min(lx + 5, 5 - lx, ly + 5, 5 - ly);
  const row = LOBBY_ROWS[d];
  // Use x-axis position if nearest to top/bottom edge, y-axis if nearest to left/right
  const pos = (ly + 5 === d || 5 - ly === d) ? lx + 5 - d : ly + 5 - d;
  return row[pos];
}

export function generateLobby(): Grid {
  const grid = createGrid();

  // Fill entire grid with ABYSS
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    grid.cells[i] = CellType.ABYSS;
  }

  // Set lobby pattern in center 11x11
  for (let ly = -5; ly <= 5; ly++) {
    for (let lx = -5; lx <= 5; lx++) {
      grid.cells[idx(lx, ly)] = getLobbyTile(lx, ly);
    }
  }

  // Place entities
  grid.cells[idx(0, -3)] = CellType.START_CIRCLE;
  grid.cells[idx(0, -2)] = CellType.PLAYER_1;
  grid.cells[idx(0, -1)] = CellType.PLAYER_2;
  grid.cells[idx(0, 0)] = CellType.PLAYER_3;
  grid.cells[idx(0, 1)] = CellType.PLAYER_4;

  return grid;
}

// ============================================================
// Main orchestrator
// ============================================================

function placeEntities(grid: Grid): void {
  grid.cells[idx(GRID_MIN_X, 0)] = CellType.MARBLE;
  grid.cells[idx(grid.exit.x, grid.exit.y)] = CellType.MARBLE;
  grid.cells[idx(GRID_MIN_X, -1)] = CellType.CRATE;
  grid.cells[idx(grid.exit.x, grid.exit.y - 1)] = CellType.CRATE;
  grid.cells[idx(GRID_MIN_X, 0)] = CellType.TRACK;
  grid.cells[idx(GRID_MIN_X + 1, 0)] = CellType.TRACK;
  grid.cells[idx(GRID_MIN_X + 1, -3)] = CellType.AXE;
  grid.cells[idx(GRID_MIN_X + 2, -3)] = CellType.PICKAXE;
  grid.cells[idx(GRID_MIN_X + 3, -3)] = CellType.BUCKET;
  grid.cells[idx(GRID_MIN_X + 3, -2)] = CellType.PLAYER_1;
  grid.cells[idx(GRID_MIN_X + 4, -2)] = CellType.PLAYER_2;
  grid.cells[idx(GRID_MIN_X + 5, -2)] = CellType.PLAYER_3;
  grid.cells[idx(GRID_MIN_X + 6, -2)] = CellType.PLAYER_4;
}

export function generateTerrain(difficulty: number, exitX = GRID_MAX_X): Grid {
  const grid = createGrid();
  generatePath(grid, exitX);
  placeGranite(grid, difficulty);
  placeWater(grid, difficulty);
  placeResources(grid, difficulty);
  placeEntities(grid);
  return grid;
}

export function generateCheatTerrain(exitX = GRID_MAX_X): Grid {
  const grid = createGrid();
  generatePath(grid, exitX);
  placeEntities(grid);
  return grid;
}

