# Plan: make the test VMs LAN-capable (for the Lead)

One-time handoff note from sub-agent `dougie`.

Two VMs *can* run a real multiplayer game against each other — proven this
session: `dougie` hosted, `murph` joined, lobby showed **3/5 players**. Getting
there needed three fixes, none of which survive a snapshot revert. This plan
bakes them in so LAN tests become routine.

**Scope decision (from the user): keep ONE snapshot.** Do *not* mint a second
"LAN lobby" snapshot. The existing `create-game` snapshot stays exactly where it
is (Single Player → Custom Games map list). LAN tests simply back out to the
main menu and go into LAN from there — ~20s of extra navigation per run, which
is the accepted cost of not maintaining two snapshots per VM.

**The configured VMs were not preserved — you are starting from scratch.** I
applied all three fixes live to `dougie` and `murph` and verified a 3/5 lobby,
but the clones are snapshot-backed: suspending a VM whose `checkpoint.vmState`
references a snapshot discards the disk delta, so both reverted to `WC3TEST`
with Bonjour gone. Little was actually lost, because clone-level config was never
the useful artifact — **Bonjour and the firewall rules have to live in the BASE
image** so every future clone inherits them, and that is step 1 below. Budget
~15 minutes to redo it there. Everything I learned is written down here; nothing
about the *procedure* was lost.

---

## 1. Bake into the BASE image (do once, all clones inherit)

Both are persistent on-disk changes, so they belong in the base before cloning —
this is the "free" part, since re-minting already requires rebuilding clones.

### a. Install Bonjour

WC3 Reforged uses Apple's mDNS/Bonjour for LAN discovery. Without it, clicking
**LOCAL AREA NETWORK** just prompts *"INSTALL BONJOUR? Bonjour installation is
required in order to continue"* and goes no further.

Easiest path: on the base VM, click **LOCAL AREA NETWORK** → **INSTALL** →
approve the UAC prompt. (VNC *can* drive UAC — it reaches the secure desktop.)
Verify with `mDNSResponder` present in `listProcessesInGuest`.

The host machine also has Bonjour at `C:\Program Files\Bonjour` if you would
rather copy an installer in than let it download.

### b. Let peer traffic through the guest firewall

Out of the box the guests could not even **ping** each other despite sharing a
NAT subnet — the guest Windows Firewall blocks it, and every LAN join silently
fails.

*Proven fix (what I used):* disable the firewall in the guest.

```powershell
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
```

Defensible here — these are throwaway VMs on an isolated NAT network, reverted
every run — but it is a blunt instrument.

*Recommended, NOT yet verified:* the guests already ship inbound allow rules for
Warcraft III, but scoped to the **Public** profile only, which is likely why they
did not apply. A targeted fix would be to widen those and add Bonjour, rather
than disabling the firewall outright:

```powershell
Get-NetFirewallRule -DisplayName '*Warcraft*' | Set-NetFirewallRule -Profile Any -Enabled True
New-NetFirewallRule -DisplayName 'Bonjour mDNS' -Direction Inbound -Program 'C:\Program Files\Bonjour\mDNSResponder.exe' -Action Allow -Profile Any
```

Program-scoped rules matter because **Reforged does not use port 6112** — the
host bound a *dynamic* high port (observed: UDP 60667) and advertises it via
mDNS. Any port-based rule you write will be wrong. If the targeted approach
misbehaves, fall back to disabling the firewall, which is proven.

### c. Elevation note

`vmrun runProgramInGuest` **without** `-interactive` runs via the Tools service as
SYSTEM, so it is elevated — that is how both changes above can be scripted. With
`-interactive` they fail silently on permissions.

---

## 2. Unique hostname per VM (do at mint time)

**This was the real killer, and it is worth understanding before you mint.**

Every clone inherits the base image's computer name — currently all four are
`WC3TEST`. Reforged resolves LAN peers **by hostname over mDNS**, so when `murph`
tried to join, the host name resolved to *itself*. The symptom is deeply
misleading: **discovery works perfectly** (the game appears in the list, correct
name, correct map, correct host) but every join silently bounces back to the
browser with a **999ms ping**. No error message, nothing in the UI to suggest
naming.

Renaming `murph` to `WC3MURPH` and rebooting fixed it immediately — the lobby
went to 3/5 on the next attempt.

**Suggested implementation** (the user's idea — use the agent's own name): add
this to `mint-vm.ps1` so it happens automatically for every VM you mint, right
after first boot and before the WC3 launch:

```powershell
# Clones inherit the base hostname; identical names break WC3's mDNS-based LAN
# peer resolution (each VM resolves the other to itself). Name each VM after its
# agent so LAN games work. Requires a reboot to take effect.
$hostName = "WC3" + $Vm.ToUpper()      # brenner -> WC3BRENNER
& $vmrun @guest runProgramInGuest $vmx 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  '-Command' "Rename-Computer -NewName $hostName -Force"
& $vmrun -T ws reset $vmx soft
# wait for the desktop again before continuing the mint
```

Sequence it *before* launching WC3 for the mint, so the reboot doesn't cost you a
second navigation pass. Verify with `$env:COMPUTERNAME` in the guest.

Worth asserting in the harness too: `Test-TestHarness` could warn when two
`ready` VMs report the same hostname, so this can never silently regress.

---

## 3. Navigating to LAN from the existing snapshot

From the `create-game` snapshot (fullscreen clones, coordinates in `vms.json`):

| Step | Click |
|---|---|
| BACK (out of Create Game) | `137,1204` |
| BACK (to main menu) | `137,1204` |
| LOCAL AREA NETWORK | `1226,711` |

Then **host**: `CREATE` `785,1047` → game-name field `240,307` → type a name →
Download folder `783,263` (double-click) → map row `783,319` → `CREATE`
`1339,981` → player-name field `827,493` → `CONFIRM` `968,646`.

Then **join** (other VM): select the game row `400,333` → `JOIN` `637,1047` →
player-name field `827,493` → `CONFIRM` `968,646`.

Gotchas that cost me time:

- **The LAN menu click often needs two clicks** — the first is eaten by the menu
  transition.
- **The map browser remembers its last folder.** After backing out and returning
  it may open inside `frozenthrone/maps`, not the root. Use `(up one level)` at
  `783,263` until `Download` is the top row.
- **The player-name prompt appears on every JOIN**, and typing into it does not
  always land — screenshot and verify the field before clicking CONFIRM.
- **Both VMs need the SAME map filename.** `Copy-MapToTestVm` generates a random
  `ZZ<random>.w3x` per call, which is correct for single-VM runs but breaks LAN
  matching. Generate one name and upload it to both.

---

## 4. What this unlocks

The immediate motivator: testing that **a leaving player's units are despawned**
(`src/playerLeave.ts` kills all units owned by the leaver on `EVENT_PLAYER_LEAVE`,
plus a next-frame sweep). That behaviour genuinely cannot be exercised in single
player — you need a second real player who can quit.

Once the above is baked in, the test shape is: host on VM A, join on VM B, start,
have B quit, then assert on A that B's peasant count is zero. A testkit test
reporting per-player unit counts would make that a normal `Invoke-MapTest`-style
measurement rather than a screenshot check.

I stopped at a verified 3/5 lobby rather than pushing to a full despawn result,
since everything past this point depends on the snapshot changes above being in
place — otherwise each run repeats all three fixes by hand.

---

## When you are done

Delete this file — it is a one-time handoff note, not reference material. The
durable docs are `scripts/vmtest/README.md` (using the harness) and
`scripts/vmtest/VM-SETUP.md` (building and re-minting the VMs); fold anything
worth keeping into those instead.

```bash
git rm LAN-TESTING-PLAN.md
```
