import {
  CellType, Grid, DIRS, VICTORY,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y, GRID_W, GRID_H,
  idx, idxToCoords, inBounds, isReserved,
} from './constants';
import { log } from '../debug';

// --- Grid creation ---

function createGrid(): Grid {
  const size = GRID_W * GRID_H;
  const cells: CellType[] = [];
  const path: boolean[] = [];
  for (let i = 0; i < size; i++) {
    cells[i] = CellType.EMPTY;
    path[i] = false;
  }
  return { cells, path, exitY: 0 };
}

// --- Find a random empty tile ---

function findEmpty(
  grid: Grid,
  minX: number, maxX: number, minY: number, maxY: number,
): { x: number; y: number } | null {
  const candidates: { x: number; y: number }[] = [];
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

function generatePath(grid: Grid): void {
  let x = GRID_MIN_X;
  let y = 0;
  grid.path[idx(x, y)] = true;

  // Minimum exit Y so the victory area (exitY-4 to exitY) fits in bounds
  const MIN_EXIT_Y = GRID_MIN_Y + 4;

  while (x < GRID_MAX_X) {
    // Take 2-4 eastward steps
    const eastSteps = GetRandomInt(2, 4);
    for (let i = 0; i < eastSteps && x < GRID_MAX_X; i++) {
      x++;
      grid.path[idx(x, y)] = true;
    }
    if (x >= GRID_MAX_X) break;

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

  // Store exit point and update VICTORY area around it
  grid.exitY = y;
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

  log('Water tiles placed: ' + totalWater + ' (min: ' + minWater + ')');
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

  log('Resources — target trees: ' + targetTrees + ', target rocks: ' + targetRocks);

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

  log('Placed trees: ' + treesPlaced + ', rocks: ' + rocksPlaced);
}

// ============================================================
// Main orchestrator
// ============================================================

export function generateTerrain(difficulty: number): Grid {
  const grid = createGrid();

  log('Generating terrain (difficulty: ' + difficulty + ')');

  // 1. Generate guaranteed path
  generatePath(grid);

  // 2. Place granite (respecting path, guaranteeing connectivity)
  placeGranite(grid, difficulty);

  // 3. Place water (spread east-to-west, connected blobs)
  placeWater(grid, difficulty);

  // 4. Place trees and rocks (clustered blobs)
  placeResources(grid, difficulty);

  // Log grid summary + visual map in a single log call to avoid op limit
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    counts[grid.cells[i]]++;
  }

  let mapStr = 'Grid: empty=' + counts[0] + ' trees=' + counts[1] + ' rocks=' + counts[2] +
      ' water=' + counts[3] + ' granite=' + counts[4] + '\n=== TERRAIN MAP ===\n';
  for (let gy = GRID_MAX_Y; gy >= GRID_MIN_Y; gy--) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const i = idx(gx, gy);
      const cell = grid.cells[i];
      if (cell === CellType.GRANITE) { mapStr += '#'; }
      else if (cell === CellType.TREE) { mapStr += 'T'; }
      else if (cell === CellType.ROCK) { mapStr += 'R'; }
      else if (cell === CellType.WATER) { mapStr += '~'; }
      else if (grid.path[i]) { mapStr += '*'; }
      else if (isReserved(gx, gy)) { mapStr += ' '; }
      else { mapStr += '.'; }
    }
    mapStr += '\n';
  }
  mapStr += 'Legend: .=empty T=tree R=rock ~=water #=granite *=path';
  log(mapStr);

  return grid;
}
