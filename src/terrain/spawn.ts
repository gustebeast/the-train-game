import { Destructable, Timer, Unit } from 'w3ts';
import { Units } from '@objectdata/units';
import {
  CellType, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  idx, gridToWorld, isReserved,
} from './constants';
import { log } from '../debug';
import { getNeutralExtra } from '../teams';

// --- Tree unit types (6 variations) ---
export const TREE_UNIT_RAWS = [
  Units.ColdTower,
  Units.DeathTower,
  Units.EnergyTower,
  Units.FlameTower,
  Units.DalaranGuardTower,
  Units.HighElvenGuardTower,
];

// --- Rock unit types (6 variations) ---
export const ROCK_UNIT_RAWS = [
  Units.AdvancedBoulderTower,
  Units.AdvancedColdTower,
  Units.AdvancedDeathTower,
  Units.AdvancedEnergyTower,
  Units.AdvancedFlameTower,
  Units.EarthFuryTower,
];

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
          Unit.create(
            getNeutralExtra(), FourCC(TREE_UNIT_RAWS[GetRandomInt(0, 5)]),
            world.x, world.y, GetRandomReal(220, 320),
          );
          paintTile(world.x, world.y, TERRAIN_GRASS);
          treeCount++;
          break;
        }

        case CellType.ROCK: {
          Unit.create(
            getNeutralExtra(), FourCC(ROCK_UNIT_RAWS[GetRandomInt(0, 5)]),
            world.x, world.y, GetRandomReal(0, 360),
          );
          paintTile(world.x, world.y, TERRAIN_DIRT);
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
          if (grid.path[i]) {
            paintTile(world.x, world.y, TERRAIN_ROCK);
          } else if (isReserved(gx, gy)) {
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

  log('Spawned — trees: ' + treeCount + ', rocks: ' + rockCount + ', granite: ' + graniteCount);
}
