# Test flakiness: what we found, and what to do about it

Notes for the lead after chasing intermittent VM-test failures. Written from
runs on the `boof` VM, but nothing here is agent-specific.

The short version: **the harness had one real bug, and it looked like ten
different ones.** Most of what reads as "flaky" is a single failure mode with a
misleading error message, plus a handful of ways a test can shoot itself.

---

## 1. The failure everyone has been seeing

**Symptom:** `Map never became ready within 90s`, the run burns its entire
timeout, and the screenshot shows WC3's **ENTER PLAYER NAME** dialog with an
**empty** text box.

**Cause chain:**

1. The guest's WC3 profile has no saved player name, so **CREATE always raises
   the name dialog** — it is on the happy path, not an error state.
2. The harness clicks the field, types the name, clicks CONFIRM.
3. If the keystrokes are dropped, the box is empty — and **CONFIRM on an empty
   field is a no-op**. WC3 just sits on the dialog.
4. Nothing downstream can recover. `Wait-TestVmReady` taps space and re-clicks
   START GAME, but neither does anything while a modal dialog is up. The run
   waits out the full timeout and then blames `initTestKit()`.

The keystrokes get dropped because the field needs a moment to take focus after
the dialog animates in, and WC3 samples the keyboard once per render frame
(`guestMaxFps` 15 in the guests, so ~66ms per sample).

**What I changed** (`Start-TestVmMatch`): settle after clicking the field before
typing, and after typing before confirming. That is the whole fix — two waits.

**The permanent fix is upstream and I did not do it:** bake a player name into
each guest profile before minting. Then the dialog never appears and this entire
failure mode is gone. That needs a re-mint, so it belongs with whoever owns
VM-SETUP.

### Why the error message mattered more than the bug

For a long stretch this looked like several unrelated problems, because the
message said `Is initTestKit() called in main.ts?` — pointing at the map when
the map had never loaded. The message now names the real suspect. **When a
harness can fail in a way the test author cannot cause, say so in the failure
text.** That one line would have saved hours.

---

## 2. On retries: don't

I added retries (a 3x name-entry loop, and an ESC-and-re-drive backstop), and
then removed them at the user's direction. That call was right and is worth
writing down:

- A retry converts a hard failure into a slow success, so the underlying bug
  stops being reported and quietly rots.
- It pads every run that hits it, and those runs are the ones already slow.
- It makes a real regression indistinguishable from ordinary noise.

**Prefer: fail hard, fail fast, and say exactly what broke.** The ready timeout
is now 45s rather than 90s — a healthy run is live in well under 20s, so 45s is
already generous headroom and a broken run stops wasting a minute.

The distinction worth holding onto: a **settle delay is a correctness fix**
(the UI genuinely is not ready yet), a **retry is a workaround** (we do not know
why it failed, so we do it again). Keep the first, refuse the second.

---

## 3. Ways a test breaks itself

These cost me real time and none were harness bugs.

**Creating triggers at module scope.** `Trigger.create()` / `registerAnyUnitEvent`
at the top level of a test module runs during map init, before the game is up,
and can kill the load — which surfaces as `Map never became ready`, i.e. it is
indistinguishable from the harness bug above. Register tests at module scope;
create triggers inside the test body.

**Measuring through a trigger that runs too late.** `shop.ts` removes a
purchased item in its own PICKUP handler. A probe registered later saw the event
with the item already gone, filtered on item type, and counted zero — so a
working feature looked broken. If you register after the code under test,
you see the world *after* it has run.

**Trusting a probe you have not controlled.** I concluded
`GetUnitAbilityLevel` cannot see item-granted abilities because a stock control
item also read 0. It can — the control item's ability was broken for its own
reason. **Two agreeing zeros are not a control; make the control something you
have independently confirmed works.**

**Assuming a native models the player's action.** A shop purchase can only be
driven by `IssueNeutralImmediateOrderById`, which carries no buying unit, so it
behaves differently from a real click. Where a mechanic depends on selection or
UI context, drive the real UI over VNC (`Use-TestVm` + `Vnc-Click`) or the
conclusion will not transfer.

**Non-determinism in the fixture.** A test that rolls a random unit type and
then asserts on placement will pass and fail on the same code. Pin the inputs.

---

## 4. Things that are working and worth keeping

- **The staleness self-test.** It caught me testing a previous build after I
  restored `main.ts`. This is the highest-value guard in the harness: a green
  run against the wrong map is worse than a red one.
- **`autoRun`** (`initTestKit('name')`) removes the single most fragile step —
  typing a chat command over VNC. Use it while iterating on one test.
- **Screenshots on failure.** Nearly every diagnosis in this document came from
  reading `final.png`. Any new failure path should capture one.

---

## 5. Suggested next steps, in priority order

1. **Bake a player name into the guest profiles and re-mint.** Removes the one
   real failure mode entirely rather than mitigating it. Highest value.
2. **Reconsider pre-warm.** Every stuck run I hit began with
   `resuming pre-warmed ... (skipped reset)`. That may be correlation — a
   resumed guest is also the fast path, so it is simply the common case — but if
   the flake returns after the settle fix, suspend/resume timing is where I
   would look next: input sent while the guest is still coming back is exactly
   the shape of this bug.
3. **Consider asserting the menu reached the lobby** before waiting on the map,
   so a derailed menu fails in seconds with "never left the menu" instead of
   timing out against a map that was never given a chance to load. This is a
   sharper failure, not a retry.

---

## Guest operations down: "Map never became ready" that is not the map

**Symptom:** every run on every VM fails with `Map never became ready within
45s`. A prewarmed run, a full revert and a rebuild of a commit that passed
earlier all fail identically. The screenshot shows a game that IS running --
usually the editor-placed units, no lobby -- which reads as "the map threw
during init".

**Cause:** the VMware guest-operations link is down. `vmrun` reports this by
writing `Error: Unknown error` to stdout while still exiting 0, and the harness
piped that to `Out-Null`. So:

1. `Copy-MapToTestVm` no-ops. Nothing is uploaded and nothing says so.
2. The guest's Download folder still holds whatever the snapshot had, so the
   browser launches a stale map.
3. `Test-TestVmFile` cannot read the guest either. It returned `$false`, which
   the readiness loop cannot distinguish from "not written yet", so it polls a
   dead channel for the full timeout.
4. The run blames the map.

**Telling it apart from a real map failure**, in the order that costs least:

- `vmrun -T ws -gu wc3 -gp traintest fileExistsInGuest <vmx> C:\Windows\System32\cmd.exe`
  -- if that errors, nothing about the map matters. Host-side ops
  (`list`, `revertToSnapshot`, `start`) and VNC keep working throughout, so a
  VM that screenshots fine can still be unreachable.
- `vmrun -T ws checkToolsState <vmx>` reporting `running` does NOT clear it.
  That is the vmtoolsd heartbeat; authenticated guest operations are a separate
  path and fail independently.
- `vmware.log` shows `Vix: [mainDispatch.c] VMAutomation: Connection Error (4)`
  once per attempt.

**Root cause: the guest account's password expired.** Windows' default maximum
password age is 42 days, and every clone was made from one base image, so all
four inherited the same "password last set" date and expired on the SAME DAY:

    Password last set    7/17/2026
    Password expires     8/28/2026

The desktop session stays logged in, so the VM looks perfectly healthy over VNC
-- it is sitting at CREATE GAME as always. Only authenticated guest operations
fail. That is the whole reason this was hard to see: every signal that is easy
to check said the VM was fine.

Ruled out along the way, so nobody repeats it: VMware version (unchanged),
`VMAuthdService` (running, and restarting it changes nothing), guest tools
version and running state (`checkToolsState` says `running`, which proves
nothing -- that is the vmtoolsd heartbeat, a separate path from guest ops), the
guest clock (correct date; only the timezone differs from the host),
`tools.syncTime`, a locked session, and networking (fails identically on a VM
with no NIC).

**The fix, per VM.** Guest ops are dead, so it has to be done through VNC:
Win+R, `powershell`, Ctrl+Shift+Enter, accept UAC (wc3 is an admin, so it is a
consent prompt, not a credential one), then

    Set-LocalUser -Name wc3 -PasswordNeverExpires $true
    net user wc3 traintest

The reset is what clears the expired state; `-PasswordNeverExpires` is what
stops it coming back in another 42 days. Then close the shell, click WC3 in the
taskbar so it is foreground at CREATE GAME again, and **take a new snapshot** --
the fix is on disk, so without a fresh snapshot every revert restores the
expired password. That is what `create-game-v3` is.

**If it ever recurs**, the account is the first thing to check, not the map:

    net user wc3 | findstr /i expires
