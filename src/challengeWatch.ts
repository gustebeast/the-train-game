import { onGlobalTick } from './globalTick';
import { isInGameplay } from './state';
import { isChallengeArmed } from './challenges';
import {
  CH_BRINK, CH_SOLO_TOOLS, BRINK_TRACKS,
  noteBrinkSecond, resetBrinkSeconds, noteToolSharingBroken,
} from './challengeList';
import { getTracksRemaining } from './train';
import { AXE_ID, PICKAXE_ID, BUCKET_ID, BUCKET_FULL_ID } from './constants';
import { forEachUnitInWorld } from './util';

/**
 * The two challenges nobody else can report on.
 *
 * Everything else is completed by the system that owns the event — a track
 * being laid, a dash cast, the last creep dying. These two are *states* rather
 * than events, so they have to be sampled: "the train has been near the end of
 * the line for N seconds", and "no two peasants are holding the same tool".
 * Both ride the shared global tick rather than starting timers of their own.
 */

/** Global tick is 0.5s; the brink challenge counts whole seconds. */
const TICKS_PER_SECOND = 2;
let brinkTicks = 0;

/** A full bucket and an empty one are the same tool for this purpose -- passing
 *  a bucket around by filling it would otherwise dodge the restriction. */
function toolKey(itemTypeId: number): number | null {
  if (itemTypeId === AXE_ID) return AXE_ID;
  if (itemTypeId === PICKAXE_ID) return PICKAXE_ID;
  if (itemTypeId === BUCKET_ID || itemTypeId === BUCKET_FULL_ID) return BUCKET_ID;
  return null;
}

/** Sample the world for two units holding the same tool type.
 *
 *  Checked continuously rather than on pickup: a tool can change hands by being
 *  dropped, by a unit dying, or by the give/take system, and watching one event
 *  would miss the others. Once broken it stays broken for the round, so this
 *  stops looking. */
function checkToolSharing(): void {
  const seen: number[] = [];
  let broken = false;
  forEachUnitInWorld(u => {
    if (broken) return;
    const held: number[] = [];
    for (let slot = 0; slot < 6; slot++) {
      const item = UnitItemInSlot(u, slot);
      if (item == null) continue;
      const key = toolKey(GetItemTypeId(item));
      if (key == null) continue;
      // Two of the same tool on ONE unit is still one holder, so only count a
      // given tool type once per unit.
      if (!held.includes(key)) held.push(key);
    }
    for (const key of held) {
      if (seen.includes(key)) {
        broken = true;
        return;
      }
      seen.push(key);
    }
  });
  if (broken) noteToolSharingBroken();
}

function tick(): void {
  if (!isInGameplay()) return;

  if (isChallengeArmed(CH_BRINK)) {
    if (getTracksRemaining() <= BRINK_TRACKS) {
      brinkTicks += 1;
      if (brinkTicks >= TICKS_PER_SECOND) {
        brinkTicks = 0;
        noteBrinkSecond();
      }
    } else {
      // Left the danger window: the streak has to be unbroken, so start over.
      brinkTicks = 0;
      resetBrinkSeconds();
    }
  }

  if (isChallengeArmed(CH_SOLO_TOOLS)) checkToolSharing();
}

export function initChallengeWatch(): void {
  onGlobalTick(() => tick());
}
