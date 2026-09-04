import { Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { Abilities } from '@objectdata/abilities';
import { registerTest, TestReporter } from './testkit';
import { forEachUnitOfPlayer } from './util';

// Asks the ENGINE what it thinks A000's command-card data is, bypassing the
// object-data files entirely. If the button position reads 0,0 the map's data
// never reached the game; if it reads 2,1 the data is fine and something else
// hides the button. Then tries setting it at runtime as a possible fix.
function run(t: TestReporter): void {
  let ax = 0; let ay = 0; let found = false;
  forEachUnitOfPlayer(Players[0].handle, u => {
    if (!found && GetUnitTypeId(u) === PEASANT_ID) { ax = GetUnitX(u); ay = GetUnitY(u); found = true; }
  });
  if (!found) { t.fail('anchor', 'no peasant'); t.done(); return; }

  const p = Unit.create(Players[0], PEASANT_ID, ax, ay, 0)!;
  t.report('abilityLevel', GetUnitAbilityLevel(p.handle, DASH_ABILITY_ID));

  const ab = BlzGetUnitAbility(p.handle, DASH_ABILITY_ID);
  if (ab == null) {
    t.fail('handle', 'BlzGetUnitAbility returned nothing — the unit does not really carry A000');
    p.destroy(); t.done(); return;
  }
  t.report('gotAbilityHandle', 1);
  // Cast range is a per-level field; if it did not serialise the peasant walks
  // into range before casting instead of dashing from where it stands.
  t.report('castRange', BlzGetAbilityRealLevelField(ab, ABILITY_RLF_CAST_RANGE, 0));
  t.report('btnX', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_X));
  t.report('btnY', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_Y));

  // CONTROL: read the same flag on give/take (Channel), a non-hero ability
  // whose button demonstrably DOES show. If that also reads 1, the native is
  // lying and the hero flag was a false lead.
  const ctrl = BlzGetUnitAbility(p.handle, FourCC(Abilities.Channel));
  t.report('ctrlHandle', ctrl != null ? 1 : 0);
  if (ctrl != null) {
    t.report('ctrlHeroAbility', BlzGetAbilityBooleanField(ctrl, ABILITY_BF_HERO_ABILITY) ? 1 : 0);
    t.report('ctrlBtnX', BlzGetAbilityIntegerField(ctrl, ABILITY_IF_BUTTON_POSITION_NORMAL_X));
    t.report('ctrlBtnY', BlzGetAbilityIntegerField(ctrl, ABILITY_IF_BUTTON_POSITION_NORMAL_Y));
  }

  // Flags that can hide a button entirely even with a valid position:
  // a hero ability on a non-hero unit, or an item ability, shows nothing.
  t.report('heroAbility', BlzGetAbilityBooleanField(ab, ABILITY_BF_HERO_ABILITY) ? 1 : 0);
  t.report('itemAbility', BlzGetAbilityBooleanField(ab, ABILITY_BF_ITEM_ABILITY) ? 1 : 0);
  t.report('checkDeps', BlzGetAbilityBooleanField(ab, ABILITY_BF_CHECK_DEPENDENCIES) ? 1 : 0);
  // Clear them at runtime and see whether the button appears in the screenshot.
  t.report('setHeroReturned', BlzSetAbilityBooleanField(ab, ABILITY_BF_HERO_ABILITY, false) ? 1 : 0);
  BlzSetAbilityBooleanField(ab, ABILITY_BF_ITEM_ABILITY, false);
  BlzSetAbilityBooleanField(ab, ABILITY_BF_CHECK_DEPENDENCIES, false);
  t.report('heroAfter', BlzGetAbilityBooleanField(ab, ABILITY_BF_HERO_ABILITY) ? 1 : 0);

  // Try to place the button at runtime and read it back.
  const okX = BlzSetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_X, 2);
  const okY = BlzSetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_Y, 1);
  t.report('setAccepted', (okX ? 1 : 0) + (okY ? 1 : 0));
  t.report('btnXAfter', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_X));
  t.report('btnYAfter', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_Y));

  // Leave the peasant selected so a screenshot shows the command card.
  ClearSelection();
  SelectUnit(p.handle, true);
  PanCameraToTimed(ax, ay, 0);
  t.after(6.0, () => { p.destroy(); t.done(); });
}

registerTest('dashfields', run);
