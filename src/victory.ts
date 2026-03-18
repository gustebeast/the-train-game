import { Unit } from 'w3ts';
import { setVictoryTriggered } from './track/state';
import { extinguish, getTrain } from './train';

export function triggerVictory(lastTrack: Unit): void {
  setVictoryTriggered();
  lastTrack.invulnerable = true;
  extinguish();
  const train = getTrain();
  BlzSetUnitRealField(train.handle, UNIT_RF_HIT_POINTS_REGENERATION_RATE, 0);
  train.moveSpeed = 200;
}
