import { Destructable, Item, Unit } from 'w3ts';
import { Units } from '@objectdata/units';

import {
  Terrain, Entity, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  TREE_RAW, ROCK_RAW, GRANITE_RAW, CAGE_RAW,
  idx, gridToWorld,
} from './constants';
import { DEFAULT_TRACK, SKINS } from '../track/constants';

import { getNeutralPassive, getNeutralExtra, getTrainPlayer } from '../teams';
import { registerResourceDest, pauseResourceDrops, resumeResourceDrops } from '../harvest';
import { placedTracks, setVictoryTile, resetVictoryTriggered } from '../track/state';
import { initReadyZone, cleanupReady } from '../ready';
import { setCrate, setCrateStart } from '../items';
import { setCage, registerCageTrigger, cleanupCage, cancelDPSTest } from '../creeps';
import { resetHeroState } from '../heroes';
import { destroyAllTimers } from '../timers';
import { AXE_ID, PICKAXE_ID, BUCKET_ID, PEASANT_ID, TRAIN_ID, TRACK_WAGON_ID, CRATE_ID, WATER_ID, CRITTER_TYPE_IDS } from '../constants';
import { getHumanPlayers, getWorldBounds, forEachUnitInWorld } from '../util';

// Per-variation scales to normalize rock/granite models to a consistent 128-unit footprint.
// Both LTrt (rock) and LTrc (granite) use the same base model with 6 variations.
// Footprints at scale 1.0: [210, 230, 204, 206, 210, 171]
const ROCK_MODEL_SCALES = [0.610, 0.556, 0.628, 0.621, 0.611, 0.748];

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

/** Spawn an initial E-W track piece and register it in placedTracks. */
function spawnStartingTrack(worldX: number, worldY: number): void {
  const track = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), worldX, worldY, 0)!;
  track.skin = FourCC(SKINS.EW);
  track.invulnerable = true;
  placedTracks.push(track);
}

/** The train units created by spawnTerrain (engine car and track wagon). */
export interface SpawnedTrain {
  engine: Unit | null;
  wagon: Unit | null;
}

/** Create all WC3 objects and paint terrain from the generated grid. Returns the train units if any were spawned. */
export function spawnTerrain(grid: Grid, skipCleanup = false): SpawnedTrain {
  let engineUnit: Unit | null = null;
  let wagonUnit: Unit | null = null;

  // Resolve human players once for PLAYER_1..4 spawning
  const humanPlayers = getHumanPlayers();

  if (!skipCleanup) {
    destroyAllTimers();
    cancelDPSTest();
    resetHeroState();
    cleanupReady();
    cleanupCage();
    pauseResourceDrops();
    // Remove all destructables, units, and items before respawning
    EnumDestructablesInRect(getWorldBounds(), null!, () => RemoveDestructable(GetEnumDestructable()!));
    forEachUnitInWorld(u => RemoveUnit(u));
    EnumItemsInRect(getWorldBounds(), null!, () => RemoveItem(GetEnumItem()!));
    resumeResourceDrops();
    placedTracks.length = 0;
    resetVictoryTriggered();

    // Reset fog of war to unexplored for all human players
    for (const p of humanPlayers) {
      const fog = CreateFogModifierRect(p.handle, FOG_OF_WAR_MASKED, getWorldBounds(), true, false)!;
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
            GetRandomReal(0, 360), ROCK_MODEL_SCALES[variation], variation,
          );
          if (rock != null) registerResourceDest(rock);
          break;
        }

        case Entity.GRANITE: {
          const variation = GetRandomInt(0, 5);
          Destructable.create(
            FourCC(GRANITE_RAW), world.x, world.y,
            GetRandomReal(0, 360), ROCK_MODEL_SCALES[variation], variation,
          );
          break;
        }

        case Entity.WATER: {
          const w = Unit.create(getNeutralExtra(), WATER_ID, world.x, world.y, 0)!;
          w.invulnerable = true;
          break;
        }

        case Entity.WATER_VISIBLE: {
          const wv = Unit.create(getTrainPlayer(), WATER_ID, world.x, world.y, 0)!;
          wv.invulnerable = true;
          break;
        }

        case Entity.CRATE: {
          // Target crate (right side) — starts empty, synced to state in real-time
          const crateUnit = Unit.create(getNeutralExtra(), CRATE_ID, world.x, world.y, 270);
          if (crateUnit != null) setCrate(crateUnit);
          break;
        }

        case Entity.CRATE_START: {
          // Starting crate (left side) — syncCrateInventory populates from state or shows max in lobby
          const startCrate = Unit.create(getNeutralExtra(), CRATE_ID, world.x, world.y, 270);
          if (startCrate != null) setCrateStart(startCrate);
          break;
        }

        case Entity.TRACK:
          spawnStartingTrack(world.x, world.y);
          break;

        case Entity.TRACK_WITH_ENGINE:
          spawnStartingTrack(world.x, world.y);
          engineUnit = Unit.create(getNeutralPassive(), TRAIN_ID, world.x + CENTER_OFFSET, world.y + CENTER_OFFSET, 0)!;
          break;

        case Entity.TRACK_WITH_WAGON:
          spawnStartingTrack(world.x, world.y);
          wagonUnit = Unit.create(getNeutralPassive(), TRACK_WAGON_ID, world.x + CENTER_OFFSET, world.y + CENTER_OFFSET, 0)!;
          break;

        case Entity.AXE:
          Item.create(AXE_ID, world.x, world.y);
          break;

        case Entity.PICKAXE:
          Item.create(PICKAXE_ID, world.x, world.y);
          break;

        case Entity.BUCKET:
          Item.create(BUCKET_ID, world.x, world.y);
          break;

        case Entity.PLAYER_1:
        case Entity.PLAYER_2:
        case Entity.PLAYER_3:
        case Entity.PLAYER_4: {
          const playerIdx = PLAYER_ENTITIES.indexOf(cell.entity);
          if (playerIdx < humanPlayers.length) {
            Unit.create(humanPlayers[playerIdx], PEASANT_ID, world.x, world.y, 0);
            PanCameraToTimedForPlayer(humanPlayers[playerIdx].handle, world.x, world.y, 0);
          }
          break;
        }

        case Entity.SHOP: {
          const shop = Unit.create(getNeutralPassive(), FourCC(Units.GoblinMerchant), world.x, world.y, 270)!;
          shop.invulnerable = true;
          break;
        }

        case Entity.SHADY_DEALER: {
          const dealer = Unit.create(getNeutralPassive(), FourCC(Units.TombOfRelics), world.x, world.y, 270)!;
          dealer.invulnerable = true;
          break;
        }

        case Entity.START_CIRCLE: {
          const startCircle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(startCircle.handle, 'Next Round');
          initReadyZone(world.x, world.y, 'start');
          break;
        }

        case Entity.REVERT_CIRCLE: {
          const revertCircle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(revertCircle.handle, 'Reset Purchases');
          SetUnitVertexColor(revertCircle.handle, 255, 180, 180, 255);
          initReadyZone(world.x, world.y, 'revert');
          break;
        }

        case Entity.CRITTER: {
          const critterType = CRITTER_TYPE_IDS[GetRandomInt(0, CRITTER_TYPE_IDS.length - 1)];
          const critter = Unit.create(getNeutralPassive(), critterType, world.x, world.y, GetRandomReal(0, 360));
          // No pathing so a wandering critter can never block track construction
          if (critter != null) SetUnitPathing(critter.handle, false);
          break;
        }

        case Entity.CREEP_CAMP: {
          const cage = Destructable.create(FourCC(CAGE_RAW), world.x, world.y, 0, 1, 0);
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

  return { engine: engineUnit, wagon: wagonUnit };
}

