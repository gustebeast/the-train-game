import { Unit } from 'w3ts';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID } from './constants';
import { findItemByType } from './items';
import { onGlobalTick } from './globalTick';
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
    model: 'Doodads\\LordaeronSummer\\Rocks\\Lords_Rock\\Lords_Rock6.mdx',
    attachPoint: 'sprite first',
    scale: 0.275,
    effect: null,
    attachedTo: null,
  },
  {
    itemTypeId: WOOD_ID,
    model: 'Doodads\\Felwood\\Props\\FelwoodLogStraight\\FelwoodLogStraight.mdx',
    attachPoint: 'sprite second',
    scale: 0.275,
    effect: null,
    attachedTo: null,
  },
];

const wagonVisuals: CargoVisual[] = [
  {
    itemTypeId: TRACK_PIECE_ID,
    model: 'war3mapImported\\OmniTrackSmall.mdx',
    // 'overhead' rather than 'chest': the chest ref sits low enough that the
    // wagon body swallows the track model (confirmed by the oversized-track
    // test). Overhead is the highest ref TrackWagon.mdx has (origin/overhead/
    // chest) — attached transform natives can't move an effect after the
    // fact, so raising means picking a higher ref.
    attachPoint: 'overhead',
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

/**
 * Show cargo models on the train cars while they carry the matching cargo.
 *
 * Polls on the global tick (like the minimap icon scanner) so every way
 * cargo can change — give/take, production consuming wood+stone into
 * tracks, round resets replacing the units — is covered by one code path.
 */
export function initCargoVisuals(): void {
  onGlobalTick(() => {
    const train = getTrain();
    for (const v of engineVisuals) syncVisual(v, train);
    const wagon = getTrackWagon();
    for (const v of wagonVisuals) syncVisual(v, wagon);
  });
}
