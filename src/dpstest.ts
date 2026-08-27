import { registerTest, TestReporter } from './testkit';
import { dpsTestStatus } from './creeps';
import { loadInterRoundLobby } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';
import { hasHeroes, initRandomHeroes } from './heroes';

/** Watch the inter-round lobby's DPS sparring match, and see what buying
 *  Summon Heroes does to it while it is running.
 *
 *  The match is meant to last DPS_TEST_DURATION (30s) and is what calibrates
 *  creep scaling for the next round, so anything that cuts it short silently
 *  mis-scales the following camp. */
function runDpsProbe(t: TestReporter): void {
  // A real run reaches the lobby through a round, and it is loadGameplay that
  // picks the roster. Jumping straight here would leave chosenIndices empty and
  // measure nothing but the shortcut.
  if (!hasHeroes()) initRandomHeroes();
  t.report('hasHeroes', hasHeroes() ? 1 : 0);
  loadInterRoundLobby();

  t.after(2, () => {
    const a = dpsTestStatus();
    t.report('t2_mode', a.mode ? 1 : 0);
    t.report('t2_creeps', a.creeps);
    t.report('t2_heroes', a.heroes);
    t.report('t2_timerRunning', a.timer ? 1 : 0);

    // Buy the upgrade mid-match, exactly as a player would, and take the same
    // roster refresh the shop takes on purchase.
    t.report('purchasedBefore', isSummonUpgradePurchased() ? 1 : 0);
    purchaseSummonUpgrade();
    refreshInterRoundLobbyRoster();

    t.after(3, () => {
      const b = dpsTestStatus();
      t.report('afterBuy_mode', b.mode ? 1 : 0);
      t.report('afterBuy_creeps', b.creeps);
      t.report('afterBuy_heroes', b.heroes);
      t.report('afterBuy_timerRunning', b.timer ? 1 : 0);
      t.report('afterBuy_elapsed', R2I(b.elapsed));

      t.after(6, () => {
        const c = dpsTestStatus();
        t.report('t11_mode', c.mode ? 1 : 0);
        t.report('t11_creeps', c.creeps);
        t.report('t11_timerRunning', c.timer ? 1 : 0);
        t.report('t11_elapsed', R2I(c.elapsed));
        t.done();
      });
    });
  });
}

registerTest('dpsprobe', runDpsProbe);
