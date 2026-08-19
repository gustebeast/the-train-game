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

## Skipping the chat command (autoRun)

`initTestKit()` in `src/main.ts` takes an optional test name:

```ts
initTestKit('damage');   // runs as soon as play begins, no chat command
```

The runner normally selects a test by typing `-test <name>` over VNC, and that
is the most fragile step in a run: WC3 samples the keyboard once per render
frame, so fast input transposes characters (`-cheatmode` -> `-cehatmdoe`), which
is why `Vnc-TypeSmart` types deliberately slowly. `autoRun` removes the step
instead of working around it.

It starts from the same timer that writes the readiness marker, which matters:
map init runs while the game is still paused behind "press any key", and a test
started there would sit in a world where no timer ever advances.

Set it while iterating on one test in your own branch (you build your own map
anyway); leave it off in what gets merged, so the shared map keeps letting
`-test <name>` choose. Leaving it on is not harmful if the runner also sends the
chat command -- the re-entrancy guard ignores the duplicate.

## Watching the VMs (the wall)

```
VmWall.bat                      # or: powershell -File scripts/vmtest/vm-wall.ps1
```

All four VMs tiled 2x2, live. Each tile is its own VNC viewer on that VM's port
(5901-5904), independent of VMware's GUI -- which matters because VMware console
tabs cannot be kept open: the runner starts VMs with `nogui` and powers them off
between tests, and Workstation closes a tab when its VM stops. Tiles here simply
go dark ("powered off") and relight by themselves when the next test boots that
VM, so the window can be left open all day.

Watching never disturbs a run: VMware's VNC server accepts concurrent clients,
and the wall only reads the framebuffer -- it sends no input.

- Runs at `guestMaxFps` from `vms.json` (15), which is also what the guests
  render at; capturing faster only re-reads frames WC3 has not redrawn.
  Override with `-Fps`.
- `-Topmost` keeps it above other windows; `-TileWidth` trades sharpness for CPU.
- Frames come as **incremental** updates (changed rectangles only). Requesting
  full 1656x1249 frames instead costs ~1s each in PowerShell -- roughly 1 fps.

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
| `Invoke-MapTest` | Run a registered test, get parsed results. Start here. |
| `Use-TestVm` | Your own steps against a live map, with cleanup guaranteed. |
| `Test-TestHarness` | Verify the harness is sound (see self-check below). |
| `Get-TestVm` | Resolve a VM by name. |
| `Reset-TestVm` | Revert to the snapshot and power on. |
| `Copy-MapToTestVm` | Upload a `.w3x` under a fresh unique name. |
| `Start-TestVmMatch` | Drive the menus from Create Game into a live match. |
| `Send-TestVmChat` | Type a chat command into the running game. |
| `Get-TestVmResultFile` | Read a file from the guest's CustomMapData. |
| `Get-TestVmScreenshot` | Save a PNG of the guest screen. |
| `Stop-TestVm` | Power off. Optional — the next run reverts anyway. |

### If something looks wrong: self-check first

```powershell
powershell -File scripts/vmtest/run-test.ps1 -SelfTest
```

A few seconds, no VM boot. It verifies the things that otherwise fail
confusingly — or silently: `vmrun` present, your VM resolves, its snapshot
exists, UI coordinates match, `initTestKit()` is wired into `main.ts`, your test
is registered *and* imported, and — most importantly — that **the built map is
newer than your newest source file**. Editing `src/` and forgetting
`npm run build` means the VM runs the *previous* map and passes happily; that is
the one failure a green result can't warn you about, so the check refuses it.

This also runs automatically before every test, and **blocks the run** if the
harness is unsound rather than handing you an untrustworthy result. Override with
`-SkipSelfTest` if you really mean it.

A test that finishes without calling `t.report(...)` at least once also **fails**
now, rather than passing with an empty result set — a test that measured nothing
is not a passing test. Pass `-AllowNoResults` if a result-free test is intended.

### Custom flows (screenshots, cheats, anything)

When you need something `Invoke-MapTest` doesn't do — fire a chat command and
grab a frame, poke several commands, read a file mid-match — **do not hand-roll
`Reset-TestVm` → upload → … yourself**: it's easy to forget the cleanup and
leave the VM running (a running WC3 burns ~1.5 CPU cores). Use `Use-TestVm`
instead. It does the setup (reset/resume → upload → live match) and, in a
`finally`, the exact same cleanup the standard runner uses (revert+suspend), no
matter what your body does or throws. You just fill in the middle:

```powershell
Import-Module .\scripts\vmtest\TrainVMTest.psm1 -Force
Use-TestVm -Vm dougie -Body {
  param($vm, $conn)                      # map is loaded and live
  Send-TestVmChat $conn '-cheatmode'
  Start-Sleep -Seconds 3
  Get-TestVmScreenshot $vm -Path C:\out\peasant.png -Connection $conn
}
# VM is suspended and ready for the next run -- you didn't have to clean up.
```

`$conn` is a live VNC connection (see `Send-TestVmChat`, `Get-TestVmScreenshot`,
and the `Vnc-*` helpers in `vnc-fast.ps1`). Pass `-NoMap` to get the VM at the
Create Game menu instead of in a match, or `-NoPrewarm` to stop the VM at the
end instead of suspending it. If you must drop even lower, the shared pieces are
exported too — `Reset-OrResumeTestVm`, `Wait-TestVmReady`, `Complete-TestVm` —
but always end with `Complete-TestVm` (or `Start-PrewarmVm` / `Stop-TestVm`).

### Manual / interactive session

To play the map yourself instead of running an automated measurement — the same
reset → upload → drive-into-match flow, but it stops at the live map and leaves
the VM running for you:

```powershell
npm run build
powershell -File scripts/vmtest/manual-session.ps1
```

With no `-Vm` it targets your worktree's VM (`agent/<name>`), just like the
runner. A VMware console window opens on the host with the map **uploaded into the
`Maps\Download` folder**. Open that folder, pick the `ZZ…​.w3x`, Create, then
Start — `Ctrl+Alt` releases the mouse from the window. It does **not** auto-start
the match or block waiting: the menu-driving is calibrated for the headless
automated runs, so with the GUI window up those clicks are unreliable, and a
human watching can just start it. Pass `-AutoStart` to attempt the menu-driving
anyway (best effort), `-Headless` to skip the window and connect a VNC client to
`127.0.0.1:<vncPort>` (password `trainvm1`), or `-NoMap` to stop at the Create
Game screen.

Like `Invoke-MapTest`, it loads whatever `.w3x` is already in `dist/bin`, so
build first. Everything you do is discarded the next time the VM is reverted, so
there is nothing to clean up. From PowerShell the same thing is
`Start-ManualSession`.

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

Total ~50s cold. No cleanup is needed; the next revert discards everything.

### Every run has a clean end point

A run **never leaves its VM running** — a running WC3 burns ~1.5 CPU cores, so a
forgotten VM would spin your fans indefinitely. `Invoke-MapTest` guarantees, in a
`finally` (so it holds even on failure or a thrown test), that the VM ends either
**suspended** (default, ready for the next run) or **stopped** (`-NoPrewarm`).
You don't have to remember to clean up; just call the runner. For custom flows
the runner doesn't cover, use `Use-TestVm { ... }` (see *Custom flows* below) —
it gives you the same guarantee. Only if you drive the primitives directly must
you end with `Complete-TestVm` (or `Stop-TestVm` / `Start-PrewarmVm`).

### Pre-warming (why repeat runs are ~32s)

The reset is the biggest cost, so after each run the runner reverts the VM to
Create Game and **suspends** it, in a detached background process — during your
build/edit time, off the critical path. The next run finds it suspended and
*resumes* it (~5s) instead of doing the full ~15-20s reset:

```
[   0.0s] resuming pre-warmed dougie (skipped reset)
[   4.9s] upload map
...
PASS (31.8s)
```

Suspending (rather than leaving it running) matters for more than speed: a
running WC3 renders its menu at ~1.5 CPU cores continuously, so four idle VMs
left running would peg your fans. Suspended, a VM renders nothing — **zero CPU
while idle** — and still resumes in ~5s.

A state file (`%TEMP%\trainvm-prewarm-<vm>.state`) tracks it: `warming` while the
revert+suspend is in flight, `warm` once suspended and ready. A run starting
mid-pre-warm waits for it; if the VM was powered off since (no `.vmss`), it
falls back to a full reset. Back-to-back runs with no gap don't benefit (the
pre-warm hasn't finished) but are no slower.

Pass `-NoPrewarm` to skip it and leave the VM powered off — repeat runs then pay
the full reset again.

> **Reducing render load further:** a running VM's ~1.5 cores comes mostly from
> `maxfps=200` in the guest's `War3Preferences.txt` — WC3 renders the menu at up
> to 200fps. The VMs are set to `vms.json`'s `guestMaxFps` (15). It only applies on a fresh
> WC3 launch, so it takes effect on the next re-mint (see VM-SETUP.md); it does
> not change render resolution, so the runner's click coordinates are unaffected.
> With suspend-on-idle this is a minor optimisation (idle VMs already cost zero).

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

See [FLAKINESS.md](FLAKINESS.md) for why runs go intermittently red, and how
to write a test that does not do it to itself.

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
