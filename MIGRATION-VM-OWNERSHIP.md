# Migration: VM test infrastructure moves to the Lead

**Read this once, do the actions, then delete this file** (`git rm
MIGRATION-VM-OWNERSHIP.md`) and commit the deletion with whatever doc edits you
made. It is a one-time handoff note, not reference material — the durable docs
are `scripts/vmtest/README.md` (using the harness) and
`scripts/vmtest/VM-SETUP.md` (building/re-minting the VMs).

## What changes

The VM test infrastructure was built by sub-agent `dougie` and has been owned by
it. From now on:

- **You (the lead) own the VM infrastructure** — the VMs themselves, minting and
  re-minting, `scripts/vmtest/*`, and `vms.json`.
- **Sub-agents only *use* it** — they write tests and run them on their own VM.
  When it breaks, they report to you instead of fixing it.

Rationale: the infra is shared plumbing with a shared failure mode (a lapsed WC3
entitlement blocks *all* minting, and one login fixes it for everyone). Four
agents each rediscovering that is waste, and since submissions are now final
with no user test gate, the harness is the quality gate — it needs one owner.

## What you now own

**The machines** (at `C:\VMs\`, not in git — they don't move with the repo):

| VM | VNC port | Role |
|---|---|---|
| `TrainGameTest` | 5900 | base/clone parent + mint base — **never a test target** |
| `Brenner` | 5901 | agent VM |
| `Boof` | 5902 | agent VM |
| `Dougie` | 5903 | agent VM |
| `Murph` | 5904 | agent VM |

All five are minted, verified, silenced (no host audio), and capped at
`maxfps=15`. Guest login `wc3` / `traintest`; VNC password `trainvm1`.

**The code**: `scripts/vmtest/` — `TrainVMTest.psm1` (the module),
`run-test.ps1` (CLI), `prewarm.ps1`, `mint-vm.ps1`, `concurrency-test.ps1`,
`vms.json` (registry), `vnc-fast.ps1` (VNC client).

**The in-map half**: `src/testkit.ts` (`registerTest`, the reporter, the ready
marker). Sub-agents write tests *against* this; changes to the kit itself are
yours.

## The one recurring task: re-minting (~monthly)

WC3 Reforged only allows offline play for ~30 days after the last online
sign-in. When it lapses, **existing snapshots keep working** but new minting is
blocked — WC3's `PLAY OFFLINE` button goes dead.

**Symptom you'll hear from an agent:** "PLAY OFFLINE is disabled" or a fresh
clone can't reach the menu. **Fix:** one online Battle.net login, then re-clone +
re-mint. Full steps are `VM-SETUP.md` step 8; the short version:

1. Boot the base with its NIC connected, launch Battle.net, and **ask the user to
   log in** in the VMware GUI console (`vmware.exe C:\VMs\TrainGameTest\TrainGameTest.vmx`).
   This is the only step needing a human — you cannot do it, and it is **one**
   login for all four VMs, so batch it.
2. Launch WC3 once online (MULTIPLAYER enabled = entitlement refreshed).
3. Close WC3, shut the guest down cleanly, snapshot powered-off (`base-offN`).
4. Delete + re-clone the four VMs from that snapshot, restore each one's
   `displayName` / `RemoteDisplay.vnc.port` / `ethernet0.startConnected="FALSE"`.
5. Per clone: boot → `disconnectNamedDevice <vmx> sound` → Battle.net → Play →
   WC3 `OK` → `PLAY OFFLINE` → Single Player → Custom Games (stop at the root,
   **Download** must be the top row) → `snapshot create-game` (~4-5 min each).
6. Validate each: `run-test.ps1 -Vm <name>`.

Budget ~45 min for all four, mostly waiting on snapshots.

## Gotchas that will bite you

- **`vmrun` needs `-T ws`.** Without it every guest op fails with the misleading
  "Error: A file was not found".
- **VMware silently rewrites `RemoteDisplay.vnc.port` to 5900** if it can't bind
  the configured port at first start (hit on Murph). After minting, verify with
  `Test-NetConnection 127.0.0.1 -Port <port>`; if wrong, stop, re-set in the vmx,
  restart.
- **Never mint while WC3 is online** — the snapshot replays a stale session on
  revert and pops a DISCONNECT dialog that breaks the runner. Must be past
  `PLAY OFFLINE`.
- **Never clone from a live snapshot** — VMware calls it "already running" even
  when shut down. Clone from a powered-off snapshot.
- **Clones auto-resume.** VMware sometimes powers a clone back on when idle;
  harmless, just `vmrun -T ws stop`. Don't leave VM console *tabs* open — an
  open tab both steals focus on revert and causes these resumes.
- **The uploaded map must have a filename WC3 has never seen.** A
  snapshot-restored WC3 rejects an overwritten filename as "unavailable or
  corrupted". `Copy-MapToTestVm` generates `ZZ<random>.w3x` — don't "optimise"
  that to a fixed name.

## Sub-agents keep doing

- Writing tests: `registerTest('name', t => { ... t.done() })` in `src/`, imported
  from `main.ts`.
- Running them: `run-test.ps1 -Test <name>` — it **auto-targets their own VM**
  from their branch (`agent/<name>`), so they pass no `-Vm` at all.
- Custom flows (screenshots, cheat commands): `Use-TestVm { param($vm,$conn) ... }`,
  which guarantees cleanup.
- **Reporting harness problems to you** rather than editing `scripts/vmtest/`.

## Actions for you, right now

1. **Edit `SUBAGENT_README.md`** to reflect the split:
   - State that VM infra is lead-owned: agents use it, report breakage, and do
     not edit `scripts/vmtest/` or re-mint VMs.
   - **Fix a stale instruction**: it currently says that if an agent's snapshot
     isn't minted, fall back to `-Vm shared`. That is now wrong — the runner
     *refuses* `shared`/`base`/`traingametest` (it's the clone parent, and
     testing on it can corrupt in-flight clones). The correct fallback is: ask
     the lead to mint your VM.
   - Point agents at `run-test.ps1 -SelfTest` as the first debugging step.
2. **Edit `LEAD_README.md`**: add VM infrastructure to "Housekeeping you own" —
   the re-mint trigger above, and that only you touch `scripts/vmtest/`.
3. **Know the self-check.** `run-test.ps1 -SelfTest` verifies the harness
   (vmrun, VM, snapshot, UI coords, **build freshness**, `initTestKit` wiring,
   test registration) in a few seconds without booting anything. It also runs
   automatically before every test and *refuses to run* if the harness is
   unsound, so an agent can't get a green result from a stale build. When an
   agent reports "tests are broken", ask for this output first — it usually
   names the problem outright.
4. **Delete this file** and commit.

## Where the deep knowledge lives

Everything hard-won is written down; you should not need to rediscover any of it.

- `scripts/vmtest/README.md` — writing/running tests, pre-warming, the
  unique-filename rule, troubleshooting table.
- `scripts/vmtest/VM-SETUP.md` — building the VMs from scratch, host
  prerequisites (VBS off), the ISO transfer trick, minting, cloning, and the
  traps that each cost hours.
