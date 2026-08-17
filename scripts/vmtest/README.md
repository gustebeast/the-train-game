# Automated in-game testing

Run the map for real — in Warcraft III, in a VM — and get measurements back in
about 40 seconds. Nothing appears on the developer's desktop: no window steals
focus, no keystrokes leak into other applications.

```powershell
npm run build
powershell -File scripts/vmtest/run-test.ps1 -Test damage
```

```
[   0.0s] reset shared -> create-game-v2
[  17.0s] start match
[  29.7s] running -test damage
[  39.1s] done -- PASS

Results:
  empty          7.50
  axe            7.50
  ...
PASS (39.1s)
```

Use this whenever a question is only really answerable in-game: actual damage
dealt, whether an ability applied, what a unit's state is after some
interaction. It beats reasoning about object data, because it measures what the
engine really did.

---

## Writing a test

A test lives in `src/`, measures something, and reports `key=value` lines.

```ts
// src/mytest.ts
import { registerTest } from './testkit';

registerTest('mystuff', t => {
  const peasant = Unit.create(Players[0], PEASANT_ID, 0, 0, 0)!;
  t.report('startingHp', GetUnitState(peasant.handle, UNIT_STATE_LIFE));

  // Anything asynchronous goes through t.after, never a raw Timer.
  t.after(1, () => {
    t.report('hpAfter1s', GetUnitState(peasant.handle, UNIT_STATE_LIFE));
    peasant.destroy();
    t.done();          // required -- the runner waits for this
  });
});
```

Register the module in `src/main.ts` so it loads:

```ts
import './mytest';   // next to the existing import './damagetest'
```

Then run it:

```powershell
npm run build
powershell -File scripts/vmtest/run-test.ps1 -Test mystuff
```

`registerTest('mystuff', ...)` exposes the in-game chat command `-test mystuff`,
which is also how you drive it by hand while playing.

### The reporter

| Call | Purpose |
|---|---|
| `t.report(key, value)` | Record a measurement. Numbers are formatted to 2dp. |
| `t.fail(key, reason)` | Record a failure for one key and keep going. |
| `t.done()` | Finish the run. **Always call this**, including on failure paths. |
| `t.after(seconds, fn)` | Delayed callback, errors reported instead of swallowed. |
| `t.guard(fn)` | Wrap any other callback (e.g. a trigger action) the same way. |

Results are rewritten after every `report`, so a test that hangs half way still
leaves its partial output behind to diagnose.

### Two rules worth internalising

**Never use a bare `Timer` or unwrapped trigger action inside a test.** WC3
silently swallows anything thrown inside those callbacks. A crash then looks
exactly like a hang, and you burn a full timeout learning nothing. `t.after`
and `t.guard` turn it into a reported `error=FAIL ...` line.

**Put `this: void` on any callback type you store and call later.**
typescript-to-lua compiles `obj.fn(arg)` into the method call `obj:fn(arg)`
unless the type says otherwise, which silently shifts every argument by one.
This cost an hour; see the comment on `RegisteredTest` in `testkit.ts`.

---

## Running tests

### CLI

```powershell
powershell -File scripts/vmtest/run-test.ps1 -Test damage [-Vm dougie] [-TestTimeoutSec 120]
```

Exits non-zero on failure, so it slots straight into a check script.

### From PowerShell

```powershell
Import-Module .\scripts\vmtest\TrainVMTest.psm1 -Force
$r = Invoke-MapTest -Test damage

$r.Ok                  # $true / $false
$r.Results['axe']      # '7.50'
$r.Failures            # key -> reason, for anything that failed
$r.FailureReason       # why the run as a whole failed
$r.Raw                 # the unparsed result file
$r.Screenshot          # PNG of the guest at the end of the run
```

| Function | Purpose |
|---|---|
| `Invoke-MapTest` | The whole flow. Start here. |
| `Get-TestVm` | Resolve a VM by name. |
| `Reset-TestVm` | Revert to the snapshot and power on. |
| `Copy-MapToTestVm` | Upload a `.w3x` under a fresh unique name. |
| `Start-TestVmMatch` | Drive the menus from Create Game into a live match. |
| `Send-TestVmChat` | Type a chat command into the running game. |
| `Get-TestVmResultFile` | Read a file from the guest's CustomMapData. |
| `Get-TestVmScreenshot` | Save a PNG of the guest screen. |
| `Stop-TestVm` | Power off. Optional — the next run reverts anyway. |

### Picking a VM

Each agent has its own VM so runs never collide, and **normally you pass
nothing** — the runner reads your git branch (`agent/<name>`) and targets that
VM automatically. So from the `dougie` worktree, `run-test.ps1` uses the
`dougie` VM with no configuration.

Override only if you need to:

```powershell
$env:TRAINVM = 'boof'        # for this session, or
run-test.ps1 -Vm boof        # for one run
```

There is **no shared default** and the clone-parent base image
(`TrainGameTest`) is not a valid target — the runner refuses it. If it can't
determine your VM (e.g. run from `main`), it errors instead of guessing.

**The four agent VMs — `brenner`, `boof`, `dougie`, `murph` — are minted and
verified.** The registry lives in `vms.json`.

## Running two at once

Agents can test their own maps simultaneously — each VM is fully independent
(own disk, own snapshot, own VNC port):

```powershell
powershell -File scripts/vmtest/concurrency-test.ps1 -VmA brenner -VmB murph
```

This runs a full test on both VMs in parallel and confirms they overlapped and
both passed. Verified: 47.8s of concurrent execution, both green.

---

## How it works

Each VM holds a **live snapshot** parked on WC3's Create Game screen, in the map
list one level *above* the `Download` folder. A run then:

1. reverts to that snapshot and powers on (~15-20s) — every run starts
   identical; this is the dominant cost and is inherent to restoring the VM's
   6GB memory snapshot
2. empties the Download folder and uploads the new build **under a fresh random
   filename** (~4s, via native `vmrun` directory ops)
3. drives the menus over VNC: Download → map → Create → name → Start (~8s)
4. taps space until the map writes its ready marker — the only reliable "the
   game is live and accepting chat" signal — re-clicking START GAME if a run
   looks stuck at the lobby (~8-12s)
5. sends `-test <name>` and polls the result file until it ends with `done` (~9s)

Total ~50s. No cleanup is needed; the next revert discards everything.

### Audio is silenced at the VM level

WC3 needs an audio device to launch, but VMware pipes guest audio to the host
speakers. So each VM is minted with its sound device **disconnected at runtime**
(`vmrun disconnectNamedDevice <vmx> sound`) after WC3 is up but before the
snapshot — the device stays present (WC3 is happy) but silent, and the snapshot
freezes it that way. Reverts stay quiet. Nothing in-game or in the guest OS is
changed.

### Offline entitlement expires (~monthly re-mint)

The VMs run WC3 offline. WC3 Reforged only allows offline play for a limited
window after the last online sign-in (~30 days), so **every so often the
snapshots must be re-minted** after one online Battle.net login. Symptom when it
lapses: a freshly *minted* VM can't get past WC3's PLAY OFFLINE (the button is
dead). Existing snapshots keep working (they are frozen past that gate) — only
new minting is blocked. Fix is one login on the base, then re-mint; see
[VM-SETUP.md](VM-SETUP.md) step 8.

### Why the filename must be unique

A WC3 restored from a live snapshot **will not** load a map that overwrites a
filename it already knew about — it reports *"The map is unavailable or
corrupted"* regardless of where the file lives or when it is written. The same
process loads a map that arrives under a filename which did not exist when the
snapshot was taken, and reads its metadata correctly.

That is why `Copy-MapToTestVm` generates `ZZ<random>.w3x` every run. Do not
"optimise" this into a fixed name; that is precisely the case that fails.

### Why the ready marker comes from a timer

`initTestKit()` runs during map init, while the game is still paused behind the
"press any key to continue" screen. A marker written inline appears seconds
before the game is actually running, so the runner would stop dismissing that
screen and fire its chat command into a paused game where no timer ever
advances. Game timers only tick once play begins, so writing the marker from a
`Timer` fires it at exactly the right moment.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Map never became ready` | `initTestKit()` missing from `main.ts`, or the map threw during init. Check `$r.Screenshot`. |
| `No results for '<name>'` | Test not registered, or its module isn't imported from `main.ts`. |
| `error=FAIL attempt to call a nil value` | A callback type is missing `this: void`. |
| `did not finish within Ns` | The test never called `t.done()` on some path. |
| `The map is unavailable or corrupted` | Something reused a map filename. See above. |
| `Error: A file was not found` from vmrun | `-T ws` missing. The module always passes it. |
| Framebuffer size mismatch error | The guest resolution drifted from the coordinates in `vms.json`. Re-capture with `Get-TestVmScreenshot`. |

Guest scripts must write under `C:\Users\wc3\`; `runProgramInGuest -interactive`
is not elevated and cannot write to `C:\`.

To rebuild the VMs from scratch, see [VM-SETUP.md](VM-SETUP.md).
