import { Timer, Trigger } from 'w3ts';
import { loadInterRoundLobby } from './terrain/load';
import { stopGameplay } from './train';
import { Players } from 'w3ts/globals';

/** In-map half of the automated test harness.
 *
 *  A test is a function that measures something and reports `key=value` lines.
 *  The host-side runner (scripts/vmtest) boots the map in a VM, waits for the
 *  ready marker, sends `-test <name>`, then reads the result file back out.
 *
 *  Writing a new test is two steps:
 *
 *    // src/mytest.ts
 *    import { registerTest } from './testkit';
 *    registerTest('mystuff', t => {
 *      t.report('someValue', 42);
 *      t.done();                       // <- always finish, even on failure
 *    });
 *
 *    // src/main.ts, before initTestKit()
 *    import './mytest';
 *
 *  Then from the host:  Invoke-MapTest -Test mystuff
 *
 *  Files land in Documents\Warcraft III\CustomMapData\TheTrainGame\.
 *  Everything is written through Preload, which is the only way a running map
 *  can put bytes on disk. */

const READY_FILE = 'TheTrainGame/test_ready.txt';

function resultFileFor(name: string): string {
  return 'TheTrainGame/test_' + name + '.txt';
}

/** Write lines to a CustomMapData file. WC3 creates no file at all for an
 *  empty Preload batch, so callers must always pass at least one line. */
function writeFile(path: string, lines: string[]): void {
  PreloadGenClear();
  PreloadGenStart();
  for (const line of lines) {
    Preload(line);
  }
  PreloadGenEnd(path);
}

/** Put the map in the LOBBY, the way the -load cheat does but without needing a
 *  save file. Features that exist only in the inter-round lobby (the shop, hero display, the Hero Reroll)
 *  cannot be exercised from the gameplay area, and every test that needs them
 *  would otherwise hand-roll the same two calls. Call it first in such a test;
 *  the inter-round lobby finishes building on the following frames, so do your setup from
 *  `t.after(...)` rather than inline. */
export function enterInterRoundLobby(): void {
  stopGameplay();
  loadInterRoundLobby();
}

export interface TestReporter {
  /** Record a measurement. Rewrites the file immediately, so a test that
   *  stalls half way still leaves its partial results behind to diagnose. */
  report(key: string, value: string | number): void;
  /** Record a failure for one key and keep going. */
  fail(key: string, reason: string): void;
  /** Record a measurement AND hold it to a value. Reports either way, so a
   *  failure still shows what was actually seen.
   *
   *  Prefer this to report() for anything the test has an opinion about. A
   *  reported number nobody checks is a test that cannot fail, which reads as a
   *  pass forever -- the way `fog` and `night` did, and the way dpsprobe's
   *  bought path did before it was asserted. */
  expect(key: string, actual: number | string, expected: number | string): void;
  /** Mark the run complete. The runner waits for this before reading results,
   *  so a test that never calls done() will be reported as a timeout. */
  done(): void;
  /** Run `fn` after `delay` seconds. Always prefer this over a raw Timer:
   *  WC3 silently swallows anything thrown inside a timer callback, so a bug
   *  in `fn` would otherwise hang the test until the harness times out with no
   *  clue why. Errors here are reported and end the run. */
  after(delay: number, fn: (this: void) => void): void;
  /** Wrap a callback (trigger action, etc.) so a throw inside it is reported
   *  rather than silently swallowed. */
  guard(fn: (this: void) => void): (this: void) => void;
}

/** How a measurement is written down. Shared by report and expect so a value
 *  and the expectation it failed against are always formatted the same way. */
function asText(value: number | string): string {
  return typeof value === 'number' ? string.format('%.2f', value) : value;
}

function createReporter(name: string): TestReporter {
  const file = resultFileFor(name);
  // 'started' doubles as the non-empty first line Preload requires.
  const lines: string[] = ['started'];
  let finished = false;
  writeFile(file, lines);

  const push = (line: string): void => {
    if (finished) {
      print('testkit: ' + name + ' reported after done(): ' + line);
      return;
    }
    lines.push(line);
    print('test ' + name + ': ' + line);
    writeFile(file, lines);
  };

  const reporter: TestReporter = {
    report: (key, value) => push(key + '=' + asText(value)),
    fail: (key, reason) => push(key + '=FAIL ' + reason),
    expect: (key, actual, expected) => {
      if (asText(actual) === asText(expected)) {
        reporter.report(key, actual);
        return;
      }
      reporter.fail(key, 'expected ' + asText(expected) + ', got ' + asText(actual));
    },
    done: () => {
      if (finished) return;
      lines.push('done');
      finished = true;
      writeFile(file, lines);
      print('test ' + name + ': complete -> ' + file);
    },
    guard: fn => () => {
      try {
        fn();
      } catch (e) {
        reporter.fail('error', tostring(e));
        reporter.done();
      }
    },
    after: (delay, fn) => {
      Timer.create().start(delay, false, reporter.guard(fn));
    },
  };
  return reporter;
}

// `this: void` on every callback type is load-bearing, not decoration.
// Without it typescript-to-lua emits `test:run(reporter)` -- a method call that
// passes the registration object as the first argument, so the test body
// receives that instead of its reporter and every t.* call blows up with
// "attempt to call a nil value". Keep it on any function type stored and
// called back later.
interface RegisteredTest {
  name: string;
  run: (this: void, reporter: TestReporter) => void;
}

const tests: RegisteredTest[] = [];
let running: string | null = null;

/** Register a test, runnable in-game via `-test <name>`. Call at module scope;
 *  import the module from main.ts so registration happens before initTestKit. */
export function registerTest(name: string, run: (this: void, reporter: TestReporter) => void): void {
  // A duplicate name used to be silent, and `find` below returns whichever was
  // registered first -- so the second test simply never ran, while the runner
  // happily reported a PASS full of the FIRST test's measurements. That is the
  // worst kind of green: it looks like your test passed. Refuse instead.
  if (tests.find(t => t.name === name) != null) {
    print('|cffff8080testkit: two tests are named "' + name + '"|r -- rename one, '
      + 'or the second never runs, and its reported results are the first one instead.');
    return;
  }
  tests.push({ name, run });
}

/** Start a registered test by name. Shared by the `-test` chat command and by
 *  autoRun, so both get the same re-entrancy guard and crash handling. */
function startTest(name: string): void {
  const test = tests.find(t => t.name === name);
  if (test == null) {
    print('testkit: no test named ' + name);
    return;
  }
  // Re-entrancy guard: the runner may retry the chat command if it thinks the
  // first one was swallowed, and tests spawn units, so running one twice
  // concurrently would corrupt both sets of results. This also makes the
  // runner's chat command harmless when autoRun already started the same test.
  if (running != null) {
    print('testkit: ' + running + ' still running, ignoring ' + name);
    return;
  }
  running = name;
  const reporter = createReporter(name);
  const originalDone = reporter.done;
  reporter.done = () => {
    originalDone();
    running = null;
  };
  // WC3 swallows errors thrown inside trigger actions, which would leave the
  // harness waiting out its full timeout with no idea why. Turn a crash into a
  // reported failure instead.
  try {
    test.run(reporter);
  } catch (e) {
    reporter.fail('error', tostring(e));
    reporter.done();
  }
}

/** Wire up the `-test <name>` chat commands and announce readiness.
 *  Call once from main.ts after all test modules have been imported.
 *
 *  Pass `autoRun` to start that test as soon as play begins, with no chat
 *  command at all: `initTestKit('damage')`. Typing the command over VNC is the
 *  most fragile step in a run — WC3 samples the keyboard once per render frame,
 *  so fast input transposes characters — and autoRun removes it entirely. Build
 *  your own branch with it set while iterating on one test; leave it off for
 *  the shared map so `-test <name>` still selects a test. */
export function initTestKit(autoRun?: string): void {
  for (const test of tests) {
    const trigger = Trigger.create();
    Players.forEach(p => {
      TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, '-test ' + test.name, true);
    });
    trigger.addAction(() => {
      startTest(test.name);
    });
  }

  // The runner polls for this to know the map is live and accepting chat.
  //
  // It must be written from a TIMER, not inline. init runs while the game is
  // still paused behind the "press any key to continue" screen, so a marker
  // written here appears seconds before the game is actually running — the
  // runner would then stop dismissing that screen and fire its chat command
  // into a paused game, where no timer ever advances and every test hangs
  // after its first line. Game timers only tick once play begins, so this
  // fires at exactly the right moment.
  const names: string[] = ['ready'];
  for (const test of tests) {
    names.push(test.name);
  }
  // Tell the runner the map starts its own test, so it does not type a chat
  // command the map does not need. Typing over VNC is the slowest and least
  // reliable step in a run, and with autoRun set it is pure waste: the test has
  // already begun by the time the command could land.
  if (autoRun != null) {
    names.push('autorun=' + autoRun);
  }
  Timer.create().start(0.5, false, () => {
    writeFile(READY_FILE, names);
    // Same reason this marker is on a timer: init runs while the game is still
    // paused, and a test started there would sit in a world where no timer ever
    // advances. Starting here means play has genuinely begun.
    if (autoRun != null) {
      startTest(autoRun);
    }
  });
}
