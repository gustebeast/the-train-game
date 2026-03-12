import { Unit, Trigger } from 'w3ts';
import {
  SKINS, OPPOSITE, TRACK_UNIT_TYPES, DIRECTIONS, TRACK_SIZE,
  Direction, toOrientationKey,
} from './constants';
import { reskinTrack, replaceTrack } from './helpers';
import { placedTracks } from './state';
import { log } from '../debug';

function getDirection(from: Unit, to: Unit): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'E' : 'W';
  } else {
    return dy >= 0 ? 'N' : 'S';
  }
}

function onTrackBuilt() {
  const track0 = Unit.fromHandle(GetConstructedStructure())!;

  if (placedTracks.length < 2) {
    track0.destroy();
    print("Can't build there — not enough track laid.");
    return;
  }

  const track1Idx = placedTracks.length - 1;
  const track1 = placedTracks[track1Idx];
  const track2 = placedTracks[track1Idx - 1];

  // Validate track0 is exactly one TRACK_SIZE away in a cardinal direction
  // WC3 building grid is 64 units, so we need tight tolerances to reject half-grid placements
  const dx = Math.abs(track0.x - track1.x);
  const dy = Math.abs(track0.y - track1.y);
  const tolerance = TRACK_SIZE * 0.25;
  const isValidCardinal =
    (dx > TRACK_SIZE - tolerance && dx < TRACK_SIZE + tolerance && dy < tolerance) ||
    (dy > TRACK_SIZE - tolerance && dy < TRACK_SIZE + tolerance && dx < tolerance);
  if (!isValidCardinal) {
    track0.destroy();
    print("Can't build there — must be adjacent to the last track piece.");
    return;
  }

  const dirToTrack1 = getDirection(track0, track1);
  const dirFromTrack1ToTrack0 = OPPOSITE[dirToTrack1];
  const dirToTrack2 = getDirection(track1, track2);

  // Snap track0 to the correct grid position relative to track1
  const [snapDx, snapDy] = DIRECTIONS[dirFromTrack1ToTrack0];
  const snapX = track1.x + snapDx;
  const snapY = track1.y + snapDy;

  // Update track1's skin now that we know both its neighbors
  const orientationKey1 = toOrientationKey(dirFromTrack1ToTrack0, dirToTrack2);
  const type1 = SKINS[orientationKey1] ?? SKINS.EW;
  reskinTrack(track1, type1);
  track1.invulnerable = true;

  // Replace track0 (Farm/solid) with a ScoutTower (walkable) at the snap position
  const orientationKey0 = toOrientationKey(dirToTrack1, OPPOSITE[dirToTrack1]);
  const type0 = SKINS[orientationKey0] ?? SKINS.EW;
  placedTracks.push(replaceTrack(track0, type0, snapX, snapY));
}

export function initTrackBuildTrigger() {
  const trackFourCCs = TRACK_UNIT_TYPES.map(t => FourCC(t));
  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_CONSTRUCT_FINISH);
  trigger.addAction(() => {
    const built = Unit.fromHandle(GetConstructedStructure());
    if (!built) return;
    if (!trackFourCCs.includes(built.typeId)) return;
    onTrackBuilt();
  });
}
