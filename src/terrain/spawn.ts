import { Destructable, Timer, Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import {
  CellType, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  TREE_RAW, ROCK_RAW,
  idx, gridToWorld, isReserved,
} from './constants';

import { getNeutralExtra } from '../teams';
import { registerResourceDest } from '../harvest';

// Per-variation scales to normalize rock models to ~128-unit footprint.
const ROCK_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Destructable rawcodes (Lordaeron Summer) ---
const GRANITE_RAW = 'LTrc';  // Rock Chunks 1 (tinted dark + unselectable in compiletime)

// Per-variation scales to normalize destructable models to a consistent 128-unit footprint.
// Both LTrt and LTrc use the same base model with 6 variations.
// Footprints at scale 1.0: [210, 230, 204, 206, 210, 171]
const GRANITE_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Terrain tile FourCCs (Lordaeron Summer tileset) ---
const TERRAIN_GRASS = 'Lgrs';
const TERRAIN_DIRT = 'Ldrt';
const TERRAIN_GRASSY_DIRT = 'Lgrd';
const TERRAIN_ROCK = 'Lrok';
const TERRAIN_ROUGH_DIRT = 'Ldro';
const TERRAIN_WHITE_MARBLE = 'Xwmb';

function paintTile(worldX: number, worldY: number, terrainFourCC: string): void {
  SetTerrainType(worldX, worldY, FourCC(terrainFourCC), -1, 1, 0);
}

/** Create all WC3 destructables and paint terrain from the generated grid. */
export function spawnTerrain(grid: Grid): void {
  let treeCount = 0;
  let rockCount = 0;
  let graniteCount = 0;

  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const i = idx(gx, gy);
      const cell = grid.cells[i];
      const world = gridToWorld(gx, gy);

      switch (cell) {
        case CellType.TREE: {
          const variation = GetRandomInt(0, 9);
          const tree = Destructable.create(
            FourCC(TREE_RAW), world.x, world.y,
            GetRandomReal(220, 320), 0.8, variation,
          );
          if (tree != null) registerResourceDest(tree);
          paintTile(world.x, world.y, TERRAIN_GRASS);
          treeCount++;
          break;
        }

        case CellType.ROCK: {
          const variation = GetRandomInt(0, 5);
          const rock = Destructable.create(
            FourCC(ROCK_RAW), world.x, world.y,
            GetRandomReal(0, 360), ROCK_SCALES[variation], variation,
          );
          if (rock != null) registerResourceDest(rock);
          paintTile(world.x, world.y, TERRAIN_ROCK);
          rockCount++;
          break;
        }

        case CellType.GRANITE: {
          const variation = GetRandomInt(0, 5);
          Destructable.create(
            FourCC(GRANITE_RAW), world.x, world.y,
            GetRandomReal(0, 360), GRANITE_SCALES[variation], variation,
          );
          paintTile(world.x, world.y, TERRAIN_ROCK);
          graniteCount++;
          break;
        }

        case CellType.WATER: {
          const w = Unit.create(getNeutralExtra(), FourCC(Units.Burrow), world.x, world.y, 0)!;
          w.invulnerable = true;
          paintTile(world.x, world.y, TERRAIN_ROUGH_DIRT);
          break;
        }

        case CellType.EMPTY: {
          if (isReserved(gx, gy)) {
            paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          } else {
            paintTile(world.x, world.y, TERRAIN_GRASS);
          }
          break;
        }
      }
    }
  }

  // Paint start/end marble tiles
  const startWorld = gridToWorld(GRID_MIN_X, 0);
  const endWorld = gridToWorld(GRID_MAX_X, grid.exitY);
  paintTile(startWorld.x, startWorld.y, TERRAIN_WHITE_MARBLE);
  paintTile(endWorld.x, endWorld.y, TERRAIN_WHITE_MARBLE);

}
