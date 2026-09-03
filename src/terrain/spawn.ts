import { Destructable, Item, Unit } from 'w3ts';
import { Units } from '@objectdata/units';

import {
  Terrain, Entity, Grid,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y,
  TREE_RAW, ROCK_RAW, GRANITE_RAW, CAGE_RAW, PATH_BLOCKER_RAW, STRANGE_ROCK_RAW, GridPos,
  idx, gridToWorld,
} from './constants';
import { DEFAULT_TRACK, SKINS } from '../track/constants';

import { getNeutralPassive, getNeutralExtra, getTrainPlayer } from '../teams';
import { registerResourceDest, pauseResourceDrops, resumeResourceDrops } from '../harvest';
import { TRACK_SIZE } from '../track/constants';
import { registerStrangeRock } from '../bossrock';
import { placedTracks, setVictoryTile, setBossVictoryTile, resetVictoryTriggered } from '../track/state';
import { initReadyZone, cleanupReady } from '../ready';
import { setCrate, setCrateStart } from '../items';
import { setCage, registerCageTrigger, cleanupCage, cancelDPSTest } from '../creeps';
import { resetHeroState } from '../heroes';
import { stockShop, registerDealer } from '../shop';
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
  [Terrain.DUNGEON_DIRT]: 'Ddrt',
  [Terrain.DUNGEON_BRICK]: 'Dbrk',
  [Terrain.DUNGEON_RED_STONE]: 'Drds',
  [Terrain.LAVA_CRACKS]: 'Dlvc',
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
/** Where the arena template said the party and the boss go, in world
 *  coordinates. Filled while the grid is walked and read by loadBossBattlefield
 *  -- the template marks the places, the arena decides who fills them. */
let bossHeroSpots: GridPos[] = [];
let bossMercSpots: GridPos[] = [];
let bossSpot: GridPos | null = null;

export function getBossHeroSpots(): ReadonlyArray<GridPos> { return bossHeroSpots; }
export function getBossMercSpots(): ReadonlyArray<GridPos> { return bossMercSpots; }
export function getBossSpot(): GridPos | null { return bossSpot; }

/** How much less the water border should see: three tiles. */
const WATER_SIGHT_REDUCTION = 3 * TRACK_SIZE;
/** Never take it below a tile, or the border stops granting vision at all and
 *  the shoreline goes dark instead of merely stopping short. */
const MIN_WATER_SIGHT = TRACK_SIZE;

/**
 * Pull the water border's vision in by three tiles.
 *
 * Done to the UNIT rather than in object data, because the object data is not
 * what the engine is using: the water block is authored at 180 sight by day --
 * under a tile and a half -- and the border still shows the player the edge of
 * the map, which breaks the illusion of open ocean. Something is raising it,
 * so the only honest starting point is the radius the engine reports for the
 * unit it just made, and three tiles comes off that.
 */
function shrinkWaterSight(u: Unit): void {
  const current = BlzGetUnitRealField(u.handle, UNIT_RF_SIGHT_RADIUS);
  const wanted = current - WATER_SIGHT_REDUCTION;
  BlzSetUnitRealField(u.handle, UNIT_RF_SIGHT_RADIUS,
    wanted > MIN_WATER_SIGHT ? wanted : MIN_WATER_SIGHT);
}

export function spawnTerrain(grid: Grid, skipCleanup = false): SpawnedTrain {
  let engineUnit: Unit | null = null;
  let wagonUnit: Unit | null = null;
  bossHeroSpots = [];
  bossMercSpots = [];
  bossSpot = null;

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

        case Entity.STRANGE_ROCK: {
          // Full size and unrotated: this one is a landmark, not scenery.
          const seal = Destructable.create(FourCC(STRANGE_ROCK_RAW), world.x, world.y, 0, 1.4, 0);
          if (seal != null) registerStrangeRock(seal.handle);
          break;
        }

        case Entity.LAVA: {
          // Terrain does the looking; this only stops anyone walking onto it.
          // A destructable rather than a unit so the existing sweep clears it
          // with the trees and rocks, and because it has no model to hide.
          Destructable.create(FourCC(PATH_BLOCKER_RAW), world.x, world.y, 0, 1, 0);
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
          shrinkWaterSight(wv);
          break;
        }

        case Entity.CRATE: {
          // Target crate (right side) — starts empty, synced to state in real-time
          const crateUnit = Unit.create(getNeutralExtra(), CRATE_ID, world.x, world.y, 270);
          if (crateUnit != null) setCrate(crateUnit);
          break;
        }

        case Entity.CRATE_START: {
          // Starting crate (left side) — syncCrateInventory populates from state or shows max in inter-round lobby
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

        case Entity.HERO_SPOT:
          bossHeroSpots.push({ x: world.x, y: world.y });
          break;

        case Entity.MERC_SPOT:
          bossMercSpots.push({ x: world.x, y: world.y });
          break;

        case Entity.BOSS_SPOT:
          bossSpot = { x: world.x, y: world.y };
          break;

        case Entity.SHOP: {
          const shop = Unit.create(getNeutralPassive(), FourCC(Units.Marketplace), world.x, world.y, 270)!;
          shop.invulnerable = true;
          stockShop(shop);
          break;
        }

        case Entity.SHADY_DEALER: {
          const dealer = Unit.create(getNeutralPassive(), FourCC(Units.TombOfRelics), world.x, world.y, 270)!;
          dealer.invulnerable = true;
          registerDealer(dealer);
          break;
        }

        case Entity.START_CIRCLE: {
          const startCircle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(startCircle.handle, 'Next Round');
          initReadyZone(world.x, world.y, 'start', startCircle);
          break;
        }

        case Entity.REVERT_CIRCLE: {
          const revertCircle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(revertCircle.handle, 'Reset Purchases');
          SetUnitVertexColor(revertCircle.handle, 255, 180, 180, 255);
          initReadyZone(world.x, world.y, 'revert', revertCircle);
          break;
        }

        case Entity.NEW_GAME_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'New Game');
          initReadyZone(world.x, world.y, 'newgame', circle);
          break;
        }

        case Entity.RESTART_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Restart');
          SetUnitVertexColor(circle.handle, 255, 180, 180, 255);
          initReadyZone(world.x, world.y, 'restart', circle);
          break;
        }

        case Entity.LOAD_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Load Save');
          initReadyZone(world.x, world.y, 'loadsave', circle);
          break;
        }

        case Entity.BACK_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Back');
          initReadyZone(world.x, world.y, 'saveback', circle);
          break;
        }

        case Entity.PREV_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Newer Save');
          initReadyZone(world.x, world.y, 'saveprev', circle);
          break;
        }

        case Entity.NEXT_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Older Save');
          initReadyZone(world.x, world.y, 'savenext', circle);
          break;
        }

        case Entity.CONFIRM_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Play This Save');
          initReadyZone(world.x, world.y, 'saveconfirm', circle);
          break;
        }

        case Entity.TUTORIAL_CIRCLE: {
          const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), world.x, world.y, 0)!;
          BlzSetUnitName(circle.handle, 'Tutorial');
          initReadyZone(world.x, world.y, 'tutorial', circle);
          break;
        }

        case Entity.CRITTER: {
          const critterType = CRITTER_TYPE_IDS[GetRandomInt(0, CRITTER_TYPE_IDS.length - 1)];
          // Neutral EXTRA, not neutral passive. Players share vision with
          // neutral passive so their own rail line and crates are visible, and
          // critters owned there each became a permanent eye -- a round opened
          // with wildlife-shaped patches of the map already uncovered instead of
          // black. Neutral extra is allied without vision, which is what
          // scenery wants.
          Unit.create(getNeutralExtra(), critterType, world.x, world.y, GetRandomReal(0, 360));
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
  if (grid.bossExit != null) {
    const bossWorld = gridToWorld(grid.bossExit);
    setBossVictoryTile(bossWorld.x, bossWorld.y);
  }

  return { engine: engineUnit, wagon: wagonUnit };
}

