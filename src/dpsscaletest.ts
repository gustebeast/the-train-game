import { registerTest, TestReporter } from './testkit';
import { dpsMeasured, dpsSampleBreakdown, dpsTestStatus } from './creeps';
import { beginNewRun, loadInterRoundLobby } from './terrain/load';
import { buyMercContract } from './mercenary';

/** Hold a measurement to a floor rather than an exact value, for numbers whose
 *  right value is a balance question but whose SIGN is not. */
function atLeast(t: TestReporter, key: string, actual: number, floor: number): void {
  t.report(key, actual);
  if (actual < floor) {
    t.fail(key, 'expected at least ' + I2S(R2I(floor)) + ', got ' + I2S(R2I(actual)));
  }
}

/**
 * A diagnostic, not a gate: run one whole 30-second sparring match and report
 * everything the measurement saw.
 *
 * The camp's damage multiplier is (our DPS x advantage) / measured creep DPS,
 * so measured creep DPS is the denominator of the entire difficulty curve.
 * Two rounds in a row have come out wrong in opposite directions -- creeps
 * hitting for 50-70, then creeps hitting for 2-3 -- and both are consistent
 * with that denominator being measured against the wrong thing.
 *
 * The number this exists to expose is summonHPLost. Summons are rigged to a
 * huge HP pool so they cannot die mid-match, which also means creeps can spend
 * the whole match beating on them; and a wolf carries neither a hero's armour
 * nor a hero's share of the fight. If most of our side's HP loss is coming off
 * summons, then measured creep DPS describes what creeps do to WOLVES, and
 * the camp is being scaled against a fight that will not happen.
 *
 * What it caught: creepHPLost came back as MINUS 98,000. The sampler was
 * baselined while only our side had been rigged, so each creep's jump from its
 * natural HP to its share of the 99999 pool was banked as damage we had dealt
 * -- negative, because the HP went up. measuredHeroDPS was -3258, the scale was
 * -185x, and every creep in the next round landed on the minimum-damage floor.
 * That is the 2-3 damage, and it is why the same session could also produce
 * 50-70: the sign and size of that first bogus sample depend entirely on where
 * in the rigging the match happened to start.
 *
 * So the signs ARE asserted, and only the signs. Both sides must lose HP
 * rather than gain it, and the resulting multiplier must be positive. What the
 * numbers should BE beyond that is a balance question, and inventing a
 * threshold here would only bake in a guess.
 */
function runDpsScaleTest(t: TestReporter): void {
  beginNewRun();
  buyMercContract();
  loadInterRoundLobby();

  const started = dpsTestStatus();
  t.report('matchStarted', started.timer ? 1 : 0);
  t.report('fieldedAtStart', started.heroes);
  t.report('creepsAtStart', started.creeps);

  // Mid-match, while the sampler is still running: this is the only moment the
  // tracked lists can be looked at, since teardown clears the field.
  t.after(20, () => {
    const mid = dpsSampleBreakdown();
    t.report('midTrackedOurs', mid.trackedOurs);
    t.report('midTrackedSummons', mid.trackedSummons);
    // The regression, caught at the sign: rigging must never be banked as
    // damage, in either direction.
    atLeast(t, 'midCreepHPLost', mid.creepHPLost, 0);
    t.report('midOurHPLost', mid.ourHPLost);
    t.report('midSummonHPLost', mid.summonHPLost);
    // What share of the damage our side took landed on summons rather than on
    // the heroes and mercenaries the camp will actually have to fight.
    t.report('midSummonSharePct',
      mid.ourHPLost > 0 ? R2I(mid.summonHPLost / mid.ourHPLost * 100) : 0);

    // After the match ends, the banked totals become the two DPS figures and
    // the scale the next camp is built from.
    t.after(15, () => {
      const final = dpsSampleBreakdown();
      const m = dpsMeasured();
      atLeast(t, 'finalCreepHPLost', final.creepHPLost, 0);
      t.report('finalOurHPLost', final.ourHPLost);
      t.report('finalSummonHPLost', final.summonHPLost);
      t.report('finalSummonSharePct',
        final.ourHPLost > 0 ? R2I(final.summonHPLost / final.ourHPLost * 100) : 0);
      atLeast(t, 'measuredOurDPS', m.heroDPS, 1);
      t.report('measuredCreepDPS', m.creepDPS);
      atLeast(t, 'creepDamageScalePct', R2I(m.scale * 100), 1);
      if (m.creepDPS <= 0) t.fail('measuredCreepDPS', 'match measured no creep damage at all');
      t.done();
    });
  });
}

registerTest('dpsscale', runDpsScaleTest);
