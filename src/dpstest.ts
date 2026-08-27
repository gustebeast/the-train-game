import { registerTest, TestReporter } from './testkit';
import { dpsTestStatus } from './creeps';
import { loadInterRoundLobby, loadTerrain } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';
import { hasHeroes, getChosenHeroCount } from './heroes';

/** Record a measurement AND hold it to an expected value, so a number nobody
 *  checks cannot drift. */
function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

/** Watch the inter-round lobby's DPS sparring match, and see what buying
 *  Summon Heroes does to it while it is running.
 *
 *  The match is meant to last DPS_TEST_DURATION (30s) and is what calibrates
 *  creep scaling for the next round, so anything that cuts it short silently
 *  mis-scales the following camp. */
function runDpsProbe(t: TestReporter): void {
  // Load a gameplay round first, WITHOUT buying Summon Heroes -- not to play
  // it, but because loadGameplay is what picks the roster. Jumping straight to
  // the lobby leaves nobody chosen, and the match then measures the shortcut
  // rather than the game. The sparring itself happens in the lobby, below.
  //
  // The question is whether the roster and the match happen at all when the
  // upgrade is unbought, or whether they quietly wait on the purchase.
  t.report('purchasedAtStart', isSummonUpgradePurchased() ? 1 : 0);
  loadTerrain(0);
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
    loadTerrain(1);
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

registerTest('dpsprobe', runDpsProbe);
