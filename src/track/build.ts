import { Unit, Trigger, Timer } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import {
  SKINS, OPPOSITE, TRACK_UNIT_TYPES, DIRECTIONS, TRACK_SIZE,
  Direction, toOrientationKey,
} from './constants';
import { reskinTrack, replaceTrack } from './helpers';
import { placedTracks } from './state';
import { TRACK_PIECE_ID, findItemByType, updateBuildAbility } from '../items';
import { onTrackPlaced } from '../train';

const BUILD_ABILITY_ID = FourCC(Abilities.BuildTinyFarm);


function getDirection(from: Unit, to: Unit): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'E' : 'W';
  } else {
    return dy >= 0 ? 'N' : 'S';
  }
}

function isValidPlacement(x: number, y: number): boolean {
  if (placedTracks.length < 2) return false;
  const track1 = placedTracks[placedTracks.length - 1];
  const dx = Math.abs(x - track1.x);
  const dy = Math.abs(y - track1.y);
  const tolerance = TRACK_SIZE * 0.25;
  return (dx > TRACK_SIZE - tolerance && dx < TRACK_SIZE + tolerance && dy < tolerance) ||
         (dy > TRACK_SIZE - tolerance && dy < TRACK_SIZE + tolerance && dx < tolerance);
}

function onTrackBuilt() {
  const track0 = Unit.fromHandle(GetConstructingStructure())!;

  if (!isValidPlacement(track0.x, track0.y)) {
    track0.destroy();
    if (placedTracks.length < 2) {
      print("Can't build there — not enough track laid.");
    } else {
      print("Can't build there — must be adjacent to the last track piece.");
    }
    return;
  }

  const track1Idx = placedTracks.length - 1;
  const track1 = placedTracks[track1Idx];
  const track2 = placedTracks[track1Idx - 1];

  // Delay replacement so the solid-pathing Farm has time to push the builder away
  const t = Timer.create();
  t.start(0, false, () => {
    t.destroy();

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
    onTrackPlaced();
  });
}

export function initTrackBuildTrigger() {
  const trackFourCCs = TRACK_UNIT_TYPES.map(t => FourCC(t));

  // SPELL_EFFECT fires right before CONSTRUCT_START and gives us the peasant
  const spellTrigger = Trigger.create();
  spellTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  spellTrigger.addAction(() => {
    if (GetSpellAbilityId() !== BUILD_ABILITY_ID) return;
    const u = Unit.fromHandle(GetTriggerUnit());
    if (u == null) return;

    // Only consume a track piece if the placement is valid
    if (!isValidPlacement(GetSpellTargetX(), GetSpellTargetY())) return;

    const trackItem = findItemByType(u, TRACK_PIECE_ID);
    if (trackItem != null) {
      trackItem.charges -= 1;
      if (trackItem.charges <= 0) {
        RemoveItem(trackItem.handle);
      }
      updateBuildAbility(u);
    }
  });

  const trigger = Trigger.create();
  trigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_CONSTRUCT_START);
  trigger.addAction(() => {
    const building = Unit.fromHandle(GetConstructingStructure());
    if (building == null) return;
    if (!trackFourCCs.includes(building.typeId)) return;
    onTrackBuilt();
  });
}
