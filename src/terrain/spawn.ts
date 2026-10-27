import { Destructable, Item, Unit } from 'w3ts';
import { Units } from '@objectdata/units';

import {
  Terrain, Entity, Grid, Biome, BIOMES,
  GRID_MIN_X, GRID_MAX_X, GRID_MIN_Y, GRID_MAX_Y, PATH_BLOCKER_RAW, BOARD_WALL_RAW, SIGHT_WALL_RAW,
  ROCK_MODEL_SCALES, GridPos,
  idx, gridToWorld,
} from './constants';
import { ROCK_RAW, GRANITE_RAW, CAGE_RAW } from '../sharedData';
import { DEFAULT_TRACK, TRACK_SIZE, TRACK_CENTER_OFFSET, skinFor } from '../track/constants';

import { getNeutralPassive, getNeutralExtra, getTrainPlayer } from '../teams';
import { registerResourceDest, pauseResourceDrops, resumeResourceDrops } from '../harvest';
import { spawnStrangeRock } from '../bossRock';
import { placedTracks, setVictoryTile, setBossVictoryTile, resetLineEnd, noteLineChanged } from '../track/state';
import { createReadyZone, clearReadyZones } from '../ready';
import { labelUnit } from '../unitLabels';
import { setCrate, setCrateStart } from '../items';
import { setCage, registerCageTrigger, clearCage } from '../creeps';
import { isDPSCheckUnit } from '../dpsCheck';
import { resetHeroState } from '../heroes';
import { stockShop, noteDealerPlaced } from '../shop';
import { stockSalesperson } from '../salesperson';
import { restoreAbilityItem } from '../abilityItems';
import { destroyAllTimers } from '../timers';
import { SALESPERSON_ID, AXE_ID, PICKAXE_ID, BUCKET_ID, PEASANT_ID, TRAIN_ID, TRACK_WAGON_ID, CRATE_ID, WATER_ID, CRITTER_TYPE_IDS } from '../constants';
import { getHumanPlayers, getWorldBounds, forEachUnitInWorld, forEachGroundItem, forEachDestructable } from '../util';

// --- Terrain tile FourCCs ----------------------------------------------------
// GRASS, GRASSY_DIRT and POOL depend on the biome; see tileFor.
const TERRAIN_FOURCC: Record<Exclude<Terrain, Terrain.GRASS | Terrain.GRASSY_DIRT | Terrain.POOL>, string> = {
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


function tileFor(terrain: Terrain, biome: Biome): string {
  if (terrain === Terrain.GRASS) return BIOMES[biome].grass;
  if (terrain === Terrain.GRASSY_DIRT) return BIOMES[biome].grassyDirt;
  if (terrain === Terrain.POOL) return BIOMES[biome].pool;
  return TERRAIN_FOURCC[terrain];
}

function paintTile(worldX: number, worldY: number, terrain: Terrain, biome: Biome): void {
  SetTerrainType(worldX, worldY, FourCC(tileFor(terrain, biome)), -1, 1, 0);
}

/** Spawn an initial E-W track piece and register it in placedTracks. */
function spawnStartingTrack(worldX: number, worldY: number): void {
  const track = Unit.create(getNeutralPassive(), FourCC(DEFAULT_TRACK), worldX, worldY, 0)!;
  track.skin = FourCC(skinFor('EW'));
  track.invulnerable = true;
  placedTracks.push(track);
}

/** The train units created by spawnTerrain (engine car and track wagon). */
export interface SpawnedTrain {
  engine: Unit | null;
  wagon: Unit | null;
}

/** Free-standing models dressing the current board. Special effects are not
 *  units, destructables or items, so the board sweep would leave them behind;
 *  registering one here means it goes with the board. */
const boardEffects: effect[] = [];

/** Stand a model on the board as scenery, removed with the board. */
export function addBoardEffect(model: string, x: number, y: number, scale: number): effect | null {
  const fx = AddSpecialEffect(model, x, y);
  if (fx == null) return null;
  BlzSetSpecialEffectScale(fx, scale);
  boardEffects.push(fx);
  return fx;
}

/** Where the arena template said the party and the boss go, in grid
 *  coordinates. Filled while the grid is walked and read by bossArena.ts --
 *  the template marks the places, the arena decides who fills them. */
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

/** The ready-zone circles.
 *
 *  Every one is the same Circle of Power differing only in what it says and
 *  which zone it arms, so they are a table rather than ten cases that were
 *  identical apart from two strings. `warning` tints it red: those are the
 *  circles that undo or abandon something rather than move the run forward. */
const READY_CIRCLES: { [entity: number]: { label: string; zone: string; warning?: boolean } } = {
  [Entity.START_CIRCLE]:    { label: 'Next Round',      zone: 'start' },
  [Entity.REVERT_CIRCLE]:   { label: 'Reset Purchases', zone: 'revert', warning: true },
  [Entity.NEW_GAME_CIRCLE]: { label: 'New Game',        zone: 'newgame' },
  [Entity.RESTART_CIRCLE]:  { label: 'Restart',         zone: 'restart', warning: true },
  [Entity.LOAD_CIRCLE]:     { label: 'Load Save',       zone: 'loadsave' },
  [Entity.BACK_CIRCLE]:     { label: 'Back',            zone: 'saveback' },
  [Entity.PREV_CIRCLE]:     { label: 'Newer Save',      zone: 'saveprev' },
  [Entity.NEXT_CIRCLE]:     { label: 'Older Save',      zone: 'savenext' },
  [Entity.CONFIRM_CIRCLE]:  { label: 'Play This Save',  zone: 'saveconfirm' },
  [Entity.TUTORIAL_CIRCLE]: { label: 'Tutorial',        zone: 'tutorial' },
};

/** Stand a ready-zone circle at a world position and arm its zone. An empty
 *  label makes an unmarked circle: no floating text, and no name when it is
 *  selected. `members` makes it wait for those units rather than for a peasant
 *  from every player (see createReadyZone). */
export function spawnReadyCircle(
  x: number, y: number, spec: { label: string; zone: string; warning?: boolean },
  members: unit[] | null = null,
): void {
  const circle = Unit.create(getNeutralExtra(), FourCC(Units.CircleOfPower), x, y, 0);
  if (circle == null) return;
  // The name stays: it is what selecting the circle shows. The floating label
  // says the same thing without having to click. An unmarked circle is named a
  // single space, which shows as nothing: an EMPTY name crashes the game
  // outright (measured -- BlzSetUnitName with '' never returns).
  BlzSetUnitName(circle.handle, spec.label === '' ? ' ' : spec.label);
  // White for every circle. The warning circles are already told apart by the
  // red tint on the circle itself.
  if (spec.label !== '') labelUnit(circle.handle, spec.label, 255, 255, 255);
  if (spec.warning === true) SetUnitVertexColor(circle.handle, 255, 180, 180, 255);
  createReadyZone(x, y, spec.zone, circle, members);
}

/** Take the current board down completely: every unit, destructable, item and
 *  board effect, every board-tracked timer (timers.ts), and the per-board state
 *  of the systems that keep any, in the order they need it -- the sparring
 *  match before the heroes it fields, resource drops paused so clearing the
 *  trees does not rain wood. Then the fog goes back to unexplored.
 *
 *  Everything a board leaves behind has to be undone here or by its owner on
 *  the way out; spawnTerrain calls this first, so anything set up BEFORE
 *  spawnTerrain on the way into a board is set up on the old one. */
function clearBoard(): void {
  destroyAllTimers();
  resetHeroState();
  clearReadyZones();
  clearCage();
  pauseResourceDrops();
  forEachDestructable(d => RemoveDestructable(d));
  // Except the DPS check's fights, out beyond the wall: they carry on from the
  // inter-round lobby into the round (dpsCheck.ts), and stop themselves.
  forEachUnitInWorld(u => { if (!isDPSCheckUnit(u)) RemoveUnit(u); });
  forEachGroundItem(it => RemoveItem(it));
  for (const fx of boardEffects) DestroyEffect(fx);
  boardEffects.length = 0;
  resumeResourceDrops();
  placedTracks.length = 0;
  resetLineEnd();
  noteLineChanged();
  bossHeroSpots = [];
  bossMercSpots = [];
  bossSpot = null;

  for (const p of getHumanPlayers()) {
    const fog = CreateFogModifierRect(p.handle, FOG_OF_WAR_MASKED, getWorldBounds(), true, false)!;
    FogModifierStart(fog);
    DestroyFogModifier(fog);
  }
}

/** Ring the board with blockers one cell outside its edge: nothing walks or
 *  flies off it, and nothing on it sees past it.
 *
 *  Built here rather than in the map file because clearBoard removes every
 *  destructable on the map, the editor's included -- blockers placed in the
 *  editor were gone after the first board loaded. The old map never showed
 *  it: its ground beyond the board was unwalkable in the map's own pathing.
 *  The ground out there is walkable now, for the DPS check's fight rows above
 *  and below the board, which this wall keeps out of reach and out of sight. */
function wallBoard(): void {
  // The small sight blocker is half a cell across, so two per cell, laid
  // along the wall: (dx, dy) is the wall's direction at this cell.
  const half = TRACK_SIZE / 4;
  const wallAt = (gx: number, gy: number, dx: number, dy: number, sight = true): void => {
    const w = gridToWorld({ x: gx, y: gy });
    Destructable.create(FourCC(BOARD_WALL_RAW), w.x, w.y, 0, 1, 0);
    if (!sight) return;
    Destructable.create(FourCC(SIGHT_WALL_RAW), w.x - dx * half, w.y - dy * half, 0, 1, 0);
    Destructable.create(FourCC(SIGHT_WALL_RAW), w.x + dx * half, w.y + dy * half, 0, 1, 0);
  };
  for (let gx = GRID_MIN_X - 1; gx <= GRID_MAX_X + 1; gx++) {
    wallAt(gx, GRID_MIN_Y - 1, 1, 0);
    wallAt(gx, GRID_MAX_Y + 1, 1, 0);
  }
  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    wallAt(GRID_MIN_X - 1, gy, 0, 1);
    wallAt(GRID_MAX_X + 1, gy, 0, 1);
  }
  // And a second wall, map-wide, three cells further out above and below:
  // the DPS check fights beyond it, no closer to the board than a test fight
  // that could not be heard from it (about 500 out). Pathing only -- the
  // first wall already blocks the board's sight; this one only keeps the
  // fights from walking up to it.
  for (let gx = -KEEP_OUT_HALF_WIDTH; gx <= KEEP_OUT_HALF_WIDTH; gx++) {
    wallAt(gx, GRID_MIN_Y - KEEP_OUT_CELLS, 1, 0, false);
    wallAt(gx, GRID_MAX_Y + KEEP_OUT_CELLS, 1, 0, false);
  }
}

/** How many cells beyond the board's edge the DPS check's wall stands. */
const KEEP_OUT_CELLS = 3;
/** The map's half-width in cells (it is 6144 across). */
const KEEP_OUT_HALF_WIDTH = 24;

/** Replace the board: clear the old one (clearBoard), then paint the grid's
 *  terrain and create everything it places. Returns the train units if the
 *  grid has a train. */
export function spawnTerrain(grid: Grid): SpawnedTrain {
  clearBoard();
  wallBoard();
  let engineUnit: Unit | null = null;
  let wagonUnit: Unit | null = null;

  // Resolve human players once for PLAYER_1..4 spawning
  const humanPlayers = getHumanPlayers();

  for (let gy = GRID_MIN_Y; gy <= GRID_MAX_Y; gy++) {
    for (let gx = GRID_MIN_X; gx <= GRID_MAX_X; gx++) {
      const cell = grid.cells[idx(gx, gy)];
      const world = gridToWorld({ x: gx, y: gy });

      // Paint terrain
      paintTile(world.x, world.y, cell.terrain, grid.biome);

      // Spawn entity
      const readyCircle = READY_CIRCLES[cell.entity];
      if (readyCircle != null) {
        spawnReadyCircle(world.x, world.y, readyCircle);
        continue;
      }

      switch (cell.entity) {
        case Entity.TREE: {
          const variation = GetRandomInt(0, 9);
          const tree = Destructable.create(
            FourCC(BIOMES[grid.biome].tree), world.x, world.y,
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
          spawnStrangeRock(world.x, world.y);
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
          // Starting crate (left side) — loadCrateForRound fills it from state, or
          // loadCrateForInterRoundLobby shows it full in the inter-round lobby
          const startCrate = Unit.create(getNeutralExtra(), CRATE_ID, world.x, world.y, 270);
          if (startCrate != null) setCrateStart(startCrate);
          break;
        }

        case Entity.TRACK:
          spawnStartingTrack(world.x, world.y);
          break;

        case Entity.TRACK_WITH_ENGINE:
          spawnStartingTrack(world.x, world.y);
          engineUnit = Unit.create(getNeutralPassive(), TRAIN_ID, world.x + TRACK_CENTER_OFFSET, world.y + TRACK_CENTER_OFFSET, 0)!;
          break;

        case Entity.TRACK_WITH_WAGON:
          spawnStartingTrack(world.x, world.y);
          wagonUnit = Unit.create(getNeutralPassive(), TRACK_WAGON_ID, world.x + TRACK_CENTER_OFFSET, world.y + TRACK_CENTER_OFFSET, 0)!;
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
            const peasant = Unit.create(humanPlayers[playerIdx], PEASANT_ID, world.x, world.y, 0);
            if (peasant != null) restoreAbilityItem(peasant.handle);
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

        case Entity.SALESPERSON: {
          const salesperson = Unit.create(getNeutralPassive(), SALESPERSON_ID, world.x, world.y, 270)!;
          salesperson.invulnerable = true;
          stockSalesperson(salesperson.handle);
          break;
        }

        case Entity.SHOP: {
          const shop = Unit.create(getNeutralPassive(), FourCC(Units.Marketplace), world.x, world.y, 270)!;
          shop.invulnerable = true;
          stockShop(shop);
          break;
        }

        case Entity.SHADY_DEALER: {
          const dealer = Unit.create(getNeutralPassive(), FourCC(Units.TombOfRelics), world.x, world.y, 270)!;
          dealer.invulnerable = true;
          noteDealerPlaced();
          break;
        }

        case Entity.CRITTER: {
          const critterType = CRITTER_TYPE_IDS[GetRandomInt(0, CRITTER_TYPE_IDS.length - 1)];
          // Neutral EXTRA, not neutral passive. Players share vision with
          // neutral passive so their own rail line is visible, and
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

