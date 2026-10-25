import { registerTest, TestReporter } from './testkit';
import {
  getSparringStatus, forceLevel3Camp, getCampData, restartSparringMatch, measureFieldedForce,
  cancelSparringMatch, getCheckPlayerUnitCount, getCampOrigin,
} from './creeps';
import { Unit } from 'w3ts';
import { getDPSCheckPlayer } from './teams';
import { spawnHeroes } from './heroes';
import { spawnMercWithHeroes } from './mercenary';
import { Players } from 'w3ts/globals';
import { buyMercContract, hasActiveMerc } from './mercenary';
import { toggleDPSVision } from './teams';
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

/** The sparring match itself, under test.
 *
 *  The sparring match is the fight the inter-round lobby runs against
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
 *  Both halves are asserted rather than reported. Gating startSparringMatch on the
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
    const a = getSparringStatus();
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
      const b = getSparringStatus();
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
 *  will face has to restart it against the new one, from zero.
 *
 *  Two things change it, and they were two tests until they were read side by
 *  side: buying the Strange Meat swaps the next camp for a level 3 one, and
 *  Reset Purchases rewinds the lobby to the snapshot taken on entry -- undoing
 *  that swap and rebuilding the lobby around it. Both leave the lobby sparring
 *  against a camp that is no longer the one you will play, and those numbers
 *  scale the round you actually play.
 *
 *  One test, because it is one invariant and the second trigger only makes
 *  sense after the first has fired. The keys stay per-trigger -- meat*, revert*
 *  -- so a failure still says WHICH of the two stopped restarting.
 */
function runDpsRestartTest(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();

  t.after(4, () => {
    const before = getSparringStatus();
    t.report('campOnEntry', before.campIndex);
    t.report('elapsedOnEntry', R2I(before.elapsed));
    expect(t, 'matchRunningOnEntry', before.timer ? 1 : 0, 1);
    if (before.elapsed < 1) t.fail('elapsedOnEntry', 'match had not started measuring');

    // --- trigger 1: the Strange Meat swaps the camp ---
    expect(t, 'meatChangedCamp', forceLevel3Camp() ? 1 : 0, 1);

    t.after(2, () => {
      const swapped = getSparringStatus();
      const meatCamp = getCampData();
      t.report('meatCampIndex', swapped.campIndex);
      expect(t, 'meatCampLevelIs3', meatCamp != null ? meatCamp.level : 0, 3);
      expect(t, 'meatMatchRunning', swapped.timer ? 1 : 0, 1);
      expect(t, 'meatCreepsMatchNewCamp', swapped.creeps,
        meatCamp != null ? meatCamp.creeps.length : -1);
      // The clock must have restarted, not carried the replaced camp's on.
      t.report('meatElapsed', R2I(swapped.elapsed));
      if (swapped.elapsed >= before.elapsed) {
        t.fail('meatClockRestarted', 'clock did not restart: '
          + I2S(R2I(before.elapsed)) + 's -> ' + I2S(R2I(swapped.elapsed)) + 's');
      }

      // --- trigger 2: Reset Purchases undoes it and rebuilds the lobby ---
      revertToInterRoundLobbySnapshot();
      revertHeroesToInterRoundLobbySnapshot();
      loadInterRoundLobby();

      t.after(4, () => {
        const after = getSparringStatus();
        const revertCamp = getCampData();
        // The camp the reset restored must be the one you walked in with --
        // checkable only now that both triggers live in one run, and the point
        // of Reset Purchases rather than a side effect of it.
        expect(t, 'revertCampIndex', after.campIndex, before.campIndex);
        expect(t, 'revertMatchRunning', after.timer ? 1 : 0, 1);
        expect(t, 'revertCreepsMatchCamp', after.creeps,
          revertCamp != null ? revertCamp.creeps.length : -1);
        // A rebuilt lobby means a fresh clock, not the interrupted one.
        t.report('revertElapsed', R2I(after.elapsed));
        if (after.elapsed > 4) {
          t.fail('revertFreshClock', 'clock carried over: ' + I2S(R2I(after.elapsed)) + 's');
        }
        t.done();
      });
    });
  });
}

registerTest('dpsrestart', runDpsRestartTest);


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
    const a = getSparringStatus();
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
    restartSparringMatch();
    t.after(2, () => {
      const moved = math.abs(GetCameraTargetPositionX() - cameraX)
        + math.abs(GetCameraTargetPositionY() - cameraY);
      t.report('cameraMovedOnRestart', R2I(moved));
      if (moved > 64) {
        t.fail('cameraMovedOnRestart', 'camera jumped ' + I2S(R2I(moved)) + ' units');
      }
      expect(t, 'stillNoMercOwnedByAHuman', measureFieldedForce().mercsOwnedByHumans, 0);
      // Re-fielding must replace, not accumulate.
      const b = getSparringStatus();
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
    const fielded = getCheckPlayerUnitCount();
    t.report('unitsFieldedByMatch', fielded);
    if (fielded === 0) {
      t.fail('unitsFieldedByMatch', 'nothing was fielded, so nothing is being tested');
    }

    // Stand in for a Feral Spirit wolf: a unit the match owns that no list
    // knows about. Round-one heroes have not learned a summon yet, so without
    // this the test would pass while proving nothing about the case that
    // actually broke -- summons surviving a restart and fighting in the next
    // match.
    const origin = getCampOrigin();
    const wolf = Unit.create(getDPSCheckPlayer(), FourCC('nwlt'),
      origin != null ? origin.x : 0, origin != null ? origin.y : 0, 270);
    expect(t, 'standInSummonCreated', wolf != null ? 1 : 0, 1);
    const withSummon = getCheckPlayerUnitCount();
    t.report('unitsWithSummon', withSummon);
    expect(t, 'summonIsOwnedByTheMatch', withSummon - fielded, 1);

    cancelSparringMatch();
    t.after(1, () => {
      const after = getCheckPlayerUnitCount();
      t.report('unitsAfterMatch', after);
      // Zero, summon included. Removing only the units on the spawn lists
      // would leave this at 1 and is exactly what shipped.
      expect(t, 'fieldClearedIncludingSummon', after, 0);
      t.done();
    });
  });
}

registerTest('dpsfieldclear', runDpsFieldClearTest);
