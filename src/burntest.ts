import { registerTest, TestReporter } from './testkit';
import { gameState } from './state';
import { getTrain, isBurning, isWrecked, extinguish } from './train';

/** Verify the burning train's production lock and the wrecked end state.
 *
 *  Reports:
 *    burning          1 once the fire is lit
 *    manaBurning      train mana while burning (production locked => 0)
 *    wrecked          1 once max HP has been eaten down to the floor
 *    maxHpFloor       max HP after the decay stops (must be 1, never 0)
 *    manaWrecked      mana while wrecked (still 0)
 *    burningAfterWater 1 -- a wrecked train cannot be put out
 *    manaAfterWater   still 0 -- water must not restore production
 *
 *  Starts from a low max HP so the 1/second decay reaches the floor inside a
 *  test run rather than the ~100s a real fire would take. */
function runBurnTest(t: TestReporter): void {
  const train = getTrain();

  gameState.trainMaxHP = 4;
  BlzSetUnitMaxHP(train.handle, gameState.trainMaxHP);
  t.report('startMaxHp', gameState.trainMaxHP);

  // Under 2 HP is what lights the fire.
  SetUnitState(train.handle, UNIT_STATE_LIFE, 1);

  t.after(1, () => {
    t.report('burning', isBurning() ? 1 : 0);
    t.report('manaBurning', train.mana);
  });

  // 4 -> 1 is three ticks; allow plenty of slack for a loaded VM.
  t.after(9, () => {
    t.report('wrecked', isWrecked() ? 1 : 0);
    t.report('maxHpFloor', gameState.trainMaxHP);
    t.report('manaWrecked', train.mana);

    // The water bucket's effect. On a wrecked train it must do nothing.
    extinguish();
    t.after(2, () => {
      t.report('burningAfterWater', isBurning() ? 1 : 0);
      t.report('manaAfterWater', train.mana);
      t.done();
    });
  });
}

registerTest('burn', runBurnTest);
