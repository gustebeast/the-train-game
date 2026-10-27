import { Trigger } from 'w3ts';
import { onGlobalTick, TICK_INTERVAL } from './globalTick';
import { isInGameplay } from './state';
import { isChallengeArmed } from './challenges';
import {
  CH_BRINK, CH_SOLO_TOOLS, BRINK_TRACKS,
  noteBrinkTime, resetBrinkTime, noteToolSharingBroken, playersHaveLaidTrack,
} from './challengeList';
import { getTracksRemaining } from './train';
import { AXE_ID, PICKAXE_ID, BUCKET_ID, BUCKET_FULL_ID } from './constants';
import { forEachInventoryItem, forEachUnitInWorld, nextFrame } from './util';

/**
 * The two challenges nobody else can report on.
 *
 * Everything else is completed by the system that owns the event — a track
 * being laid, a dash cast, the last creep dying.
 *
 * Living Dangerously counts SECONDS spent near the end of the line, so it rides
 * the shared global tick.
 *
 * Union Rules does not need to. Two units can only come to hold the same tool
 * at the moment one of them GAINS one: dropping a tool or dying can only
 * reduce sharing, never create it. So it is checked on item pickup -- which
 * covers a ground pickup, a hand-off between units, and script UnitAddItem.
 * The one other way in is arming it mid-round (the -challenge cheat), with
 * tools already in hand; that path checks once itself. A wager bought in the
 * lobby needs nothing: rounds start with every tool on the ground.
 */

/** A full bucket and an empty one are the same tool for this purpose -- passing
 *  a bucket around by filling it would otherwise dodge the restriction. */
function toolKey(itemTypeId: number): number | null {
  if (itemTypeId === AXE_ID) return AXE_ID;
  if (itemTypeId === PICKAXE_ID) return PICKAXE_ID;
  if (itemTypeId === BUCKET_ID || itemTypeId === BUCKET_FULL_ID) return BUCKET_ID;
  return null;
}

/** Look at the world for two units holding the same tool type. Once broken it
 *  stays broken for the round, so a caller can stop asking. */
function checkToolSharing(): void {
  const seen: number[] = [];
  let broken = false;
  forEachUnitInWorld(u => {
    if (broken) return;
    const held: number[] = [];
    forEachInventoryItem(u, item => {
      const key = toolKey(GetItemTypeId(item));
      // Two of the same tool on ONE unit is still one holder, so only count a
      // given tool type once per unit.
      if (key != null && !held.includes(key)) held.push(key);
    });
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
    if (playersHaveLaidTrack() && getTracksRemaining() <= BRINK_TRACKS) {
      noteBrinkTime(TICK_INTERVAL);
    } else {
      // Left the danger window: the streak has to be unbroken, so start over.
      resetBrinkTime();
    }
  }
}

/** Check Union Rules now, if it is in play. */
export function checkUnionRules(): void {
  if (!isInGameplay() || !isChallengeArmed(CH_SOLO_TOOLS)) return;
  checkToolSharing();
}

export function initChallengeWatch(): void {
  onGlobalTick(() => tick());

  const pickup = Trigger.create();
  pickup.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickup.addAction(() => {
    if (toolKey(GetItemTypeId(GetManipulatedItem()!)) == null) return;
    // A frame later, so a give/take that removes from one unit and adds to
    // another has finished both halves before the inventories are read.
    nextFrame(() => checkUnionRules());
  });
}
