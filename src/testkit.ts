import { Timer, Trigger } from 'w3ts';
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

export interface TestReporter {
  /** Record a measurement. Rewrites the file immediately, so a test that
   *  stalls half way still leaves its partial results behind to diagnose. */
  report(key: string, value: string | number): void;
  /** Record a failure for one key and keep going. */
  fail(key: string, reason: string): void;
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
    report: (key, value) => {
      const text = typeof value === 'number' ? string.format('%.2f', value) : value;
      push(key + '=' + text);
    },
    fail: (key, reason) => push(key + '=FAIL ' + reason),
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
  tests.push({ name, run });
}

/** Wire up the `-test <name>` chat commands and announce readiness.
 *  Call once from main.ts after all test modules have been imported. */
export function initTestKit(): void {
  for (const test of tests) {
    const trigger = Trigger.create();
    Players.forEach(p => {
      TriggerRegisterPlayerChatEvent(trigger.handle, p.handle, '-test ' + test.name, true);
    });
    trigger.addAction(() => {
      // Re-entrancy guard: the runner may retry the chat command if it thinks
      // the first one was swallowed, and tests spawn units, so running one
      // twice concurrently would corrupt both sets of results.
      if (running != null) {
        print('testkit: ' + running + ' still running, ignoring ' + test.name);
        return;
      }
      running = test.name;
      const reporter = createReporter(test.name);
      const originalDone = reporter.done;
      reporter.done = () => {
        originalDone();
        running = null;
      };
      // WC3 swallows errors thrown inside trigger actions, which would leave
      // the harness waiting out its full timeout with no idea why. Turn a
      // crash into a reported failure instead.
      try {
        test.run(reporter);
      } catch (e) {
        reporter.fail('error', tostring(e));
        reporter.done();
      }
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
  Timer.create().start(0.5, false, () => {
    writeFile(READY_FILE, names);
  });
}
