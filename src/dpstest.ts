import { registerTest, TestReporter } from './testkit';
import {
  dpsTestStatus, forceLevel3Camp, getCampData, restartDPSTest, measureFieldedForce,
  cancelDPSTest, checkPlayerUnitCount,
} from './creeps';
import { spawnHeroes } from './heroes';
import { spawnMercWithHeroes } from './mercenary';
import { Players } from 'w3ts/globals';
import { buyMercContract, hasActiveMerc } from './mercenary';
import { getDPSCheckPlayer, toggleDPSVision } from './teams';
import { getHumanPlayers } from './util';
import { loadInterRoundLobby, beginNewRun } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';
import { hasHeroes, getChosenHeroCount, revertHeroesToInterRoundLobbySnapshot } from './heroes';
import { revertToInterRoundLobbySnapshot } from './save';

/** Record a measurement AND hold it to an expected value, so a number nobody
 *  checks cannot drift. */
function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

/** The DPS test itself, under test.
 *
 *  The game's DPS test is the sparring match the inter-round lobby runs against
 *  the next camp: heroes and creeps both rigged so neither can die, damage
 *  measured both ways for 30 seconds, and the result is what scales the next
 *  round's camp. Nothing about it is visible if it goes wrong -- it just leaves
 *  measuredHeroDPS at zero and the following camp scaled off a guess.
 *
 *  What this holds it to:
 *
 *  - starting a run picks four heroes and fields two, before any round is
 *    loaded and without buying anything;
 *  - the match then runs, with heroes in it and creeps to hit;
 *  - buying Summon Heroes changes none of that. The upgrade gates casting the
 *    spell and showing the roster in the lobby corner, and nothing else.
 *
 *  Both halves are asserted rather than reported. Gating startDPSTest on the
 *  purchase -- the regression this exists to catch -- fails the unbought half
 *  while the bought half still passes, which is that bug's fingerprint. */
function runDpsTest(t: TestReporter): void {
  // Start a run the way the New Game circle does, WITHOUT buying Summon
  // Heroes. Starting a run is what picks the roster now, so this no longer has
  // to load a round it does not intend to play just to get one.
  t.report('purchasedAtStart', isSummonUpgradePurchased() ? 1 : 0);
  beginNewRun();
  expect(t, 'heroesPickedUnbought', hasHeroes() ? 1 : 0, 1);
  expect(t, 'chosenThisRoundUnbought', getChosenHeroCount(), 2);

  loadInterRoundLobby();
  t.after(3, () => {
    const a = dpsTestStatus();
    expect(t, 'dpsRunsUnbought', a.timer ? 1 : 0, 1);
    expect(t, 'dpsHeroesUnbought', a.heroes, 2);
    t.report('dpsCreepsUnbought', a.creeps);
    if (a.creeps === 0) t.fail('dpsCreepsUnbought', 'match ran with no creeps to hit');

    // Now buy it and do the same again: the roster display is gated, but
    // nothing else should differ.
    purchaseSummonUpgrade();
    refreshInterRoundLobbyRoster();
    expect(t, 'heroesPickedBought', hasHeroes() ? 1 : 0, 1);
    expect(t, 'chosenThisRoundBought', getChosenHeroCount(), 2);
    loadInterRoundLobby();
    t.after(3, () => {
      const b = dpsTestStatus();
      // Asserted, not merely reported: buying the upgrade must leave the
      // match exactly as it was, and a number nobody checks proves nothing.
      expect(t, 'dpsRunsBought', b.timer ? 1 : 0, 1);
      expect(t, 'dpsHeroesBought', b.heroes, 2);
      t.report('dpsCreepsBought', b.creeps);
      if (b.creeps === 0) t.fail('dpsCreepsBought', 'match ran with no creeps to hit');
      t.done();
    });
  });
}

registerTest('dps', runDpsTest);

/** The match measures A SPECIFIC CAMP, so anything that changes which camp you
 *  will face has to restart it.
 *
 *  Buying the Strange Meat swaps the next camp for a level 3 one. The lobby is
 *  already sparring against the camp it replaced, and those numbers scale the
 *  round you actually play -- so left alone, the meat calibrated you against
 *  creeps you were never going to meet. */
function runDpsCampSwapTest(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();

  t.after(4, () => {
    const before = dpsTestStatus();
    t.report('campBefore', before.campIndex);
    t.report('elapsedBefore', R2I(before.elapsed));
    expect(t, 'matchRunningBefore', before.timer ? 1 : 0, 1);
    if (before.elapsed < 1) t.fail('elapsedBefore', 'match had not started measuring');

    // What buying the meat does.
    const forced = forceLevel3Camp();
    expect(t, 'meatChangedCamp', forced ? 1 : 0, 1);

    t.after(2, () => {
      const after = dpsTestStatus();
      t.report('campAfter', after.campIndex);
      const camp = getCampData();
      t.report('campLevelAfter', camp != null ? camp.level : 0);
      expect(t, 'campLevelAfter_is3', camp != null ? camp.level : 0, 3);

      // The match must be running again, against the NEW camp, from zero --
      // not still carrying the replaced camp's clock.
      expect(t, 'matchRunningAfter', after.timer ? 1 : 0, 1);
      expect(t, 'creepsMatchNewCamp', after.creeps, camp != null ? camp.creeps.length : -1);
      if (after.elapsed >= before.elapsed) {
        t.fail('clockRestarted',
          'clock did not restart: ' + I2S(R2I(before.elapsed)) + 's -> ' + I2S(R2I(after.elapsed)) + 's');
      }
      t.report('elapsedAfter', R2I(after.elapsed));
      t.done();
    });
  });
}

registerTest('dpscampswap', runDpsCampSwapTest);

/** Reset Purchases, taken in the middle of a match.
 *
 *  It rewinds the lobby to the snapshot taken on entry -- including the camp,
 *  if the Strange Meat had changed it -- and rebuilds the lobby. The rebuild is
 *  what has to leave a match running against whatever camp the rewind restored,
 *  rather than a half-finished one measuring the camp that was just undone. */
function runDpsRevertTest(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();

  t.after(4, () => {
    const entry = dpsTestStatus();
    t.report('campOnEntry', entry.campIndex);
    expect(t, 'matchRunningOnEntry', entry.timer ? 1 : 0, 1);

    // Change the camp mid-match, exactly as buying the meat does...
    forceLevel3Camp();
    const swapped = dpsTestStatus();
    t.report('campAfterMeat', swapped.campIndex);

    // ...then take Reset Purchases, which is meant to undo it.
    revertToInterRoundLobbySnapshot();
    revertHeroesToInterRoundLobbySnapshot();
    loadInterRoundLobby();

    t.after(4, () => {
      const after = dpsTestStatus();
      const camp = getCampData();
      t.report('campAfterRevert', after.campIndex);
      expect(t, 'matchRunningAfterRevert', after.timer ? 1 : 0, 1);
      expect(t, 'creepsAfterRevert', after.creeps, camp != null ? camp.creeps.length : -1);
      // A fresh lobby means a fresh clock, not the one that was interrupted.
      if (after.elapsed > 4) {
        t.fail('freshClockAfterRevert',
          'clock carried over: ' + I2S(R2I(after.elapsed)) + 's');
      }
      t.report('elapsedAfterRevert', R2I(after.elapsed));
      t.done();
    });
  });
}

registerTest('dpsrevert', runDpsRevertTest);


/** Mercenaries fight beside the heroes in a real round, so the match has to
 *  include them -- a measurement of heroes alone understates the force the camp
 *  will meet and scales the next camp too easily.
 *
 *  Also covers the restart's cleanup: re-running must field the mercenary
 *  again, not leave the old one standing and add a second. */
function runDpsMercTest(t: TestReporter): void {
  beginNewRun();
  expect(t, 'mercHired', buyMercContract() && hasActiveMerc() ? 1 : 0, 1);
  loadInterRoundLobby();

  t.after(4, () => {
    const a = dpsTestStatus();
    t.report('heroesInMatch', a.heroes);
    t.report('mercsInMatch', a.mercs);
    expect(t, 'matchRunning', a.timer ? 1 : 0, 1);
    expect(t, 'mercFieldedWithHeroes', a.mercs, 1);

    // The match's mercenary must belong to the hidden check player, like its
    // heroes. Owned by a human it would sit on that player's command card, be
    // controllable, and -- because spawning one pans its owner's camera -- yank
    // the view across the lobby the moment the match started.
    const force = measureFieldedForce();
    expect(t, 'noMatchMercOwnedByAHuman', force.mercsOwnedByHumans, 0);
    const cameraX = GetCameraTargetPositionX();
    const cameraY = GetCameraTargetPositionY();
    t.report('cameraX', R2I(cameraX));
    t.report('cameraY', R2I(cameraY));

    // Restarting fields them again; the camera must stay where the player left
    // it through that too.
    restartDPSTest();
    t.after(2, () => {
      const moved = math.abs(GetCameraTargetPositionX() - cameraX)
        + math.abs(GetCameraTargetPositionY() - cameraY);
      t.report('cameraMovedOnRestart', R2I(moved));
      if (moved > 64) {
        t.fail('cameraMovedOnRestart', 'camera jumped ' + I2S(R2I(moved)) + ' units');
      }
      expect(t, 'stillNoMercOwnedByAHuman', measureFieldedForce().mercsOwnedByHumans, 0);
      // Re-fielding must replace, not accumulate.
      const b = dpsTestStatus();
      t.report('heroesAfterRestart', b.heroes);
      t.report('mercsAfterRestart', b.mercs);
      expect(t, 'mercNotDuplicated', b.mercs, 1);
      expect(t, 'heroesNotDuplicated', b.heroes, a.heroes);
      expect(t, 'matchRunningAfterRestart', b.timer ? 1 : 0, 1);
      t.done();
    });
  });
}

registerTest('dpsmercs', runDpsMercTest);


/** The sparring match is fought out of sight, for everybody.
 *
 *  It used to be visible to the first human as a special case -- one player
 *  watched the corner light up while the others saw nothing, which was not a
 *  decision anyone made. -viewdps hands vision to whoever asks, and only them. */
function runDpsVisionTest(t: TestReporter): void {
  const dps = getDPSCheckPlayer();
  const humans = getHumanPlayers();
  t.report('humanPlayers', humans.length);

  let seeingByDefault = 0;
  for (const p of humans) {
    if (GetPlayerAlliance(dps.handle, p.handle, ALLIANCE_SHARED_VISION)) seeingByDefault += 1;
  }
  expect(t, 'nobodySeesByDefault', seeingByDefault, 0);

  // What -viewdps does for the player who typed it.
  const me = humans[0];
  expect(t, 'toggleOn', toggleDPSVision(me.handle) ? 1 : 0, 1);
  expect(t, 'watcherSees',
    GetPlayerAlliance(dps.handle, me.handle, ALLIANCE_SHARED_VISION) ? 1 : 0, 1);

  let othersSeeing = 0;
  for (const p of humans) {
    if (p.handle === me.handle) continue;
    if (GetPlayerAlliance(dps.handle, p.handle, ALLIANCE_SHARED_VISION)) othersSeeing += 1;
  }
  expect(t, 'othersStillBlind', othersSeeing, 0);

  expect(t, 'toggleOff', toggleDPSVision(me.handle) ? 1 : 0, 0);
  expect(t, 'watcherBlindAgain',
    GetPlayerAlliance(dps.handle, me.handle, ALLIANCE_SHARED_VISION) ? 1 : 0, 0);
  t.done();
}

registerTest('dpsvision', runDpsVisionTest);


/** How much a mercenary moves the difficulty scaling.
 *
 *  Camp HP is pegged to the force's effective HP, and camp damage to its DPS.
 *  Counting the mercenary raises both, so camps get tougher for anyone who owns
 *  one -- this puts a number on "how much" rather than letting a balance change
 *  land unmeasured.
 *
 *  Fields the force directly rather than through a summon, and outside the
 *  lobby match, because that match rigs every combatant to 99999 HP and would
 *  measure the rig instead of the units. */
function runForceScaleTest(t: TestReporter): void {
  beginNewRun();
  expect(t, 'mercHired', buyMercContract() && hasActiveMerc() ? 1 : 0, 1);

  const x = 0;
  const y = 0;
  spawnHeroes([Players[0]], x, y);
  spawnMercWithHeroes(x, y - 96, [Players[0].id]);

  // One frame, so hero tome bonuses have landed before anything is read.
  t.after(1, () => {
    const f = measureFieldedForce();
    t.report('heroes', f.heroes);
    t.report('mercs', f.mercs);
    t.report('heroEHP', R2I(f.heroEHP));
    t.report('mercEHP', R2I(f.mercEHP));
    t.report('heroDPS', R2I(f.heroDPS));
    t.report('mercDPS', R2I(f.mercDPS));
    if (f.heroEHP > 0) {
      // 100 = no change; 150 = camps get half again as much HP.
      t.report('campHPPercentOfBefore', R2I((f.heroEHP + f.mercEHP) / f.heroEHP * 100));
    }
    if (f.heroDPS > 0) {
      t.report('campDamagePercentOfBefore', R2I((f.heroDPS + f.mercDPS) / f.heroDPS * 100));
    }
    if (f.mercs === 0) t.fail('mercs', 'no mercenary fielded, nothing measured');
    t.done();
  });
}

registerTest('forcescale', runForceScaleTest);


/** Nothing the match brought onto the field may outlive it.
 *
 *  Heroes and mercenaries were being removed by name, from the lists that
 *  spawned them. Whatever they SUMMONED was not on any list, so a Far Seer's
 *  wolves stayed behind -- and a restart, which is what rerolling does, began
 *  the next match with the previous one's wolves still fighting in it. Sweeping
 *  by owner is what closes that, so this counts units by owner too rather than
 *  trusting the same lists that missed them.
 *
 *  Ends the match early rather than waiting out the full 30 seconds; the
 *  teardown is the same either way, and the timer's own expiry runs it. */
function runDpsFieldClearTest(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();

  t.after(4, () => {
    const during = checkPlayerUnitCount();
    t.report('checkPlayerUnitsDuringMatch', during);
    if (during === 0) {
      t.fail('checkPlayerUnitsDuringMatch', 'nothing was fielded, so nothing is being tested');
    }

    cancelDPSTest();
    t.after(1, () => {
      const after = checkPlayerUnitCount();
      t.report('checkPlayerUnitsAfterMatch', after);
      expect(t, 'fieldClearedAfterMatch', after, 0);
      t.done();
    });
  });
}

registerTest('dpsfieldclear', runDpsFieldClearTest);
