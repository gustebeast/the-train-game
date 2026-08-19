import { MapPlayer, Trigger } from 'w3ts';
import { registerTest, TestReporter } from './testkit';
import { getHumanPlayers } from './util';

/** Count a player's living units. Mirrors how playerLeave.ts enumerates, and
 *  filters on life > 0 because that system uses KillUnit (not RemoveUnit), so a
 *  despawned unit still exists briefly as a corpse. */
function aliveUnits(p: MapPlayer): number {
  const g = CreateGroup()!;
  GroupEnumUnitsOfPlayer(g, p.handle, null!);
  let n = 0;
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (u != null && GetUnitState(u, UNIT_STATE_LIFE) > 0) {
      n += 1;
    }
  });
  DestroyGroup(g);
  return n;
}

/** Verify that when a player leaves, their units are despawned.
 *
 *  This CANNOT run in single player — it needs a second real player who can
 *  quit. Run it in a LAN game across two VMs (see scripts/vmtest): host on one,
 *  join on the other, start, then quit on the joiner. Read the results from the
 *  HOST, which is the machine still running.
 *
 *  Reports, from the host's point of view:
 *    players            how many humans were in the game at start
 *    startPn            each player's living unit count at start (sanity: > 0)
 *    leaverId           which player id left
 *    leaverAtEvent      leaver's living units when EVENT_PLAYER_LEAVE fired
 *    leaverAfter        leaver's living units once the despawn has settled
 *    stayerAfter        a remaining player's count, to prove we didn't kill
 *                       everyone indiscriminately
 *
 *  leaverAfter == 0 with stayerAfter > 0 is the pass condition. */
function runLeaveTest(t: TestReporter): void {
  const humans = getHumanPlayers();
  t.report('players', humans.length);
  for (const p of humans) {
    t.report('startP' + p.id, aliveUnits(p));
  }
  if (humans.length < 2) {
    // Fail loudly rather than sit until the harness times out: a single-player
    // run can never exercise this, and that is a setup mistake worth naming.
    t.fail('players', 'need 2+ humans (LAN); this looks like a single-player run');
    t.done();
    return;
  }

  const trig = Trigger.create();
  for (const p of humans) {
    TriggerRegisterPlayerEvent(trig.handle, p.handle, EVENT_PLAYER_LEAVE);
  }
  trig.addAction(t.guard(() => {
    const leaver = MapPlayer.fromEvent();
    if (leaver == null) return;
    t.report('leaverId', leaver.id);
    t.report('leaverAtEvent', aliveUnits(leaver));
    // Sample after playerLeave.ts has run its kill plus its next-frame sweep.
    // Two seconds is well clear of both and still inside any sane timeout.
    t.after(2, () => {
      t.report('leaverAfter', aliveUnits(leaver));
      for (const p of getHumanPlayers()) {
        if (p.id !== leaver.id) {
          t.report('stayerAfter', aliveUnits(p));
          break;
        }
      }
      t.done();
    });
  }));

  // The quit is driven by hand from the host script, so allow generous time --
  // but never hang forever, or the harness reports a timeout with no diagnosis.
  t.after(240, () => {
    t.fail('leave', 'no player left within 240s');
    t.done();
  });
}

registerTest('leave', runLeaveTest);
