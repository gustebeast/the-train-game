import { Unit, Trigger } from 'w3ts';
import { TRACK_UNIT_TYPES } from './constants';
import { placedTracks, removeTrack } from './state';

function onTrackDestroyed() {
  const dying = Unit.fromHandle(GetTriggerUnit())!;

  const idx = placedTracks.findIndex(t => t.handle === dying.handle);
  if (idx > 0) {
    placedTracks[idx - 1].invulnerable = false;
  }

  removeTrack(dying);
  dying.destroy();
}

export function initTrackDestroyTrigger() {
  const trackFourCCs = TRACK_UNIT_TYPES.map(t => FourCC(t));
  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  trigger.addAction(() => {
    const dying = Unit.fromHandle(GetTriggerUnit());
    if (!dying) return;
    if (!trackFourCCs.includes(dying.typeId)) return;
    onTrackDestroyed();
  });
}
