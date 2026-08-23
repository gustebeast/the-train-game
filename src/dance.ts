import { Timer, Trigger, Unit } from 'w3ts';
import { DANCE_ABILITY_IDS, PEASANT_ID } from './constants';

// Something for the other players to do while the host picks what to play.
//
// In the starting lobby players 2-4 stand at the back as immobile peasants
// carrying these spells, each of which plays a different animation. Purely
// cosmetic: nothing here touches game state, and the lobby writes no save.
//
// PLACEHOLDER ANIMATIONS. The intent is to transplant proper dances out of the
// Villager 255 set the roll came from (scripts/transplant-roll-anim.js), but
// that source map is no longer on disk. Until it is back these point at
// sequences the peasant already owns, so the mechanism is real and only the
// choreography is standing in.
const DANCE_SEQUENCES: ReadonlyArray<number> = [
  2,  // 'Stand - 3'
  3,  // 'Stand - 4'
  9,  // 'Attack -2 '
  22, // 'Walk Alternate' (the roll)
];

/** Seconds per beat, 0 while no song is playing. Set this from the lobby track
 *  and every dance lands on the beat instead of whenever the button was hit. */
let beatPeriod = 0;
/** Runs from the moment the lobby music starts, so "how far into the song are
 *  we" is a subtraction rather than a running count. */
let songClock: Timer | null = null;

/** Start the beat grid. Call when the lobby track starts.
 *  bpm 0 (the default) means "no song", and dances fire immediately. */
export function startDanceClock(bpm: number): void {
  if (songClock != null) songClock.destroy();
  songClock = null;
  beatPeriod = bpm > 0 ? 60 / bpm : 0;
  if (beatPeriod <= 0) return;
  songClock = Timer.create();
  // Long one-shot used only as a stopwatch; nothing runs when it expires.
  songClock.start(3600, false, () => {});
}

export function stopDanceClock(): void {
  if (songClock != null) songClock.destroy();
  songClock = null;
  beatPeriod = 0;
}

/** How long until the next beat, or 0 when there is no song to sync to. */
function untilNextBeat(): number {
  if (beatPeriod <= 0 || songClock == null) return 0;
  const elapsed = songClock.elapsed;
  const into = elapsed - math.floor(elapsed / beatPeriod) * beatPeriod;
  return beatPeriod - into;
}

function play(h: unit, sequence: number): void {
  SetUnitAnimationByIndex(h, sequence);
  QueueUnitAnimation(h, 'stand');
}

/** Park a peasant as a dancer: it cannot walk, and its command card is the
 *  dance set. Move speed 0 rather than a movement lock so the engine simply
 *  never moves it -- which also stops the walk animation from overriding a
 *  dance, the way it did on the dashing peasant. */
export function makeDancer(u: Unit): void {
  SetUnitMoveSpeed(u.handle, 0);
  for (const id of DANCE_ABILITY_IDS) UnitAddAbility(u.handle, id);
}

export function initDance(): void {
  const cast = Trigger.create();
  cast.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  cast.addAction(() => {
    const abilityId = GetSpellAbilityId();
    let index = -1;
    for (let i = 0; i < DANCE_ABILITY_IDS.length; i++) {
      if (DANCE_ABILITY_IDS[i] === abilityId) { index = i; break; }
    }
    if (index < 0) return;
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    const h = u.handle;
    const sequence = DANCE_SEQUENCES[index];

    const wait = untilNextBeat();
    if (wait <= 0) { play(h, sequence); return; }
    // Land on the beat instead of on the keypress, so a room full of dancers
    // moves together however sloppily they hit the button.
    const beat = Timer.create();
    beat.start(wait, false, () => {
      beat.destroy();
      if (GetUnitTypeId(h) !== 0) play(h, sequence);
    });
  });
}
