import { Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { PEASANT_ID, DASH_ABILITY_ID } from './constants';
import { registerTest, TestReporter } from './testkit';

// Asks the ENGINE what it thinks A000's command-card data is, bypassing the
// object-data files entirely. If the button position reads 0,0 the map's data
// never reached the game; if it reads 2,1 the data is fine and something else
// hides the button. Then tries setting it at runtime as a possible fix.
function run(t: TestReporter): void {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, Players[0].handle, undefined);
  let ax = 0; let ay = 0; let found = false;
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (!found && u != null && GetUnitTypeId(u) === PEASANT_ID) { ax = GetUnitX(u); ay = GetUnitY(u); found = true; }
  });
  DestroyGroup(g);
  if (!found) { t.fail('anchor', 'no peasant'); t.done(); return; }

  const p = Unit.create(Players[0], PEASANT_ID, ax, ay, 0)!;
  t.report('abilityLevel', GetUnitAbilityLevel(p.handle, DASH_ABILITY_ID));

  const ab = BlzGetUnitAbility(p.handle, DASH_ABILITY_ID);
  if (ab == null) {
    t.fail('handle', 'BlzGetUnitAbility returned nothing — the unit does not really carry A000');
    p.destroy(); t.done(); return;
  }
  t.report('gotAbilityHandle', 1);
  t.report('btnX', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_X));
  t.report('btnY', BlzGetAbilityIntegerField(ab, ABILITY_IF_BUTTON_POSITION_NORMAL_Y));

  // Flags that can hide a button entirely even with a valid position:
  // a hero ability on a non-hero unit, or an item ability, shows nothing.
  t.report('heroAbility', BlzGetAbilityBooleanField(ab, ABILITY_BF_HERO_ABILITY) ? 1 : 0);
  t.report('itemAbility', BlzGetAbilityBooleanField(ab, ABILITY_BF_ITEM_ABILITY) ? 1 : 0);
  t.report('checkDeps', BlzGetAbilityBooleanField(ab, ABILITY_BF_CHECK_DEPENDENCIES) ? 1 : 0);
  // Clear them at runtime and see whether the button appears in the screenshot.
  BlzSetAbilityBooleanField(ab, ABILITY_BF_HERO_ABILITY, false);
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
