import { Unit } from 'w3ts';
import { setVictoryTriggered } from './track/state';
import { extinguish, getTrain } from './train';
import { gameState } from './state';
import { saveToFile } from './save';

export function triggerVictory(lastTrack: Unit): void {
  setVictoryTriggered();
  lastTrack.invulnerable = true;
  extinguish();
  const train = getTrain();
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
  train.moveSpeed = 200;

  gameState.round += 1;
  saveToFile();
}
