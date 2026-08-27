import { registerTest, TestReporter } from './testkit';
import { dpsTestStatus } from './creeps';
import { loadInterRoundLobby, beginNewRun } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';
import { hasHeroes, getChosenHeroCount } from './heroes';

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
