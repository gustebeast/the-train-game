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

function play(h: unit, sequence: number): void {
  SetUnitAnimationByIndex(h, sequence);
  QueueUnitAnimation(h, 'stand');
}

/** The engine's patrol button, which it grants to anything that can move. Not
 *  in the peasant's ability list, so it cannot be taken away in object data. */
const PATROL_ABILITY_ID = FourCC('Apat');

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
  // Take away everything a peasant normally carries. Three of the dance hotkeys
  // would otherwise be taken: give/take owns W, the dash owns E, and the
  // engine's own patrol button owns P. A dancer has nothing to give, nowhere to
  // dash to and nothing to patrol, so the whole set goes -- and dropping patrol
  // also frees the command card slot the eighth dance needs.
  UnitRemoveAbility(u.handle, DASH_ABILITY_ID);
  UnitRemoveAbility(u.handle, FourCC(Abilities.Channel));
  UnitRemoveAbility(u.handle, PATROL_ABILITY_ID);
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
