import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { DANCE_ABILITY_IDS, DASH_ABILITY_ID, PEASANT_ID } from './constants';

// Something for the other players to do while the host picks what to play.
//
// In the start lobby players 2-4 stand at the back as immobile peasants
// carrying these spells, each of which plays a different animation. Purely
// cosmetic: nothing here touches game state, and the lobby writes no save.
//
// Transplanted from Villager 255 Animations by Graber (hiveworkshop.com) --
// see scripts/transplant-dance-anims.js. Indices, not names: WC3 plays a
// sequence by index, and these are ones the engine would never choose on its
// own, which is exactly why they have to be asked for explicitly.
//
//   Q Walk Victory - 1     U Attack Morph - 26
//   W Attack Morph - 16    I Attack - 6
//   E Attack - 9           O Attack - 7
//   R Attack Morph - 20    P Attack - 8
//
// They are stored as "Dance One" .. "Dance Eight" -- see fix-dance-anims.js.
// Only seven fit on the command card; the eighth has nowhere to go while the
// engine's own five buttons hold their slots (compiletime.ts has the detail).
const DANCE_SEQUENCES: ReadonlyArray<number> = [
  23, // Q  Walk Victory - 1
  24, // W  Attack Morph - 16
  30, // E  Attack - 9
  25, // R  Attack Morph - 20
  26, // U  Attack Morph - 26
  27, // I  Attack - 6
  28, // O  Attack - 7
  29, // P  Attack - 8
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

/** How long after a cast lands before the dance can be set.
 *
 *  The engine drives the caster's own animation for most of a second after
 *  SPELL_EFFECT and overwrites anything a trigger sets inside that window --
 *  which is why a pressed dance looked like it snapped straight back to
 *  standing. Measured in game: 0.0s, 0.2s and 0.4s are all eaten; 0.8s and
 *  later hold, and every dance then plays.
 *
 *  Things that did NOT shorten it, so they are not worth trying again: zeroing
 *  the unit's cast point and backswing (already 0 in object data), and naming
 *  the sequence in the ability's Art - Animation Names field. */
const CAST_ANIM_HOLD = 0.85;

function play(h: unit, sequence: number): void {
  Timer.create().start(CAST_ANIM_HOLD, false, () => {
    if (GetUnitTypeId(h) === 0) return;
    SetUnitAnimationByIndex(h, sequence);
    QueueUnitAnimation(h, 'stand');
  });
}

/** Dancers keep their normal move speed for now.
 *
 *  They were parked at 0 so the engine would simply never move them, but a
 *  dance pressed at that speed snapped straight back to standing. Move speed is
 *  the suspect: WC3 scales a unit's animation playback with how fast it is
 *  travelling, and at a standstill that scale may be collapsing the dance to
 *  nothing. Normal speed tells us whether that is really what is happening --
 *  if the dances play now, the fix is a time scale rather than a speed. */
const DANCE_MOVE_SPEED = 190;

/** Park a peasant as a dancer: its command card is the dance set. */
export function makeDancer(u: Unit): void {
  SetUnitMoveSpeed(u.handle, DANCE_MOVE_SPEED);
  // Take away everything a peasant normally carries. Two of the dance hotkeys
  // would otherwise be taken: give/take owns W and the dash owns E. A dancer
  // has nothing to give and nowhere to dash to, so the whole set goes.
  UnitRemoveAbility(u.handle, DASH_ABILITY_ID);
  UnitRemoveAbility(u.handle, FourCC(Abilities.Channel));
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
