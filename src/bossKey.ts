import { Timer, Trigger } from 'w3ts';
import { BOSS_KEY_ITEM_ID, PEASANT_ID } from './constants';
import { getSpawnedHeroes } from './heroes';
import { getLivingMercCount } from './mercenary';
import { isAlive } from './util';

/**
 * The Strange Key: the way in to the final boss.
 *
 * A level 3 creep camp cleared without losing anybody drops it where the cage
 * stood. Nothing else produces one, and only one exists at a time.
 *
 * "Without losing anybody" is DERIVED rather than counted: at the moment the
 * last creep falls, every hero that was summoned is still alive and both
 * mercenaries are still alive. A counter of deaths would have to be reset at
 * exactly the right moment and would miss a mercenary removed rather than
 * killed; asking the world costs nothing and cannot drift.
 *
 * Two living mercenaries is not an extra condition, it is the same one seen
 * from the other side: camp level is 1 + living mercenaries, so a level 3 camp
 * can only be on the board while both are alive, and one dying mid-fight is
 * exactly what this has to catch.
 *
 * The world can only be asked about the units still in it, though. Once every
 * hero falls the party is torn down -- the hero list emptied, the mercenaries
 * removed rather than killed -- and a re-summoned party would look flawless.
 * So a death during a key fight is also noted as it happens, and that note is
 * what plays the failure sound: you hear the key slip away the moment it does,
 * not only when the camp finally falls and nothing drops.
 */

/** The camp level that can drop the key. */
const KEY_CAMP_LEVEL = 3;
/** Mercenaries that must still be standing -- see the note above. */
const MERCS_REQUIRED = 2;
/** Played where the cage stood, so the drop is not something you can miss. */
const DROP_EFFECT = 'Abilities\\Spells\\Items\\AIlm\\AIlmTarget.mdl';
/** How long the effect is left on screen before it is cleaned up. */
const EFFECT_SECONDS = 3.0;

/** Set once the key has been produced this round, so a camp cannot somehow
 *  yield two. Cleared when the round is set up again. */
let keyDropped = false;
/** Level of the camp being fought right now, from the cage breaking until the
 *  last creep falls; 0 while no fight is on. */
let fightCampLevel = 0;
/** A hero or mercenary has died during this key fight. */
let partyLost = false;

export function resetBossKey(): void {
  keyDropped = false;
  fightCampLevel = 0;
  partyLost = false;
}

/** Called when a cage breaks and its camp comes out to fight. */
export function onCampFightStarted(campLevel: number): void {
  fightCampLevel = campLevel;
  partyLost = false;
}

/** Whether a fight that could still earn the key is under way. */
function keyFightOn(): boolean {
  return !keyDropped && !partyLost && fightCampLevel >= KEY_CAMP_LEVEL;
}

/** A hero or mercenary: owned by a human and neither a peasant nor something
 *  conjured. Outside hero mode humans own nothing but peasants (see heroes.ts),
 *  so the owner and type alone pick out the party. */
function isPartyMember(u: unit): boolean {
  if (GetPlayerController(GetOwningPlayer(u)) !== MAP_CONTROL_USER) return false;
  if (GetUnitTypeId(u) === PEASANT_ID) return false;
  if (IsUnitType(u, UNIT_TYPE_SUMMONED)) return false;
  return !IsUnitIllusion(u);
}

export function initBossKey(): void {
  const onDeath = Trigger.create();
  onDeath.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  onDeath.addAction(() => {
    if (!keyFightOn()) return;
    if (!isPartyMember(GetTriggerUnit()!)) return;
    partyLost = true;
    // Blizzard's own quest-failed sting, created by the engine at startup
    if (bj_questFailedSound != null) StartSound(bj_questFailedSound);
  });
}

/** Every summoned hero still standing? */
function allHeroesAlive(): boolean {
  for (const hero of getSpawnedHeroes()) {
    if (!isAlive(hero.handle)) return false;
  }
  return true;
}

/** Whether this camp clear has earned the key. Public so the caller can say
 *  why nothing dropped, and so it can be exercised on its own. */
function campClearEarnsKey(campLevel: number): boolean {
  if (keyDropped) return false;
  if (partyLost) return false;
  if (campLevel < KEY_CAMP_LEVEL) return false;
  if (getLivingMercCount() < MERCS_REQUIRED) return false;
  return allHeroesAlive();
}

/** Called when the last creep of a camp dies, with the cage's position.
 *
 *  The camp's level is passed in rather than read back from creeps.ts, which
 *  imports this module -- the pair would otherwise require each other. */
export function onCampCleared(x: number, y: number, campLevel: number): void {
  fightCampLevel = 0;
  if (!campClearEarnsKey(campLevel)) return;
  keyDropped = true;

  const effect = AddSpecialEffect(DROP_EFFECT, x, y);
  if (effect != null) {
    const cleanup = Timer.create();
    cleanup.start(EFFECT_SECONDS, false, () => {
      cleanup.destroy();
      DestroyEffect(effect);
    });
  }
  CreateItem(BOSS_KEY_ITEM_ID, x, y);
}
