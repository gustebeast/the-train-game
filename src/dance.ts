import { isSelectedBy } from './selection';
import { Timer, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { DASH_ABILITY_ID } from './constants';
import { getHumanPlayers, unitExists } from './util';

// Something for the other players to do while the host picks what to play.
//
// In the start lobby players 2-4 stand at the back as immobile peasants, and a
// keypress plays a different animation on each of the ten keys. Purely
// cosmetic: nothing here touches game state, and the lobby writes no save.
//
// Raw key events rather than spells. Spells worked, but not well: the engine
// drives the caster's animation for most of a second after the cast and
// overwrites anything a trigger sets inside that window, so a dance could only
// start 0.85s after the key went down -- far too late to feel like dancing
// (measured in game; 0.4s was still eaten). A key event is not a cast, so
// nothing fights us and the dance starts on the frame the key goes down.
//
// It also settled how many dances fit. Eight abilities never did: the engine draws
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
//   W Stand Hit - 1        O Stand Hit - 5
//   E Attack Morph - 31    V Stand Hit - 4
//   R Attack - 9           B Stand Victory - 17
//   Y Attack - 8
//   U Attack - 6
//
// QWERYUIO puts the right hand one key over so a thumb falls on B, with the
// left thumb on V. P is avoided throughout: it issues a patrol order, and the
// keys being read raw does not stop that order going through.
//
// The model stores them as "Dance One" .. "Dance Ten" in the order
// scripts/fix-dance-anims.js appends them, which is the order they were first
// chosen in rather than the order the keys are in now. Which key plays which is
// this table's business alone, so moving a dance to another key is a swap here
// and nothing else -- the model, its sequence indices and the retimes keyed to
// its names all stay put. Attack Morph - 31 is the one retimed 15% faster, and
// it keeps that wherever it is played from.
const DANCES: ReadonlyArray<{ key: oskeytype; sequence: number }> = [
  { key: OSKEY_Q, sequence: 23 },
  { key: OSKEY_W, sequence: 26 },
  { key: OSKEY_E, sequence: 24 },
  { key: OSKEY_R, sequence: 25 },
  { key: OSKEY_Y, sequence: 30 },
  { key: OSKEY_U, sequence: 28 },
  { key: OSKEY_I, sequence: 29 },
  { key: OSKEY_O, sequence: 27 },
  { key: OSKEY_V, sequence: 31 },
  { key: OSKEY_B, sequence: 32 },
];

/** Seconds per beat, 0 while no song is playing. Set this from the lobby track
 *  and every dance lands on the beat instead of whenever the button was hit. */
let beatPeriod = 0;
/** Runs from the moment the lobby music starts, so "how far into the song are
 *  we" is a subtraction rather than a running count. */
let songClock: Timer | null = null;

/** A fresh start lobby: forget the last lobby's dancers (their units went
 *  with that board, and a recycled handle must not dance for them) and start
 *  the beat grid. bpm 0 means "no song", and dances fire immediately. */
export function startDanceSession(bpm: number): void {
  dancers.clear();
  if (songClock != null) songClock.destroy();
  songClock = null;
  beatPeriod = bpm > 0 ? 60 / bpm : 0;
  if (beatPeriod <= 0) return;
  // untracked: a stopwatch that never fires; the session replaces it.
  songClock = Timer.create();
  // Long one-shot used only as a stopwatch; nothing runs when it expires.
  songClock.start(3600, false, () => {});
}

/** How long until the next beat, or 0 when there is no song to sync to. */
function untilNextBeat(): number {
  if (beatPeriod <= 0 || songClock == null) return 0;
  const elapsed = songClock.elapsed;
  const into = elapsed - Math.floor(elapsed / beatPeriod) * beatPeriod;
  return beatPeriod - into;
}

function play(h: unit, sequence: number): void {
  SetUnitAnimationByIndex(h, sequence);
  QueueUnitAnimation(h, 'stand');
}

/** Which dancer belongs to which player, so a keypress knows who to move. */
const dancers = new Map<number, unit>();

/** Park a peasant as a dancer: it cannot walk, and the dance keys move it.
 *  Move speed 0 so the engine simply never moves it -- which also stops the
 *  walk animation from overriding a dance. */
export function makeDancer(u: Unit): void {
  SetUnitMoveSpeed(u.handle, 0);
  // Per instance, not per unit type, so the peasants still working elsewhere in
  // the map keep their own name. Nothing else about the unit says it dances --
  // the keys are read raw, so there are no command-card buttons to hint at it.
  u.name = 'Dancer';
  dancers.set(u.owner.id, u.handle);
  // Take away everything a peasant normally carries. Two of the dance hotkeys
  // would otherwise be taken: give/take owns W and the dash owns E. A dancer
  // has nothing to give and nowhere to dash to, so the whole set goes.
  UnitRemoveAbility(u.handle, DASH_ABILITY_ID);
  UnitRemoveAbility(u.handle, FourCC(Abilities.Channel));
}

export function initDance(): void {
  for (const player of getHumanPlayers()) {
    for (const { key, sequence } of DANCES) {
      const trigger = Trigger.create();
      // metaKey 0: no modifier, so shift-clicking around the lobby cannot
      // accidentally set the whole room dancing.
      BlzTriggerRegisterPlayerKeyEvent(trigger.handle, player.handle, key, 0, true);
      trigger.addAction(() => {
        const caster = GetTriggerPlayer()!;
        const h = dancers.get(GetPlayerId(caster));
        if (h == null || !unitExists(h)) return;
        // Only while the player has the dancer selected. These are ten plain
        // letter keys with no modifier, and a key event fires wherever the
        // player's attention is -- so without this, anyone reading the lobby or
        // clicking around the map sets their peasant off by accident. The synced
        // record, not IsUnitSelected (see selection.ts).
        if (!isSelectedBy(h, GetPlayerId(caster))) return;

        const wait = untilNextBeat();
        if (wait <= 0) { play(h, sequence); return; }
        // Land on the beat instead of on the keypress, so a room full of
        // dancers moves together however sloppily they hit the key.
        // untracked: a fraction of a second, and harmless if the unit is gone.
        const beat = Timer.create();
        beat.start(wait, false, () => {
          beat.destroy();
          if (unitExists(h)) play(h, sequence);
        });
      });
    }
  }
}
