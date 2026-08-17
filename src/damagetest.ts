import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Abilities } from '@objectdata/abilities';
import { AXE_ID, PICKAXE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID, PEASANT_ID } from './constants';
import { updateCarryingVisual } from './carrying';
import { getNeutralPassive } from './teams';
import { getWorldBounds } from './util';
import { registerTest, TestReporter } from './testkit';

interface Phase {
  label: string;
  itemId: number | null;
  /** Attachment ability the carrying system should have granted for this item */
  abilityId: number | null;
}

/** Measure the peasant's actual per-hit damage while holding each tool item.
 *  All tools should read exactly the peasant's base damage — any extra is a
 *  leaked stat bonus from the attachment abilities. */
function runDamageTest(t: TestReporter): void {
  const phases: Phase[] = [
    { label: 'empty', itemId: null, abilityId: null },
    { label: 'axe', itemId: AXE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus7) },
    { label: 'pickaxe', itemId: PICKAXE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus8) },
    { label: 'track', itemId: TRACK_PIECE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus10) },
    { label: 'bucket', itemId: BUCKET_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus2) },
    { label: 'fullbucket', itemId: BUCKET_FULL_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus4) },
  ];

  // Corner of the map, away from lobby/gameplay entities
  const bounds = getWorldBounds();
  const x = GetRectMaxX(bounds) - 400;
  const y = GetRectMaxY(bounds) - 400;

  const attacker = Unit.create(Players[0], PEASANT_ID, x, y, 0)!;
  const dummy = Unit.create(getNeutralPassive(), PEASANT_ID, x + 128, y, 180)!;
  // Peasants have InvulnerableNeutral in their object data (players can't be
  // hurt); the dummy must lose it or it can't even be targeted. Don't pause it
  // (paused units can't be acquired as attack targets) — zero move speed keeps
  // it from fleeing instead.
  UnitRemoveAbility(dummy.handle, FourCC('Avul'));
  BlzSetUnitMaxHP(dummy.handle, 100000);
  SetUnitState(dummy.handle, UNIT_STATE_LIFE, 100000);
  SetUnitMoveSpeed(dummy.handle, 0);

  // Spawn nudging can scatter the pair across unpathable corner terrain where
  // no path exists and attack orders silently abort. Force exact adjacent
  // positions (within melee reach) so no walking is ever needed.
  const placeUnits = (): void => {
    SetUnitX(attacker.handle, x);
    SetUnitY(attacker.handle, y);
    SetUnitX(dummy.handle, x + 64);
    SetUnitY(dummy.handle, y);
  };
  placeUnits();

  let phaseIdx = -1;
  let awaitingHit = false;

  const damageTrig = Trigger.create();
  TriggerRegisterUnitEvent(damageTrig.handle, dummy.handle, EVENT_UNIT_DAMAGED);

  const finish = (): void => {
    DestroyTrigger(damageTrig.handle);
    attacker.destroy();
    dummy.destroy();
    t.done();
  };

  const nextPhase = (): void => {
    phaseIdx += 1;
    if (phaseIdx >= phases.length) {
      finish();
      return;
    }
    const phase = phases[phaseIdx];
    const myIdx = phaseIdx;

    // Swap held item; addItem/removeItem fire the pickup/drop triggers, but
    // call updateCarryingVisual directly too so the test can't miss the path.
    const held = attacker.getItemInSlot(0);
    if (held != null) {
      attacker.removeItem(held);
      held.destroy();
    }
    if (phase.itemId != null) {
      const item = Item.create(phase.itemId, x, y)!;
      attacker.addItem(item);
      const nowHeld = attacker.getItemInSlot(0);
      if (nowHeld == null || nowHeld.typeId !== phase.itemId) {
        t.fail(phase.label, 'item did not attach');
        nextPhase();
        return;
      }
    }
    updateCarryingVisual(attacker);

    // Readiness is deterministic: the carrying system's attachment ability
    // must be present (or absent for the empty phase) immediately after the
    // synchronous item swap. No settle delay needed — verify and go.
    if (phase.abilityId != null && GetUnitAbilityLevel(attacker.handle, phase.abilityId) === 0) {
      t.fail(phase.label, 'carry ability missing after pickup');
      nextPhase();
      return;
    }

    // Issue the attack, and re-issue it a few times. The very first attack of a
    // fresh unit can fizzle on target acquisition or die to attack backswing,
    // which used to time out the 'empty' phase intermittently. Re-placing the
    // units and re-ordering every second until the hit lands makes it reliable
    // without slowing the happy path (the hit usually lands on the first order).
    let orderAccepted = false;
    const issueAttack = (): void => {
      if (phaseIdx !== myIdx || !awaitingHit) return;
      placeUnits();
      orderAccepted = IssueTargetOrder(attacker.handle, 'attack', dummy.handle);
      if (!orderAccepted) {
        print('damage test: ' + phase.label + ' attack order REJECTED');
      }
    };
    t.after(0, () => {
      awaitingHit = true;
      issueAttack();
    });
    t.after(1.5, issueAttack);
    t.after(3, issueAttack);
    t.after(4.5, issueAttack);

    // Failsafe: no hit within 6s -> record the stall (with diagnostics) and move on
    t.after(6, () => {
      if (phaseIdx === myIdx && awaitingHit) {
        awaitingHit = false;
        const diag = 'order=' + (orderAccepted ? 'ok' : 'rejected')
          + ' atk=(' + string.format('%.0f', attacker.x) + ',' + string.format('%.0f', attacker.y)
          + ' hp ' + string.format('%.0f', GetUnitState(attacker.handle, UNIT_STATE_LIFE))
          + ') dum=(' + string.format('%.0f', dummy.x) + ',' + string.format('%.0f', dummy.y)
          + ' hp ' + string.format('%.0f', GetUnitState(dummy.handle, UNIT_STATE_LIFE)) + ')';
        t.fail(phase.label, 'timeout ' + diag);
        IssueImmediateOrder(attacker.handle, 'stop');
        nextPhase();
      }
    });
  };

  damageTrig.addAction(t.guard(() => {
    if (!awaitingHit) return;
    const source = GetEventDamageSource();
    if (source !== attacker.handle) return;
    awaitingHit = false;
    t.report(phases[phaseIdx].label, GetEventDamage());
    IssueImmediateOrder(attacker.handle, 'stop');
    nextPhase();
  }));

  nextPhase();
}

registerTest('damage', runDamageTest);
