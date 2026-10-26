import { Unit } from 'w3ts';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID } from './constants';
import { STONE_MODEL, WOOD_MODEL, SMALL_TRACK_MODEL } from './sharedData';
import { findItemByType } from './items';
import { nextFrame } from './util';
import { getTrain, getTrackWagon } from './train';

/**
 * One cargo → attached-model rule. Uses AddSpecialEffectTarget (not the
 * attachment-ability trick the peasant tools use) because effects can be
 * sized with BlzSetSpecialEffectScale — attachment abilities always render
 * the model at its natural size, which was far too large for the doodad
 * rock/log models.
 */
interface CargoVisual {
  itemTypeId: number;
  model: string;
  attachPoint: string;
  scale: number;
  /** Live effect while shown, and the unit handle it is attached to
   *  (round resets replace the train units, orphaning the old effect). */
  effect: effect | null;
  attachedTo: unit | null;
}

const engineVisuals: CargoVisual[] = [
  {
    itemTypeId: STONE_ID,
    model: STONE_MODEL,
    attachPoint: 'sprite first',
    scale: 0.275,
    effect: null,
    attachedTo: null,
  },
  {
    itemTypeId: WOOD_ID,
    model: WOOD_MODEL,
    attachPoint: 'sprite second',
    scale: 0.275,
    effect: null,
    attachedTo: null,
  },
];

const wagonVisuals: CargoVisual[] = [
  {
    itemTypeId: TRACK_PIECE_ID,
    model: SMALL_TRACK_MODEL,
    // TrackWagon.mdx's chest ref was repurposed as the cargo anchor: its
    // pivot is patched to the wagon's rear center at bed height (-85, 0, 75)
    // via scripts/patch-attachment-pivot.js. (The stock chest position sat
    // inside the wagon body and swallowed the model; overhead floated it.)
    attachPoint: 'chest',
    scale: 1.5,
    effect: null,
    attachedTo: null,
  },
];

function hasCargo(u: Unit, itemTypeId: number): boolean {
  const it = findItemByType(u, itemTypeId);
  return it != null && it.charges > 0;
}

/** Create/destroy the visual's effect to match the unit's current cargo. */
function syncVisual(v: CargoVisual, u: Unit): void {
  const alive = u != null && GetUnitTypeId(u.handle) !== 0;
  const show = alive && hasCargo(u, v.itemTypeId);

  if (v.effect != null && (!show || v.attachedTo !== u.handle)) {
    // Scale to 0 before destroying so the model vanishes instantly instead
    // of lingering through its death animation
    BlzSetSpecialEffectScale(v.effect, 0);
    DestroyEffect(v.effect);
    v.effect = null;
    v.attachedTo = null;
  }
  if (show && v.effect == null) {
    const e = AddSpecialEffectTarget(v.model, u.handle, v.attachPoint);
    if (e != null) {
      BlzSetSpecialEffectScale(e, v.scale);
      v.effect = e;
      v.attachedTo = u.handle;
    }
  }
}

function syncAll(): void {
  const train = getTrain();
  for (const v of engineVisuals) syncVisual(v, train);
  const wagon = getTrackWagon();
  for (const v of wagonVisuals) syncVisual(v, wagon);
}

/**
 * Show cargo models on the train cars while they carry the matching cargo.
 *
 * Driven by item pickup and drop on the two cars, not by polling. A model
 * shows while its car holds the item with any charges, and every stack that
 * runs out is removed rather than left at zero, so what is on screen can only
 * change when an item ENTERS or LEAVES a car's inventory. Both are events,
 * whatever caused them:
 *
 *  - entering: a player's give, setStorageItem adding a new stack (production,
 *    the lobby's display stock), anything else using UnitAddItem -- script
 *    UnitAddItem fires pickup;
 *  - leaving: a take, and RemoveItem on a carried item -- which fires drop, in
 *    the same frame, measured before relying on it. That is production using
 *    up the last wood or stone, and setStorageItem setting a stack to zero.
 *
 * A charge count changing in place (5 -> 4) changes nothing on screen, so it
 * needs no event. Neither does a round replacing the cars: a fresh car's cargo
 * arrives through UnitAddItem like anything else, and syncVisual already moves
 * an effect off a car that is no longer the current one.
 */
export function initCargoVisuals(): void {
  const items = CreateTrigger();
  for (let i = 0; i < bj_MAX_PLAYER_SLOTS; i++) {
    TriggerRegisterPlayerUnitEvent(items, Player(i)!, EVENT_PLAYER_UNIT_PICKUP_ITEM, null!);
    TriggerRegisterPlayerUnitEvent(items, Player(i)!, EVENT_PLAYER_UNIT_DROP_ITEM, null!);
  }
  TriggerAddAction(items, () => {
    const u = GetTriggerUnit();
    const train = getTrain();
    const wagon = getTrackWagon();
    if (u == null) return;
    if ((train == null || u !== train.handle) && (wagon == null || u !== wagon.handle)) return;
    // A frame later: DROP fires while the item is still in the inventory.
    nextFrame(() => syncAll());
  });
}

/** Which models are currently showing on the CURRENT cars. For tests. */
export function cargoShowing(): { stone: boolean; wood: boolean; tracks: boolean } {
  const on = (v: CargoVisual, u: Unit | null): boolean =>
    v.effect != null && u != null && v.attachedTo === u.handle;
  const train = getTrain();
  const wagon = getTrackWagon();
  return {
    stone: on(engineVisuals[0], train),
    wood: on(engineVisuals[1], train),
    tracks: on(wagonVisuals[0], wagon),
  };
}
