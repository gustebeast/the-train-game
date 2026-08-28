import { Trigger } from 'w3ts';
import { gameState, syncState } from './state';
import { REROLL_ITEM_ID, REROLL_ABILITY_ID } from './constants';
import { rerollInterRoundLobbyHero } from './heroes';
import { rerollInterRoundLobbyMerc } from './mercenary';
import { restartDPSTest } from './creeps';
import { nextFrame, forEachUnitInWorld } from './util';

const REROLL_COST = 1;

/** Classic tome-consume burst: the tome item model's death animation. */
const TOME_EFFECT = 'Objects\\InventoryItems\\TomeRed\\TomeRed.mdl';

/**
 * Hero Reroll item lifecycle. Purchase and refund both move the SHARED gold
 * (gameState.gold + syncState), matching how every shop purchase works —
 * native per-player gold changes from the shop UI are overwritten by the
 * sync. The item itself stays in the buyer's inventory (not a powerup) until
 * cast on an inter-round lobby hero or pawned back to the shop.
 */
export function initReroll(): void {
  // Purchase: charge shared gold, or swallow the item if it can't be afforded
  const buyTrigger = Trigger.create();
  buyTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SELL_ITEM);
  buyTrigger.addAction(() => {
    const item = GetSoldItem();
    if (item == null || GetItemTypeId(item) !== REROLL_ITEM_ID) return;
    if (gameState.gold < REROLL_COST) {
      RemoveItem(item);
      print('Not enough gold for a Hero Reroll.');
      return;
    }
    gameState.gold -= REROLL_COST;
    syncState();
  });

  // Refund: pawning the item back grants the gold to everyone (shared gold)
  const pawnTrigger = Trigger.create();
  pawnTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_PAWN_ITEM);
  pawnTrigger.addAction(() => {
    const item = GetSoldItem();
    if (item == null || GetItemTypeId(item) !== REROLL_ITEM_ID) return;
    RemoveItem(item); // don't leave it in the shop's pawn inventory
    gameState.gold += REROLL_COST;
    syncState();
    print('Hero Reroll refunded.');
  });

  // Cast: swap the targeted inter-round lobby hero for a random new one
  const castTrigger = Trigger.create();
  castTrigger.registerAnyUnitEvent(EVENT_PLAYER_UNIT_SPELL_EFFECT);
  castTrigger.addAction(() => {
    if (GetSpellAbilityId() !== REROLL_ABILITY_ID) return;
    const target = GetSpellTargetUnit();
    if (target == null) return;
    const x = GetUnitX(target);
    const y = GetUnitY(target);

    // One item for both: try the heroes, then the mercenary standing with them.
    if (rerollInterRoundLobbyHero(target) || rerollInterRoundLobbyMerc(target)) {
      // The lobby is sparring with the roster that just changed, and the result
      // scales the round about to be played. Measuring the hero you rerolled
      // away is worse than not measuring at all, because the number looks
      // exactly like a good one.
      restartDPSTest();
      // The cast is based on Wand of Illusion purely because it is an item
      // ability that always accepts a friendly unit -- Purge, the obvious
      // choice, refuses a target with nothing to dispel. Its actual effect is
      // unwanted: it leaves a duplicate of the unit we just replaced, holding
      // a copy of the gear. The illusion is created after this handler runs,
      // so sweep on the next frame. Nothing else in the map makes illusions.
      nextFrame(() => {
        forEachUnitInWorld(u => {
          if (IsUnitIllusion(u)) RemoveUnit(u);
        });
      });
      const sfx = AddSpecialEffect(TOME_EFFECT, x, y);
      if (sfx != null) DestroyEffect(sfx);
    } else {
      // Not an inter-round lobby hero — the cast already consumed the item's charge, so
      // hand a fresh one back
      print('Hero Reroll can only target the heroes in the inter-round lobby.');
      const caster = GetTriggerUnit();
      if (caster != null && GetUnitTypeId(caster) !== 0) {
        UnitAddItem(caster, CreateItem(REROLL_ITEM_ID, GetUnitX(caster), GetUnitY(caster))!);
      }
    }
  });
}
