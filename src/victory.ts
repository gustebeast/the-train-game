import { Unit } from 'w3ts';
import { setVictoryTriggered } from './track/state';
import { extinguish, getTrain, getTrackWagon } from './train';
import { clearChallenges } from './challenges';
import { cancelNightForVictory } from './daynight';
import { gameState, syncGold } from './state';
import { saveToFile } from './save';
import { rollCreepCamp } from './creeps';
import { chooseHeroes, chooseHeroPlayers, snapshotHeroItems } from './heroes';
import { bankCrateForNextRound } from './items';
import { snapshotMercKits } from './mercenary';
import { advanceChallengeOffer } from './challenges';

const GOLD_PER_ROUND = 1;

/** Called when the last track is placed on the victory tile. Prepares the train
 *  for its final run but does NOT award round rewards yet. */
export function triggerVictory(lastTrack: Unit): void {
  setVictoryTriggered();
  // The round is decided: no night should fall now, and if it is already night
  // the victory lap should not be run in the dark.
  cancelNightForVictory();
  lastTrack.invulnerable = true;
  extinguish();
  const train = getTrain();
  if (train != null) {
    BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
    train.moveSpeed = 200;
  }
  const wagon = getTrackWagon();
  if (wagon != null) wagon.moveSpeed = 200;
}

/** Called when the train actually reaches the end. Awards rewards and saves.
 *
 *  Everything the next lobby will show has to be settled BEFORE the save, so a
 *  reload resumes exactly what the live session goes on to see: the party's
 *  kit as it stands now (the heroes and mercenaries may still be on the
 *  field), and the dealer's next offer -- finishing a round is what counts as
 *  a new visit to him. Advancing it after the save let a reload show the
 *  previous offer, so a player could choose between two. */
export function awardVictory(): void {
  gameState.round += 1;
  gameState.gold += GOLD_PER_ROUND;
  // Spend any unpaid (lost) wagers so armed challenges never reach the save
  clearChallenges();
  syncGold();
  rollCreepCamp();
  chooseHeroes();
  chooseHeroPlayers();
  snapshotHeroItems();
  snapshotMercKits();
  advanceChallengeOffer();
  bankCrateForNextRound();
  saveToFile();
}
