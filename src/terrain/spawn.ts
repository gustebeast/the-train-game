import { Destructable, Item, MapPlayer, TextTag, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Units } from '@objectdata/units';
import { Items } from '@objectdata/items';

import {
  Terrain, Entity, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  TREE_RAW, ROCK_RAW,
  idx, gridToWorld,
} from './constants';
import { DEFAULT_TRACK, SKINS } from '../track/constants';

import { getNeutralPassive, getNeutralExtra, getTrainPlayer } from '../teams';
import { registerResourceDest, pauseResourceDrops, resumeResourceDrops } from '../harvest';
import { placedTracks, setVictoryTile, resetVictoryTriggered } from '../track/state';
import { initReadyZone, cleanupReady } from '../ready';
import { setCrate } from '../items';
import { gameState } from '../state';
import { setCage, registerCageTrigger, cleanupCage } from '../creeps';

// Per-variation scales to normalize rock models to ~128-unit footprint.
const ROCK_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Destructable rawcodes (Lordaeron Summer) ---
const GRANITE_RAW = 'LTrc';  // Rock Chunks 1 (tinted dark + unselectable in compiletime)

// Per-variation scales to normalize destructable models to a consistent 128-unit footprint.
// Both LTrt and LTrc use the same base model with 6 variations.
// Footprints at scale 1.0: [210, 230, 204, 206, 210, 171]
const GRANITE_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

// --- Terrain tile FourCCs ---
const TERRAIN_FOURCC: Record<Terrain, string> = {
  [Terrain.GRASS]: 'Lgrs',
  [Terrain.GRASSY_DIRT]: 'Lgrd',
  [Terrain.ROCK]: 'Lrok',
  [Terrain.ROUGH_DIRT]: 'Ldro',
  [Terrain.WHITE_MARBLE]: 'Xwmb',
  [Terrain.BLACK_BRICKS]: 'Ibkb',
};

// PLAYER_1..PLAYER_4 entity types mapped to player slot indices
const PLAYER_ENTITIES = [Entity.PLAYER_1, Entity.PLAYER_2, Entity.PLAYER_3, Entity.PLAYER_4];

const CENTER_OFFSET = 16;

function paintTile(worldX: number, worldY: number, terrain: Terrain): void {
  SetTerrainType(worldX, worldY, FourCC(TERRAIN_FOURCC[terrain]), -1, 1, 0);
}

/** Create all WC3 objects and paint terrain from the generated grid. Returns the train unit if one was spawned. */
export function spawnTerrain(grid: Grid, skipCleanup = false): Unit | null {
  let trainUnit: Unit | null = null;

  // Resolve human players once for PLAYER_1..4 spawning
  const humanPlayers = Players.filter(
    (p: MapPlayer) => p.slotState === PLAYER_SLOT_STATE_PLAYING && p.controller === MAP_CONTROL_USER
  );

  if (!skipCleanup) {
    cleanupReady();
    cleanupCage();
    pauseResourceDrops();
    // Remove all destructables, units, and items before respawning
    EnumDestructablesInRect(GetWorldBounds()!, null!, () => RemoveDestructable(GetEnumDestructable()!));
    const g = CreateGroup()!;
    GroupEnumUnitsInRect(g, GetWorldBounds()!, null!);
    ForGroup(g, () => {
      const u = GetEnumUnit();
      if (u != null) RemoveUnit(u);
    });
    DestroyGroup(g);
    EnumItemsInRect(GetWorldBounds()!, null!, () => RemoveItem(GetEnumItem()!));
    resumeResourceDrops();
    placedTracks.length = 0;
    resetVictoryTriggered();

    // Reset fog of war to unexplored for all human players
    const world = GetWorldBounds()!;
    for (const p of humanPlayers) {
      const fog = CreateFogModifierRect(p.handle, FOG_OF_WAR_MASKED, world, true, false)!;
      FogModifierStart(fog);
      DestroyFogModifier(fog);
    }
  }

  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const cell = grid.cells[idx(gx, gy)];
      const world = gridToWorld({ x: gx, y: gy });

      // Paint terrain
      paintTile(world.x, world.y, cell.terrain);

      // Spawn entity
      switch (cell.entity) {
        case Entity.TREE: {
          const variation = GetRandomInt(0, 9);
          const tree = Destructable.create(
            FourCC(TREE_RAW), world.x, world.y,
            GetRandomReal(220, 320), 0.8, variation,
          );
          if (tree != null) registerResourceDest(tree);
          break;
        }

        case Entity.ROCK: {
          const variation = GetRandomInt(0, 5);
          const rock = Destructable.create(
            FourCC(ROCK_RAW), world.x, world.y,
            GetRandomReal(0, 360), ROCK_SCALES[variation], variation,
          );
          if (rock != null) registerResourceDest(rock);
          break;
        }

        case Entity.GRANITE: {
          const variation = GetRandomInt(0, 5);
          Destructable.create(
            FourCC(GRANITE_RAW), world.x, world.y,
            GetRandomReal(0, 360), GRANITE_SCALES[variation], variation,
          );
          break;
        }

        case Entity.WATER: {
          const w = Unit.create(getNeutralExtra(), FourCC(Units.Burrow), world.x, world.y, 0)!;
          w.invulnerable = true;
          break;
        }

        case Entity.WATER_VISIBLE: {
          const wv = Unit.create(getTrainPlayer(), FourCC(Units.Burrow), world.x, world.y, 0)!;
          wv.invulnerable = true;
          break;
        }

        case Entity.CRATE: {
          // Target crate — starts empty, synced to state in real-time
          const crateUnit = Unit.create(getNeutralExtra(), FourCC(Units.GrainWarehouse), world.x, world.y, 270);
          if (crateUnit != null) setCrate(crateUnit);
          gameState.crateTrackCount = 0;
          gameState.crateWoodCount = 0;
          gameState.crateStoneCount = 0;
          break;
        }

        case Entity.CRATE_START: {
          // Starting crate — syncCrateInventory populates from state or shows max in lobby
          const startCrate = Unit.create(getNeutralExtra(), FourCC(Units.GrainWarehouse), world.x, world.y, 270);
          if (startCrate != null) setCrate(startCrate);
          break;
        }

        case Entity.TRACK: {
          const track = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), world.x, world.y, 0)!;
          track.skin = FourCC(SKINS.EW);
          track.invulnerable = true;
          placedTracks.push(track);
          break;
        }

        case Entity.TRACK_WITH_TRAIN: {
          const track = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), world.x, world.y, 0)!;
          track.skin = FourCC(SKINS.EW);
          track.invulnerable = true;
          placedTracks.push(track);
          trainUnit = Unit.create(getNeutralPassive(), FourCC(Units.WarWagon), world.x + CENTER_OFFSET, world.y + CENTER_OFFSET, 0)!;
          break;
        }

        case Entity.AXE:
          Item.create(FourCC(Items.SturdyWarAxe), world.x, world.y);
          break;

        case Entity.PICKAXE:
          Item.create(FourCC(Items.RustyMiningPick), world.x, world.y);
          break;

        case Entity.BUCKET:
          Item.create(FourCC(Items.EmptyVial), world.x, world.y);
          break;

        case Entity.PLAYER_1:
        case Entity.PLAYER_2:
        case Entity.PLAYER_3:
        case Entity.PLAYER_4: {
          const playerIdx = PLAYER_ENTITIES.indexOf(cell.entity);
          if (playerIdx < humanPlayers.length) {
            Unit.create(humanPlayers[playerIdx], FourCC(Units.Peasant), world.x, world.y, 0);
            PanCameraToTimedForPlayer(humanPlayers[playerIdx].handle, world.x, world.y, 0);
          }
          break;
        }

        case Entity.SHOP: {
          const shop = Unit.create(getNeutralPassive(), FourCC(Units.GoblinMerchant), world.x, world.y, 270)!;
          shop.invulnerable = true;
          break;
        }

        case Entity.START_CIRCLE: {
          Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0);
          initReadyZone(world.x, world.y, 'start');
          const startTag = TextTag.create();
          if (startTag != null) {
            startTag.setText('NEXT', 0.024);
            startTag.setPos(world.x - 26, world.y - 12, 0);
            startTag.setColor(0, 255, 0, 255);
            startTag.setPermanent(true);
          }
          break;
        }

        case Entity.REVERT_CIRCLE: {
          Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0);
          initReadyZone(world.x, world.y, 'revert');
          const revertTag = TextTag.create();
          if (revertTag != null) {
            revertTag.setText('RESET', 0.024);
            revertTag.setPos(world.x - 29, world.y - 12, 0);
            revertTag.setColor(255, 0, 0, 255);
            revertTag.setPermanent(true);
          }
          break;
        }

        case Entity.CREEP_CAMP: {
          const cage = Destructable.create(FourCC('LOcg'), world.x, world.y, 0, 1, 0);
          if (cage != null) {
            setCage(cage);
            registerCageTrigger();
          }
          break;
        }
      }
    }
  }

  const exitWorld = gridToWorld(grid.exit);
  setVictoryTile(exitWorld.x, exitWorld.y);

  return trainUnit;
}

