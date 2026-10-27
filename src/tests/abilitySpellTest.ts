import { registerTest, TestReporter } from './testKit';
import { beginNewRun, loadTerrain } from '../terrain/load';
import { forEachUnitOfPlayer, getHumanPlayers } from '../util';
import {
  PEASANT_ID, UNHOLY_BONE_ID, GREATER_UNHOLY_BONE_ID, HORSE_ESSENCE_ID, GREATER_HORSE_ESSENCE_ID,
  UNHOLY_FRENZY_ABILITY_ID, GREATER_UNHOLY_FRENZY_ABILITY_ID, IMBUE_HORSE_ABILITY_ID,
  GREATER_IMBUE_HORSE_ABILITY_ID, VACUUM_ABILITY_ID, RESOURCE_VACUUM_ID,
} from '../constants';

const FRENZY_BUFF = FourCC('BUhf');
const HORSE_BUFF = FourCC('Bblo');

/** Unholy Frenzy and Imbue With Horse, cast for real.
 *
 *  Each item grants its own spell (the Greater one, not both); every ability
 *  item spell has a 60s cooldown. Both go on the caster, another peasant, a
 *  hero or a mercenary. Frenzy's numbers are 50%/2 hp/s (75%/4 Greater) for 10s,
 *  and it drains a hero; Imbue With Horse adds Wind Walk's 70% to move speed for 10s
 *  -- 20s with the Greater essence. */
function runAbilitySpells(t: TestReporter): void {
  beginNewRun();
  // A round, not the lobby: the lobby's roster code clears units it did not
  // put there, test heroes included, a few seconds in.
  loadTerrain(1);
  t.after(1, () => granting(t));
}

let x = 0;
let y = 0;

function freshPeasant(dx: number, dy: number, itemType: number): unit {
  const me = getHumanPlayers()[0].handle;
  const u = CreateUnit(me, PEASANT_ID, x + dx, y + dy, 0)!;
  UnitAddItem(u, CreateItem(itemType, x + dx, y + dy)!);
  return u;
}

function granting(t: TestReporter): void {
  const me = getHumanPlayers()[0].handle;
  let p: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (p == null && GetUnitTypeId(u) === PEASANT_ID) p = u; });
  if (p == null) { t.fail('peasant', 'none'); t.done(); return; }
  x = GetUnitX(p);
  y = GetUnitY(p);
  const r = Rect(x - 900, y - 600, x + 900, y + 600)!;
  EnumDestructablesInRect(r, undefined, () => RemoveDestructable(GetEnumDestructable()!));
  RemoveRect(r);
  RemoveUnit(p);

  const bone = freshPeasant(0, 0, UNHOLY_BONE_ID);
  const greaterBone = freshPeasant(0, 150, GREATER_UNHOLY_BONE_ID);
  t.expect('boneGrantsFrenzy', GetUnitAbilityLevel(bone, UNHOLY_FRENZY_ABILITY_ID), 1);
  t.expect('boneNotGreater', GetUnitAbilityLevel(bone, GREATER_UNHOLY_FRENZY_ABILITY_ID), 0);
  t.expect('greaterBoneGrantsGreater', GetUnitAbilityLevel(greaterBone, GREATER_UNHOLY_FRENZY_ABILITY_ID), 1);
  t.expect('greaterBoneNotPlain', GetUnitAbilityLevel(greaterBone, UNHOLY_FRENZY_ABILITY_ID), 0);
  const vac = freshPeasant(0, -150, RESOURCE_VACUUM_ID);
  t.expect('noVacuumOnBone', GetUnitAbilityLevel(bone, VACUUM_ABILITY_ID), 0);
  t.expect('vacuumOnVacuum', GetUnitAbilityLevel(vac, VACUUM_ABILITY_ID), 1);

  // Frenzy on itself, then the Greater one on a hero.
  t.expectTrue('frenzySelfAccepted', IssueTargetOrder(bone, 'unholyfrenzy', bone));
  const hero = CreateUnit(Player(0)!, FourCC('Hpal'), x + 200, y + 150, 0)!;
  t.after(0.5, () => {
    t.expectTrue('frenzyOnPeasant', GetUnitAbilityLevel(bone, FRENZY_BUFF) > 0);
    const cd = BlzGetUnitAbilityCooldownRemaining(bone, UNHOLY_FRENZY_ABILITY_ID);
    t.expectTrue('frenzyCooldown60', cd > 55 && cd <= 60);
    IssueTargetOrder(greaterBone, 'unholyfrenzy', hero);
    t.after(0.5, () => {
      const before = GetWidgetLife(hero);
      t.after(2, () => {
        t.expectTrue('heroFrenzied', GetUnitAbilityLevel(hero, FRENZY_BUFF) > 0);
        // The drain is what the ability says; the hero's own regeneration
        // blurs the measured loss, so that only has to be a loss.
        const lost = before - GetWidgetLife(hero);
        t.report('heroLostIn2s', lost);
        t.expectTrue('heroDrained', lost > 1);
        const plainAb = BlzGetUnitAbility(bone, UNHOLY_FRENZY_ABILITY_ID)!;
        const greaterAb = BlzGetUnitAbility(greaterBone, GREATER_UNHOLY_FRENZY_ABILITY_ID)!;
        t.expect('plainRate', BlzGetAbilityRealLevelField(plainAb, ABILITY_RLF_ATTACK_SPEED_BONUS_PERCENT, 0), 0.5);
        t.expect('plainDrain', BlzGetAbilityRealLevelField(plainAb, ABILITY_RLF_DAMAGE_PER_SECOND_UHF2, 0), 2);
        t.expect('greaterRate', BlzGetAbilityRealLevelField(greaterAb, ABILITY_RLF_ATTACK_SPEED_BONUS_PERCENT, 0), 0.75);
        t.expect('greaterDrain', BlzGetAbilityRealLevelField(greaterAb, ABILITY_RLF_DAMAGE_PER_SECOND_UHF2, 0), 4);
        t.expect('plainFrenzy10s', BlzGetAbilityRealLevelField(plainAb, ABILITY_RLF_DURATION_NORMAL, 0), 10);
        t.expect('greaterFrenzy10s', BlzGetAbilityRealLevelField(greaterAb, ABILITY_RLF_DURATION_NORMAL, 0), 10);
        horse(t, hero);
      });
    });
  });
}

function horse(t: TestReporter, hero: unit): void {
  const rider = freshPeasant(-300, -300, HORSE_ESSENCE_ID);
  const walker = freshPeasant(-300, -420, HORSE_ESSENCE_ID);
  const greaterRider = freshPeasant(-150, -420, GREATER_HORSE_ESSENCE_ID);
  const merc = CreateUnit(Player(0)!, FourCC('nogr'), x - 100, y + 300, 0)!;
  t.expect('essenceGrantsImbue', GetUnitAbilityLevel(rider, IMBUE_HORSE_ABILITY_ID), 1);
  t.expect('greaterEssenceGrantsGreater', GetUnitAbilityLevel(greaterRider, GREATER_IMBUE_HORSE_ABILITY_ID), 1);
  t.expectTrue('selfAccepted', IssueTargetOrder(rider, 'bloodlust', rider));
  t.expectTrue('otherPeasantAccepted', IssueTargetOrder(greaterRider, 'bloodlust', walker));
  t.after(0.5, () => {
    t.expectTrue('imbued', GetUnitAbilityLevel(rider, HORSE_BUFF) > 0);
    t.expectTrue('otherImbued', GetUnitAbilityLevel(walker, HORSE_BUFF) > 0);
    const greaterAb = BlzGetUnitAbility(greaterRider, GREATER_IMBUE_HORSE_ABILITY_ID)!;
    const plainAb = BlzGetUnitAbility(rider, IMBUE_HORSE_ABILITY_ID)!;
    t.expect('plainDuration', BlzGetAbilityRealLevelField(plainAb, ABILITY_RLF_DURATION_NORMAL, 0), 10);
    t.expect('greaterDuration', BlzGetAbilityRealLevelField(greaterAb, ABILITY_RLF_DURATION_NORMAL, 0), 20);
    // Heroes and mercenaries take it too, from casters whose cooldown is free.
    const forHero = freshPeasant(150, 150, HORSE_ESSENCE_ID);
    const forMerc = freshPeasant(-150, 300, HORSE_ESSENCE_ID);
    t.expectTrue('heroAccepted', IssueTargetOrder(forHero, 'bloodlust', hero));
    t.expectTrue('mercAccepted', IssueTargetOrder(forMerc, 'bloodlust', merc));
    const frenzyMerc = freshPeasant(-150, 450, UNHOLY_BONE_ID);
    t.expectTrue('frenzyOnMercAccepted', IssueTargetOrder(frenzyMerc, 'unholyfrenzy', merc));
    const cd = BlzGetUnitAbilityCooldownRemaining(rider, IMBUE_HORSE_ABILITY_ID);
    t.expectTrue('imbueCooldown60', cd > 55 && cd <= 60);
    // Wind Walk's top speed: 70% on the peasant's own speed.
    t.expect('about70PercentFaster', R2I(GetUnitMoveSpeed(walker) * 100 / GetUnitDefaultMoveSpeed(walker) + 0.5), 170);
    t.after(1, () => {
      t.expectTrue('heroImbued', GetUnitAbilityLevel(hero, HORSE_BUFF) > 0);
      t.expectTrue('mercImbued', GetUnitAbilityLevel(merc, HORSE_BUFF) > 0);
    });
    t.after(10.5, () => {
      t.expect('plainEndsBy11s', GetUnitAbilityLevel(rider, HORSE_BUFF), 0);
      t.expectTrue('greaterStillOnAt11s', GetUnitAbilityLevel(walker, HORSE_BUFF) > 0);
      t.expect('backToNormalSpeed', GetUnitMoveSpeed(rider), GetUnitDefaultMoveSpeed(rider));
      t.after(10, () => {
        t.expect('greaterEndsBy21s', GetUnitAbilityLevel(walker, HORSE_BUFF), 0);
        t.done();
      });
    });
  });
}
registerTest('abilityspells', runAbilitySpells);
