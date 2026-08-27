import { registerTest, TestReporter } from './testkit';
import { dpsTestStatus } from './creeps';
import { loadInterRoundLobby, loadTerrain } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';
import { hasHeroes, getChosenHeroCount } from './heroes';

/** Watch the inter-round lobby's DPS sparring match, and see what buying
 *  Summon Heroes does to it while it is running.
 *
 *  The match is meant to last DPS_TEST_DURATION (30s) and is what calibrates
 *  creep scaling for the next round, so anything that cuts it short silently
 *  mis-scales the following camp. */
function runDpsProbe(t: TestReporter): void {
  // Play a round the way the game does, WITHOUT buying Summon Heroes. The
  // question is whether the roster and the sparring match happen anyway, or
  // whether they quietly wait on a purchase.
  t.report('purchasedAtStart', isSummonUpgradePurchased() ? 1 : 0);
  loadTerrain(0);
  t.report('heroesPickedUnbought', hasHeroes() ? 1 : 0);
  t.report('chosenThisRoundUnbought', getChosenHeroCount());

  loadInterRoundLobby();
  t.after(3, () => {
    const a = dpsTestStatus();
    t.report('dpsRunsUnbought', a.timer ? 1 : 0);
    t.report('dpsHeroes', a.heroes);
    t.report('dpsCreeps', a.creeps);
    if (!a.timer) t.fail('dpsRunsUnbought', 'no DPS match without the upgrade');
    if (a.heroes === 0) t.fail('dpsHeroes', 'match ran with nobody in it');

    // Now buy it and do the same again: the roster display is gated, but
    // nothing else should differ.
    purchaseSummonUpgrade();
    refreshInterRoundLobbyRoster();
    loadTerrain(1);
    t.report('heroesPickedBought', hasHeroes() ? 1 : 0);
    t.report('chosenThisRoundBought', getChosenHeroCount());
    loadInterRoundLobby();
    t.after(3, () => {
      const b = dpsTestStatus();
      t.report('dpsRunsBought', b.timer ? 1 : 0);
      t.report('dpsHeroesBought', b.heroes);
      t.done();
    });
  });
}

registerTest('dpsprobe', runDpsProbe);
