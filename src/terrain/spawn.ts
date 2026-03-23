import { Destructable, Item, MapPlayer, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Units } from '@objectdata/units';
import { Items } from '@objectdata/items';
import {
  CellType, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  TREE_RAW, ROCK_RAW,
  idx, gridToWorld, isReserved,
} from './constants';
import { DEFAULT_TRACK, SKINS } from '../track/constants';

import { getNeutralPassive, getNeutralExtra } from '../teams';
import { registerResourceDest, pauseResourceDrops, resumeResourceDrops } from '../harvest';
import { placedTracks, setVictoryTile } from '../track/state';

// Per-variation scales to normalize rock models to ~128-unit footprint.
const ROCK_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Destructable rawcodes (Lordaeron Summer) ---
const GRANITE_RAW = 'LTrc';  // Rock Chunks 1 (tinted dark + unselectable in compiletime)

// Per-variation scales to normalize destructable models to a consistent 128-unit footprint.
// Both LTrt and LTrc use the same base model with 6 variations.
// Footprints at scale 1.0: [210, 230, 204, 206, 210, 171]
const GRANITE_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Terrain tile FourCCs ---
const TERRAIN_GRASS = 'Lgrs';
const TERRAIN_DIRT = 'Ldrt';
const TERRAIN_GRASSY_DIRT = 'Lgrd';
const TERRAIN_ROCK = 'Lrok';
const TERRAIN_ROUGH_DIRT = 'Ldro';
const TERRAIN_WHITE_MARBLE = 'Xwmb';
const TERRAIN_ABYSS = 'Oaby';

// PLAYER_1..PLAYER_4 cell types mapped to player slot indices
const PLAYER_CELL_TYPES = [CellType.PLAYER_1, CellType.PLAYER_2, CellType.PLAYER_3, CellType.PLAYER_4];

function paintTile(worldX: number, worldY: number, terrainFourCC: string): void {
  SetTerrainType(worldX, worldY, FourCC(terrainFourCC), -1, 1, 0);
}


/** Create all WC3 destructables and paint terrain from the generated grid. */
export function spawnTerrain(grid: Grid, skipCleanup = false): void {
  let treeCount = 0;
  let rockCount = 0;
  let graniteCount = 0;

  // Resolve human players once for PLAYER_1..4 spawning
  const humanPlayers = Players.filter(
    (p: MapPlayer) => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );

  if (!skipCleanup) {
    pauseResourceDrops();
    // Remove all destructables and units before respawning
    EnumDestructablesInRect(GetWorldBounds()!, null!, () => RemoveDestructable(GetEnumDestructable()!));
    const g = CreateGroup()!;
    GroupEnumUnitsInRect(g, GetWorldBounds()!, null!);
    ForGroup(g, () => {
      const u = GetEnumUnit();
      if (u != null) RemoveUnit(u);
    });
    DestroyGroup(g);
    resumeResourceDrops();
  }

  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const i = idx(gx, gy);
      const world = gridToWorld({ x: gx, y: gy });

      switch (grid.cells[i]) {
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

        case CellType.ABYSS:
          paintTile(world.x, world.y, TERRAIN_ABYSS);
          break;

        case CellType.MARBLE:
          paintTile(world.x, world.y, TERRAIN_WHITE_MARBLE);
          break;

        case CellType.CRATE: {
          Unit.create(getNeutralExtra(), FourCC(Units.GrainWarehouse), world.x, world.y, 270);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;
        }

        case CellType.TRACK: {
          const track = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), world.x, world.y, 0)!;
          track.skin = FourCC(SKINS.EW);
          track.invulnerable = true;
          placedTracks.push(track);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;
        }

        case CellType.AXE:
          Item.create(FourCC(Items.SturdyWarAxe), world.x, world.y);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;

        case CellType.PICKAXE:
          Item.create(FourCC(Items.RustyMiningPick), world.x, world.y);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;

        case CellType.BUCKET:
          Item.create(FourCC(Items.EmptyVial), world.x, world.y);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;

        case CellType.PLAYER_1:
        case CellType.PLAYER_2:
        case CellType.PLAYER_3:
        case CellType.PLAYER_4: {
          const playerIdx = PLAYER_CELL_TYPES.indexOf(grid.cells[i]);
          if (playerIdx < humanPlayers.length) {
            Unit.create(humanPlayers[playerIdx], FourCC(Units.Peasant), world.x, world.y, 0);
            PanCameraToTimedForPlayer(humanPlayers[playerIdx].handle, world.x, world.y, 0);
          }
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;
        }

        case CellType.START_CIRCLE: {
          const cop = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          SetUnitScale(cop.handle, 1.5, 1.5, 1.5);
          paintTile(world.x, world.y, TERRAIN_GRASSY_DIRT);
          break;
        }
      }
    }
  }

  const exitWorld = gridToWorld(grid.exit);
  setVictoryTile(exitWorld.x, exitWorld.y);

}
