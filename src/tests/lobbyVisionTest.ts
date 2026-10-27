import { registerTest, TestReporter } from './testKit';
import { Unit } from 'w3ts';
import { getNeutralExtra, getNeutralPassive, getTrainPlayer } from '../teams';
import { getHumanPlayers } from '../util';
import { beginNewRun, loadInterRoundLobby } from '../terrain/load';
import { purchaseSummonUpgrade } from '../summonUpgrade';
import { refreshInterRoundLobbyRoster, getRosterSpots } from '../interRoundLobbyRoster';
import { getInterRoundLobbyHeroUnits } from '../heroes';
import { getInterRoundLobbyMercUnits, buyMercContract, buySecondContract } from '../mercenary';
import { getTrain, getTrackWagon } from '../train';
import { placedTracks } from '../track/state';
import { worldToTile } from '../terrain/constants';

/**
 * Nothing standing in the inter-round lobby may hand the players vision.
 *
 * The roster (four heroes, two mercenaries), the parked train and its wagon,
 * and the track under them are all scenery: you look AT them, they should not
 * look FOR you. They were owned by neutral passive, which is in the humans'
 * vision group, so six heroes' worth of sight radius lit ground nobody had
 * walked -- vision the players had not earned and, in the lobby, could not
 * have been meant to have.
 *
 * The fix is ownership alone, so that is what this checks, on two axes:
 *
 *  - NOBODY on that floor is owned by a player who shares vision with a human.
 *    Asserted against the alliance state rather than against a hard-coded
 *    player id, so moving the roster to some third neutral player later still
 *    has to satisfy the actual property.
 *  - The roster is still VISIBLE. Taking vision away would be a bug of its own
 *    if it left you unable to see what you own, and what keeps the column lit
 *    is indirect -- the inner ring of water tiles, and your own peasants -- so
 *    it is worth holding to rather than assuming.
 *
 * The layout is asserted here too: one column on the east edge, three either
 * side of the centre line and nothing on it.
 */
function runLobbyVisionTest(t: TestReporter): void {
  beginNewRun();
  purchaseSummonUpgrade();
  loadInterRoundLobby();
  // Two DIFFERENT purchases: the second mercenary is its own contract, and
  // calling the first one twice quietly leaves you with one.
  t.expectTrue('firstContract', buyMercContract());
  t.expectTrue('secondContract', buySecondContract());
  refreshInterRoundLobbyRoster();

  const humans = getHumanPlayers();
  const extraId = GetPlayerId(getNeutralExtra().handle);
  t.report('neutralExtraId', extraId);

  // The control: the two players this test exists to keep the roster away from
  // really are vision-sharing, so "not owned by a sharer" means something.
  let sharers = 0;
  for (const p of humans) {
    if (GetPlayerAlliance(getNeutralPassive().handle, p.handle, ALLIANCE_SHARED_VISION)) sharers += 1;
    if (GetPlayerAlliance(getTrainPlayer().handle, p.handle, ALLIANCE_SHARED_VISION)) sharers += 1;
  }
  t.expect('controlSharersSeen', sharers, humans.length * 2);

  const heroes = getInterRoundLobbyHeroUnits();
  const mercs = getInterRoundLobbyMercUnits();
  t.expect('heroesStanding', heroes.length, 4);
  t.expect('mercsStanding', mercs.length, 2);

  const props: Unit[] = [];
  for (const h of heroes) props.push(h);
  for (const m of mercs) props.push(m);
  const engine = getTrain();
  const wagon = getTrackWagon();
  if (engine != null) props.push(engine);
  if (wagon != null) props.push(wagon);
  for (const tr of placedTracks) props.push(tr);
  t.report('propsChecked', props.length);

  // The property itself: no prop's owner shares vision with any human.
  let leaking = 0;
  let onExtra = 0;
  for (const u of props) {
    if (u.owner.id === extraId) onExtra += 1;
    for (const p of humans) {
      if (GetPlayerAlliance(u.owner.handle, p.handle, ALLIANCE_SHARED_VISION)) {
        leaking += 1;
        break;
      }
    }
  }
  t.expect('propsLeakingVision', leaking, 0);
  t.expect('propsOnNeutralExtra', onExtra, props.length);

  // Layout, asserted off the SPOT TABLE rather than off the units standing on
  // it: the shape is the thing being fixed, and it has to be right whether or
  // not every slot happens to be filled.
  const spots = getRosterSpots();
  const column = [...spots.mercs, ...spots.heroes];
  let offColumn = 0;
  let onCentreLine = 0;
  let north = 0;
  let south = 0;
  for (const sp of column) {
    if (worldToTile(sp.x) !== 4) offColumn += 1;
    const gy = worldToTile(sp.y);
    if (gy === 0) onCentreLine += 1;
    if (gy > 0) north += 1;
    if (gy < 0) south += 1;
  }
  t.expect('spotsInColumn', column.length, 6);
  t.expect('offColumn', offColumn, 0);
  t.expect('onCentreLine', onCentreLine, 0);
  t.expect('northOfCentre', north, 3);
  t.expect('southOfCentre', south, 3);
  t.expect('mercY0', worldToTile(spots.mercs[0].y), 3);
  t.expect('mercY1', worldToTile(spots.mercs[1].y), 2);
  t.expect('heroY0', worldToTile(spots.heroes[0].y), 1);
  t.expect('heroY1', worldToTile(spots.heroes[1].y), -1);
  t.expect('heroY2', worldToTile(spots.heroes[2].y), -2);
  t.expect('heroY3', worldToTile(spots.heroes[3].y), -3);

  // And the units really are standing on those spots.
  let offSpot = 0;
  for (const u of [...mercs, ...heroes]) {
    if (worldToTile(u.x) !== 4) offSpot += 1;
  }
  t.expect('unitsOffColumn', offSpot, 0);

  // Vision settles a moment after the units are placed, so look after a beat.
  t.after(2, () => {
    const me = humans[0].handle;
    let unseen = 0;
    for (const u of [...mercs, ...heroes]) {
      if (!IsVisibleToPlayer(u.x, u.y, me)) unseen += 1;
    }
    t.expect('rosterStillVisible', unseen, 0);
    t.done();
  });
}

registerTest('lobbyvision', runLobbyVisionTest);
