import { registerTest, TestReporter } from './testKit';
import { beginNewRun, loadTerrain } from '../terrain/load';
import { forEachUnitOfPlayer, getHumanPlayers } from '../util';
import { PEASANT_ID, UNHOLY_BONE_ID, UNHOLY_FRENZY_ABILITY_ID } from '../constants';

/** An ability item's cooldown stays with the item.
 *
 *  The spell comes and goes with the item, and a freshly added ability starts
 *  off cooldown: dropping the bone and picking it back up, or handing it to
 *  another peasant, must not make Unholy Frenzy castable again. A bone that
 *  has never been cast is ready at once. */
function runItemCooldown(t: TestReporter): void {
  beginNewRun();
  loadTerrain(1);
  t.after(1, () => casting(t));
}

function remaining(u: unit): number {
  return BlzGetUnitAbilityCooldownRemaining(u, UNHOLY_FRENZY_ABILITY_ID);
}

function casting(t: TestReporter): void {
  const me = getHumanPlayers()[0].handle;
  let p: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (p == null && GetUnitTypeId(u) === PEASANT_ID) p = u; });
  if (p == null) { t.fail('peasant', 'none'); t.done(); return; }
  const x = GetUnitX(p);
  const y = GetUnitY(p);
  RemoveUnit(p);
  const a = CreateUnit(me, PEASANT_ID, x, y, 0)!;
  const b = CreateUnit(me, PEASANT_ID, x + 100, y, 0)!;
  const fresh = CreateUnit(me, PEASANT_ID, x - 100, y, 0)!;
  const bone = CreateItem(UNHOLY_BONE_ID, x, y)!;
  UnitAddItem(a, bone);
  UnitAddItem(fresh, CreateItem(UNHOLY_BONE_ID, x, y)!);
  t.after(0.3, () => {
    t.expect('freshBoneReady', remaining(fresh), 0);
    t.expectTrue('castAccepted', IssueTargetOrder(a, 'unholyfrenzy', a));
    t.after(0.5, () => {
      t.expectTrue('onCooldown', remaining(a) > 55);
      UnitRemoveItem(a, bone);
      t.after(0.3, () => {
        t.expect('spellGoneWithBone', GetUnitAbilityLevel(a, UNHOLY_FRENZY_ABILITY_ID), 0);
        UnitAddItem(a, bone);
        t.after(0.3, () => {
          t.expect('spellBack', GetUnitAbilityLevel(a, UNHOLY_FRENZY_ABILITY_ID), 1);
          t.report('afterRepickup', remaining(a));
          t.expectTrue('stillOnCooldownAfterRepickup', remaining(a) > 55);
          t.expectFalse('recastRefused', IssueTargetOrder(a, 'unholyfrenzy', a));
          UnitRemoveItem(a, bone);
          UnitAddItem(b, bone);
          t.after(0.3, () => {
            t.report('afterHandOver', remaining(b));
            t.expectTrue('cooldownTravelsToOtherPeasant', remaining(b) > 55);
            t.expectFalse('otherPeasantCastRefused', IssueTargetOrder(b, 'unholyfrenzy', b));
            t.done();
          });
        });
      });
    });
  });
}

registerTest('itemcooldown', runItemCooldown);
