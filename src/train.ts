import { Unit, Trigger } from 'w3ts';
import { placedTracks } from './track/state';

let train: Unit;
let targetIdx = 0;

function moveToNext() {
  const next = placedTracks[targetIdx + 1];
  if (next) {
    train.issueOrderAt('move', next.x, next.y);
    targetIdx++;
  }
}

export function initTrain(trainUnit: Unit) {
  train = trainUnit;

  const trigger = Trigger.create();
  trigger.registerUnitEvent(train, EVENT_UNIT_ISSUED_ORDER);
  trigger.addCondition(() => GetIssuedOrderId() === OrderId('stop'));
  trigger.addAction(() => moveToNext());

  moveToNext();
}
