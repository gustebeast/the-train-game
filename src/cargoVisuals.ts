import { Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { WOOD_ID, STONE_ID, TRACK_PIECE_ID } from './constants';
import { findItemByType } from './items';
import { onGlobalTick } from './globalTick';
import { getTrain, getTrackWagon } from './train';

// Attachment abilities configured in compiletime.ts: stone and wood attach to
// the engine at distinct sprite refs, tracks attach to the wagon's chest.
const TRAIN_STONE_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus9);
const TRAIN_WOOD_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus12);
const WAGON_TRACK_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus15);

/** Add or remove an attachment ability to match whether cargo is present. */
function syncAttachment(u: Unit, abilityId: number, show: boolean): void {
  const has = GetUnitAbilityLevel(u.handle, abilityId) > 0;
  if (show && !has) {
    UnitAddAbility(u.handle, abilityId);
  } else if (!show && has) {
    UnitRemoveAbility(u.handle, abilityId);
  }
}

function hasCargo(u: Unit, itemTypeId: number): boolean {
  const it = findItemByType(u, itemTypeId);
  return it != null && it.charges > 0;
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
    if (train != null && GetUnitTypeId(train.handle) !== 0) {
      syncAttachment(train, TRAIN_STONE_ABILITY_ID, hasCargo(train, STONE_ID));
      syncAttachment(train, TRAIN_WOOD_ABILITY_ID, hasCargo(train, WOOD_ID));
    }
    const wagon = getTrackWagon();
    if (wagon != null && GetUnitTypeId(wagon.handle) !== 0) {
      syncAttachment(wagon, WAGON_TRACK_ABILITY_ID, hasCargo(wagon, TRACK_PIECE_ID));
    }
  });
}
