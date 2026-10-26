import { registerTest, TestReporter } from './testkit';
import { Units } from '@objectdata/units';
import { beginNewRun, loadTerrain, loadInterRoundLobby, loadBossBattlefield } from './terrain/load';
import { armChallenge, clearChallenges, isChallengeArmed, getArmedChallenge } from './challenges';
import { CH_DASH, CH_SOLO_TOOLS, noteDash } from './challengeList';
import { challengeUIState, initChallengeUI } from './challengeUI';
import { isBossFightWatched, startBossFight } from './bossArena';
import { getHumanPlayers, forEachUnitInWorld, forEachUnitOfPlayer } from './util';
import { AXE_ID, PICKAXE_ID, PEASANT_ID, BOSS_ID, BOSS_ADD_ID } from './constants';

/**
 * Four systems that used to poll on the global tick now run on events. What
 * separates the two is WHEN the reaction lands, so each case below is read in
 * the same frame as the event, or one frame later where the code deliberately
 * waits a frame -- never after a wait long enough for a poll to have caught up.
 */

function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

/** A frame, give or take: long enough for nextFrame, far shorter than the
 *  half-second tick these systems used to ride. */
const ONE_FRAME = 0.05;

// --- the challenge board --------------------------------------------------

function runBoardEvents(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  initChallengeUI();
  armChallenge(CH_DASH);
  // Same frame: armed means shown.
  expect(t, 'shownOnArm', challengeUIState().title === 'Challenge' ? 1 : 0, 1);
  const before = challengeUIState().progress;
  noteDash();
  const after = challengeUIState().progress;
  t.report('progressBefore', before);
  t.report('progressAfter', after);
  // Same frame: the counter moving IS the redraw.
  expect(t, 'redrawnOnCount', before !== after ? 1 : 0, 1);
  clearChallenges();
  expect(t, 'hiddenOnClear', challengeUIState().title === '' ? 1 : 0, 1);
  t.done();
}
registerTest('boardevents', runBoardEvents);

// --- the dealer's preview -------------------------------------------------

function firstUnitOfType(typeId: number): unit | null {
  let found: unit | null = null;
  forEachUnitInWorld(u => { if (found == null && GetUnitTypeId(u) === typeId) found = u; });
  return found;
}

function runDealerSelect(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  const dealer = firstUnitOfType(FourCC(Units.TombOfRelics));
  const me = getHumanPlayers()[0].handle;
  let peasant: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (peasant == null && GetUnitTypeId(u) === PEASANT_ID) peasant = u; });
  expect(t, 'dealerFound', dealer != null ? 1 : 0, 1);
  expect(t, 'peasantFound', peasant != null ? 1 : 0, 1);
  if (dealer == null || peasant == null) { t.done(); return; }

  // Selection events are synced like any player input, so they land a little
  // after the call that caused them. The test waits for each reaction, frame by
  // frame, and reports how long it took -- that is latency, not polling in the
  // game: the game itself only acts when the event arrives.
  SelectUnitForPlayerSingle(dealer, me);
  waitFor(t, () => challengeUIState().previewing, 1.0, (ok, waited) => {
    t.report('selectLatency', waited);
    expect(t, 'previewOnSelect', ok ? 1 : 0, 1);
    SelectUnitForPlayerSingle(peasant!, me);
    waitFor(t, () => !challengeUIState().previewing, 1.0, (ok2, waited2) => {
      t.report('deselectLatency', waited2);
      expect(t, 'previewClearedOnDeselect', ok2 ? 1 : 0, 1);
      t.done();
    });
  });
}

/** Wait, a frame at a time, for `cond` -- up to `limit` seconds. */
function waitFor(
  t: TestReporter, cond: () => boolean, limit: number,
  then: (ok: boolean, waited: number) => void,
): void {
  let waited = 0;
  const step = (): void => {
    if (cond()) { then(true, waited); return; }
    if (waited >= limit) { then(false, waited); return; }
    waited += ONE_FRAME;
    t.after(ONE_FRAME, step);
  };
  step();
}
registerTest('dealerselect', runDealerSelect);

// --- the boss fight's endings ---------------------------------------------

function killAll(filter: (u: unit) => boolean): number {
  const doomed: unit[] = [];
  forEachUnitInWorld(u => { if (filter(u) && GetWidgetLife(u) > 0.405) doomed.push(u); });
  for (const u of doomed) {
    SetUnitInvulnerable(u, false);
    KillUnit(u);
  }
  return doomed.length;
}

function isEnemy(u: unit): boolean {
  const id = GetUnitTypeId(u);
  return id === BOSS_ID || id === BOSS_ADD_ID;
}

function isParty(u: unit): boolean {
  for (const p of getHumanPlayers()) if (GetOwningPlayer(u) === p.handle) return true;
  return false;
}

function runBossEnding(t: TestReporter): void {
  beginNewRun();
  // Both halves, as the victory callback does: loading lays the arena down,
  // starting the fight stands the boss and party up and begins watching.
  loadBossBattlefield();
  startBossFight();
  expect(t, 'watchingAtStart', isBossFightWatched() ? 1 : 0, 1);

  // Nothing dies: the fight must stay on. The old version needed a three-second
  // grace to survive this; an event version has nothing to react to.
  t.after(3, () => {
    expect(t, 'stillOnWithNoDeaths', isBossFightWatched() ? 1 : 0, 1);

    // Victory: everything hostile dies.
    t.report('enemiesKilled', killAll(isEnemy));
    t.after(ONE_FRAME * 4, () => {
      expect(t, 'endedOnVictory', isBossFightWatched() ? 1 : 0, 0);

      // Defeat: a fresh fight, and the party dies instead.
      beginNewRun();
      loadBossBattlefield();
      startBossFight();
      expect(t, 'watchingSecondFight', isBossFightWatched() ? 1 : 0, 1);
      t.report('partyKilled', killAll(isParty));
      t.after(ONE_FRAME * 4, () => {
        expect(t, 'endedOnDefeat', isBossFightWatched() ? 1 : 0, 0);
        t.done();
      });
    });
  });
}
registerTest('bossending', runBossEnding);

// --- Union Rules ----------------------------------------------------------

function runUnionRules(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  armChallenge(CH_SOLO_TOOLS);
  const me = getHumanPlayers()[0];
  const a = CreateUnit(me.handle, PEASANT_ID, 0, 0, 0)!;
  const b = CreateUnit(me.handle, PEASANT_ID, 64, 0, 0)!;

  // Different tools: allowed.
  UnitAddItem(a, CreateItem(AXE_ID, 0, 0)!);
  UnitAddItem(b, CreateItem(PICKAXE_ID, 0, 0)!);
  t.after(ONE_FRAME, () => {
    const allowed = getArmedChallenge();
    t.report('progressAfterDifferentTools', allowed != null && allowed.progress != null ? allowed.progress() : '-');
    expect(t, 'differentToolsAllowed', isChallengeArmed(CH_SOLO_TOOLS)
      && allowed != null && allowed.progress != null && allowed.progress() === 'No tool shared yet' ? 1 : 0, 1);

    // The same tool in two hands, arriving by script UnitAddItem -- the path
    // the give/take system uses, and the one most worth proving fires pickup.
    UnitAddItem(b, CreateItem(AXE_ID, 64, 0)!);
    t.after(ONE_FRAME, () => {
      const def = getArmedChallenge();
      const text = def != null && def.progress != null ? def.progress() : '-';
      t.report('progressAfterSharing', text);
      expect(t, 'sharingCaughtOnPickup', text === 'Tool shared - failed' ? 1 : 0, 1);
      t.done();
    });
  });
}
registerTest('unionrules', runUnionRules);
