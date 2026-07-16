import { Item, Timer, Trigger, Unit } from 'w3ts';
import { Players } from 'w3ts/globals';
import { AXE_ID, PICKAXE_ID, TRACK_PIECE_ID, BUCKET_ID, BUCKET_FULL_ID, PEASANT_ID } from './constants';
import { updateCarryingVisual } from './carrying';
import { getNeutralPassive } from './teams';
import { getWorldBounds } from './util';

const RESULT_FILE = 'TheTrainGame/damage_test.txt';

interface Phase {
  label: string;
  itemId: number | null;
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
    { label: 'empty', itemId: null },
    { label: 'axe', itemId: AXE_ID },
    { label: 'pickaxe', itemId: PICKAXE_ID },
    { label: 'track', itemId: TRACK_PIECE_ID },
    { label: 'bucket', itemId: BUCKET_ID },
    { label: 'fullbucket', itemId: BUCKET_FULL_ID },
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

    // Small settle delay, then order the attack and wait for one hit
    Timer.create().start(0.3, false, () => {
      awaitingHit = true;
      const accepted = IssueTargetOrder(attacker.handle, 'attack', dummy.handle);
      if (!accepted) {
        print('damage test: ' + phase.label + ' attack order REJECTED');
      }
    });

    // Failsafe: no hit within 5s -> record the stall and move on
    Timer.create().start(5.3, false, () => {
      if (phaseIdx === myIdx && awaitingHit) {
        awaitingHit = false;
        results.push(phase.label + '=timeout');
        print('damage test: ' + phase.label + ' timed out waiting for a hit');
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
  nextPhase();
}
