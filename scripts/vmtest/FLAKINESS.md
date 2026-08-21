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
