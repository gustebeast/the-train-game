import { Item, Unit, Trigger } from 'w3ts';
import { TRACK_UNIT_TYPES } from './constants';
import { placedTracks, removeTrack } from './state';
import { getTrainTarget } from '../train';
import { TRACK_PIECE_ID } from '../items';

function onTrackDestroyed() {
  const dying = Unit.fromHandle(GetTriggerUnit())!;

  const idx = placedTracks.findIndex(t => t.handle === dying.handle);
  if (idx > 0) {
    const prev = placedTracks[idx - 1];
    const trainTarget = getTrainTarget();
    if (trainTarget == null || prev.handle !== trainTarget.handle) {
      prev.invulnerable = false;
    }
  }

  const x = dying.x;
  const y = dying.y;
  removeTrack(dying);
  dying.destroy();
  const dropped = Item.create(TRACK_PIECE_ID, x, y);
  if (dropped != null) dropped.charges = 1;
}

export function initTrackDestroyTrigger() {
  const trackFourCCs = TRACK_UNIT_TYPES.map(t => FourCC(t));
  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  trigger.addAction(() => {
    const dying = Unit.fromHandle(GetTriggerUnit());
    if (dying == null) return;
    if (!trackFourCCs.includes(dying.typeId)) return;
    onTrackDestroyed();
  });
}
