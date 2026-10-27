import { Timer, Trigger } from 'w3ts';
import { isInGameplay } from './state';
import { createTimer, destroyTimer } from './timers';
import { onLineChanged } from './track/state';
import { isChallengeArmed, onArmedChallengeChanged } from './challenges';
import {
  CH_BRINK, CH_SOLO_TOOLS, BRINK_TRACKS,
  noteBrinkTime, resetBrinkTime, noteToolSharingBroken, playersHaveLaidTrack,
} from './challengeList';
import { getTracksRemaining } from './train';
import { toolKind } from './itemRules';
import { forEachInventoryItem, forEachUnitInWorld, nextFrame } from './util';

/**
 * The two challenges nobody else can report on.
 *
 * Everything else is completed by the system that owns the event — a track
 * being laid, a dash cast, the last creep dying.
 *
 * Living Dangerously counts SECONDS spent near the end of the line. Whether the
 * train is near the end only changes when the line or the train moves, so it
 * is judged then (onLineChanged), and a clock counts the seconds only while
 * the train is inside the window.
 *
 * Union Rules does not need to. Two units can only come to hold the same tool
 * at the moment one of them GAINS one: dropping a tool or dying can only
 * reduce sharing, never create it. So it is checked on item pickup -- which
 * covers a ground pickup, a hand-off between units, and script UnitAddItem.
 * The one other way in is arming it mid-round (the -challenge cheat), with
 * tools already in hand; that path checks once itself. A wager bought in the
 * lobby needs nothing: rounds start with every tool on the ground.
 */

/** Look at the world for two units holding the same tool type. Once broken it
 *  stays broken for the round, so a caller can stop asking. */
function checkToolSharing(): void {
  const seen: number[] = [];
  let broken = false;
  forEachUnitInWorld(u => {
    if (broken) return;
    const held: number[] = [];
    forEachInventoryItem(u, item => {
      const key = toolKind(GetItemTypeId(item));
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

/** Counting while the train is inside Living Dangerously's window, else null. */
let brinkClock: Timer | null = null;

function inBrinkWindow(): boolean {
  return isInGameplay() && isChallengeArmed(CH_BRINK)
    && playersHaveLaidTrack() && getTracksRemaining() <= BRINK_TRACKS;
}

/** Judge Living Dangerously against the line as it now stands. Entering the
 *  window starts the clock; leaving it stops the clock and starts the streak
 *  over, since the time has to be unbroken. A tracked timer: the board
 *  teardown takes it, and clearing the line (onLineChanged) forgets it. */
function updateBrink(): void {
  const inside = inBrinkWindow();
  if (inside && brinkClock == null) {
    brinkClock = createTimer();
    // periodic: the streak's seconds, counted up on the board as they pass.
    brinkClock.start(1, true, () => noteBrinkTime(1));
  } else if (!inside && brinkClock != null) {
    destroyTimer(brinkClock);
    brinkClock = null;
    resetBrinkTime();
  }
}

/** Check Union Rules now, if it is in play. Arming it mid-round (the
 *  -challenge cheat) calls this, since tools may already be in hand. */
export function checkUnionRules(): void {
  if (!isInGameplay() || !isChallengeArmed(CH_SOLO_TOOLS)) return;
  checkToolSharing();
}

export function initChallengeWatch(): void {
  onLineChanged(() => updateBrink());
  // Paid, spent or armed mid-round: the clock starts or stops with it.
  onArmedChallengeChanged(() => updateBrink());

  const pickup = Trigger.create();
  pickup.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PICKUP_ITEM);
  pickup.addAction(() => {
    if (toolKind(GetItemTypeId(GetManipulatedItem()!)) == null) return;
    // A frame later, so a give/take that removes from one unit and adds to
    // another has finished both halves before the inventories are read.
    nextFrame(() => checkUnionRules());
  });
}
