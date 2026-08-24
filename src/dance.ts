import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { DASH_ABILITY_ID } from './constants';
import { getHumanPlayers } from './util';

// Something for the other players to do while the host picks what to play.
//
// In the start lobby players 2-4 stand at the back as immobile peasants, and a
// keypress plays a different animation on each of the eight keys. Purely
// cosmetic: nothing here touches game state, and the lobby writes no save.
//
// Raw key events rather than spells. Spells worked, but not well: the engine
// drives the caster's animation for most of a second after the cast and
// overwrites anything a trigger sets inside that window, so a dance could only
// start 0.85s after the key went down -- far too late to feel like dancing
// (measured in game; 0.4s was still eaten). A key event is not a cast, so
// nothing fights us and the dance starts on the frame the key goes down.
//
// It also settles the eighth dance. Eight abilities never fit: the engine draws
// move, stop, hold, attack and patrol at fixed command-card slots, none of them
// can be removed ('Apat', 'Amov' and a bespoke unit type with no move type and
// no attacks were all tried in game), and it ignores the abilities' own button
// position fields. With no abilities involved there is no card to run out of.
//
// Transplanted from Villager 255 Animations by Graber (hiveworkshop.com) --
// see scripts/transplant-dance-anims.js. Indices, not names: WC3 plays a
// sequence by index, and these are ones the engine would never choose on its
// own, which is exactly why they have to be asked for explicitly.
//
//   Q Walk Victory - 1     I Attack - 7
//   W Death - 1            O Attack - 8
//   E Attack - 9           V Stand Hit - 4
//   R Stand Hit - 1        B Stand Victory - 17
//   Y Stand Hit - 5
//   U Attack - 6
//
// QWERYUIO puts the right hand one key over so a thumb falls on B, with the
// left thumb on V. P is avoided throughout: it issues a patrol order, and the
// keys being read raw does not stop that order going through.
//
// They are stored as "Dance One" .. "Dance Ten" in this same order -- see
// scripts/fix-dance-anims.js -- so the indices below are simply consecutive.
const DANCE_KEYS: ReadonlyArray<oskeytype> = [
  OSKEY_Q, OSKEY_W, OSKEY_E, OSKEY_R, OSKEY_Y,
  OSKEY_U, OSKEY_I, OSKEY_O, OSKEY_V, OSKEY_B,
];
const DANCE_SEQUENCES: ReadonlyArray<number> = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

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

/** Which dancer belongs to which player, so a keypress knows who to move. */
const dancers = new Map<number, unit>();

/** Park a peasant as a dancer: it cannot walk, and the eight keys move it.
 *  Move speed 0 so the engine simply never moves it -- which also stops the
 *  walk animation from overriding a dance. */
export function makeDancer(u: Unit): void {
  SetUnitMoveSpeed(u.handle, 0);
  dancers.set(u.owner.id, u.handle);
  // Take away everything a peasant normally carries. Two of the dance hotkeys
  // would otherwise be taken: give/take owns W and the dash owns E. A dancer
  // has nothing to give and nowhere to dash to, so the whole set goes.
  UnitRemoveAbility(u.handle, DASH_ABILITY_ID);
  UnitRemoveAbility(u.handle, FourCC(Abilities.Channel));
}

export function initDance(): void {
  for (const player of getHumanPlayers()) {
    for (let i = 0; i < DANCE_KEYS.length; i++) {
      const sequence = DANCE_SEQUENCES[i];
      const key = Trigger.create();
      // metaKey 0: no modifier, so shift-clicking around the lobby cannot
      // accidentally set eight people dancing.
      BlzTriggerRegisterPlayerKeyEvent(key.handle, player.handle, DANCE_KEYS[i], 0, true);
      key.addAction(() => {
        const h = dancers.get(GetPlayerId(GetTriggerPlayer()!));
        if (h == null || GetUnitTypeId(h) === 0) return;

        const wait = untilNextBeat();
        if (wait <= 0) { play(h, sequence); return; }
        // Land on the beat instead of on the keypress, so a room full of
        // dancers moves together however sloppily they hit the key.
        const beat = Timer.create();
        beat.start(wait, false, () => {
          beat.destroy();
          if (GetUnitTypeId(h) !== 0) play(h, sequence);
        });
      });
    }
  }
}
