import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { Abilities } from '@objectdata/abilities';
import { AXE_ID, PICKAXE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID, PEASANT_ID } from './constants';
import { updateCarryingVisual } from './carrying';
import { getNeutralPassive } from './teams';
import { getWorldBounds } from './util';

const RESULT_FILE = 'TheTrainGame/damage_test.txt';

interface Phase {
  label: string;
  itemId: number | null;
  /** Attachment ability the carrying system should have granted for this item */
  abilityId: number | null;
}

let testRunning = false;

/** Measure the peasant's actual per-hit damage while holding each tool item,
 *  print the results and write them to CustomMapData for automated checks.
 *  All tools should read exactly the peasant's base damage (5) — any extra is
 *  a leaked stat bonus from the attachment abilities. */
export function runDamageTest(): void {
  if (testRunning) {
    print('Damage test already running.');
    return;
  }
  testRunning = true;

  const phases: Phase[] = [
    { label: 'empty', itemId: null, abilityId: null },
    { label: 'axe', itemId: AXE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus7) },
    { label: 'pickaxe', itemId: PICKAXE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus8) },
    { label: 'track', itemId: TRACK_PIECE_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus10) },
    { label: 'bucket', itemId: BUCKET_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus2) },
    { label: 'fullbucket', itemId: BUCKET_FULL_ID, abilityId: FourCC(Abilities.ItemDamageBonusPlus4) },
  ];
  const results: string[] = [];

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

  // Write current progress to CustomMapData; called after every phase so a
  // stalled run still leaves partial results to diagnose.
  const writeResults = (): void => {
    PreloadGenClear();
    PreloadGenStart();
    for (const line of results) {
      Preload(line);
    }
    PreloadGenEnd(RESULT_FILE);
  };

  const finish = (): void => {
    DestroyTrigger(damageTrig.handle);
    attacker.destroy();
    dummy.destroy();
    results.push('done');
    writeResults();
    print('Damage test complete. Results written to ' + RESULT_FILE);
    testRunning = false;
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
        results.push(phase.label + '=item-not-held');
        print('damage test: ' + phase.label + ' item did not attach');
        writeResults();
        nextPhase();
        return;
      }
    }
    updateCarryingVisual(attacker);

    // Readiness is deterministic: the carrying system's attachment ability
    // must be present (or absent for the empty phase) immediately after the
    // synchronous item swap. No settle delay needed — verify and go.
    if (phase.abilityId != null && GetUnitAbilityLevel(attacker.handle, phase.abilityId) === 0) {
      results.push(phase.label + '=carry-ability-missing');
      print('damage test: ' + phase.label + ' carry ability missing after pickup');
      writeResults();
      nextPhase();
      return;
    }

    // Issue the attack on the next game tick (re-entrancy safety only: this
    // may be running inside the previous phase's damage event).
    let orderAccepted = false;
    Timer.create().start(0, false, () => {
      awaitingHit = true;
      placeUnits();
      orderAccepted = IssueTargetOrder(attacker.handle, 'attack', dummy.handle);
      if (!orderAccepted) {
        print('damage test: ' + phase.label + ' attack order REJECTED');
      }
    });

    // Failsafe: no hit within 4s -> record the stall (with diagnostics) and move on
    Timer.create().start(4, false, () => {
      if (phaseIdx === myIdx && awaitingHit) {
        awaitingHit = false;
        const diag = 'order=' + (orderAccepted ? 'ok' : 'rejected')
          + ' atk=(' + string.format('%.0f', attacker.x) + ',' + string.format('%.0f', attacker.y)
          + ' hp ' + string.format('%.0f', GetUnitState(attacker.handle, UNIT_STATE_LIFE))
          + ') dum=(' + string.format('%.0f', dummy.x) + ',' + string.format('%.0f', dummy.y)
          + ' hp ' + string.format('%.0f', GetUnitState(dummy.handle, UNIT_STATE_LIFE)) + ')';
        results.push(phase.label + '=timeout ' + diag);
        print('damage test: ' + phase.label + ' timed out. ' + diag);
        writeResults();
        IssueImmediateOrder(attacker.handle, 'stop');
        nextPhase();
      }
    });
  };

  damageTrig.addAction(() => {
    if (!awaitingHit) return;
    const source = GetEventDamageSource();
    if (source !== attacker.handle) return;
    awaitingHit = false;
    const dmg = GetEventDamage();
    const line = phases[phaseIdx].label + '=' + string.format('%.2f', dmg);
    results.push(line);
    print('damage test: ' + line);
    writeResults();
    IssueImmediateOrder(attacker.handle, 'stop');
    nextPhase();
  });

  print('Damage test starting...');
  // Write the results file right away: it doubles as a "map is ready" marker
  // for external harnesses, which can stop input-spamming once it exists.
  // Must contain at least one line — WC3 creates no file for an empty Preload.
  results.push('started');
  writeResults();
  nextPhase();
}
