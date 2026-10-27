import { Item, Unit, Trigger } from 'w3ts';
import { nextFrame, onSpellEffect } from '../util';
import {
  skinFor, OPPOSITE, TRACK_UNIT_TYPES, DIRECTIONS, TRACK_SIZE,
  Direction, toOrientationKey,
} from './constants';
import { reskinTrack, replaceTrack } from './helpers';
import {
  placedTracks, noteLineChanged, isVictoryTriggered, getVictoryTile, getBossVictoryTile, markBossVictory,
} from './state';
import { spendCharge, refreshCarrierNextFrame } from '../items';
import { TRACK_PIECE_ID, BUILD_TRACK_ABILITY_ID } from '../constants';
import { noteTrackPlaced } from '../train';
import { triggerVictory } from '../victory';
import { recountTrackShapes, noteFinalTrackPlaced } from '../challengeList';

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
  if (isVictoryTriggered()) return false;
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
  nextFrame(() => {
    // Two pieces started in the same frame both passed the check against the
    // same last piece. Whichever lands second would fork the line, so it is
    // undone and its track piece (already spent) dropped back where it stood.
    if (placedTracks[placedTracks.length - 1] !== track1) {
      const x = track0.x;
      const y = track0.y;
      track0.destroy();
      const refund = Item.create(TRACK_PIECE_ID, x, y);
      if (refund != null) refund.charges = 1;
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
    const type1 = skinFor(orientationKey1);
    reskinTrack(track1, type1);
    track1.invulnerable = true;

    // Replace track0 (Farm/solid) with a ScoutTower (walkable) at the snap position
    const orientationKey0 = toOrientationKey(dirToTrack1, OPPOSITE[dirToTrack1]);
    const type0 = skinFor(orientationKey0);
    const newTrack = replaceTrack(track0, type0, snapX, snapY);
    placedTracks.push(newTrack);
    // The line has changed shape: the piece before this one has just gained its
    // second neighbour, so its shape is now decided. Re-measure the whole line
    // rather than crediting that one piece -- see computeTrackShapes.
    recountTrackShapes();
    noteTrackPlaced();
    noteLineChanged();
    // Either exit finishes the line. The boss exit is only ever present in a
    // round that can reach the boss, and it is remembered here rather than
    // re-derived on arrival, because the terrain is gone by then.
    const bossTile = getBossVictoryTile();
    if (bossTile != null && snapX === bossTile.x && snapY === bossTile.y) {
      markBossVictory();
      noteFinalTrackPlaced();
      triggerVictory(newTrack);
      return;
    }
    const victoryTile = getVictoryTile();
    if (snapX === victoryTile.x && snapY === victoryTile.y) {
      // Round-long challenges are judged here, when the line is finished --
      // not when the train finally arrives.
      noteFinalTrackPlaced();
      triggerVictory(newTrack);
    }
  });
}

export function initTrackBuildTrigger() {
  const trackFourCCs = TRACK_UNIT_TYPES.map(t => FourCC(t));

  // SPELL_EFFECT fires right before CONSTRUCT_START and gives us the peasant
  onSpellEffect(BUILD_TRACK_ABILITY_ID, u => {
    // Only consume a track piece if the placement is valid
    if (!isValidPlacement(GetSpellTargetX(), GetSpellTargetY())) return;
    // Deferred: spending the last piece revokes this very ability, and doing
    // that inside its own spell effect can cancel the build -- the piece gone
    // and no track laid.
    if (spendCharge(u, TRACK_PIECE_ID)) refreshCarrierNextFrame(u.handle);
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
