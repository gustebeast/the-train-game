# WC3 LAN in VMs — everything learned, and what to do next

Handoff from sub-agent `dougie`. Part 1 is the action plan; part 2 is the
reference material behind it. **Fold part 2 into `scripts/vmtest/VM-SETUP.md`
before deleting this file** — most of it took hours to find and none of it is
discoverable from the UI.

**Goal state:** a LAN test is nothing more than *back out of the WC3 menus →
LOCAL AREA NETWORK → host on one VM, join on the other*. Everything else baked
into the image.

---

# Part 1 — Action plan

## 0. The VMs are stuck, but not broken

I killed Battle.net on `dougie` and `murph` while testing and they now sit at a
Battle.net login screen. A snapshot revert restores them; nothing persistent was
damaged:

```powershell
vmrun -T ws revertToSnapshot C:\VMs\Dougie\Dougie.vmx create-game
vmrun -T ws revertToSnapshot C:\VMs\Murph\Murph.vmx create-game
```

## 1. What your re-mint already fixed (verified working)

| Thing | State |
|---|---|
| Bonjour installed | ✅ `mDNSResponder` running on both |
| Unique hostnames | ✅ `WC3DOUGIE`, `WC3MURPH` |
| Firewall rules | ✅ `Warcraft III` + `Bonjour mDNS in`, `profile=Any`, program paths correct |
| VM-to-VM connectivity | ✅ ping succeeds both ways |
| LAN discovery | ✅ joiner sees the hosted game — right name, map, host |

Every item from the previous plan is genuinely done. Discovery works end to end.

## 2. What still fails

**The join.** Joiner selects the game, enters a name, confirms — and bounces
back to the browser at `999ms` ping, with no error text anywhere.

Ruled out by direct experiment; each was tried and the join still failed:

- Firewall **fully disabled** on both guests, not just the rules.
- IPv6 **disabled** on both adapters.
- Hostnames **confirmed unique** at the moment of the attempt.

## 2b. Later findings from the lead (2026-08-19) — read before re-testing

Three things below are now settled by direct measurement. Do not spend VM time
re-testing them.

**§3's hypothesis is disproven.** WC3 relaunched fresh, with the NIC live and an
IP already assigned, behaves identically — same silent bounce. The snapshot's
frozen sockets are not the cause. `scripts/vmtest/lan-mdns-probe.ps1
-FreshLaunch` reproduces this in ~4 minutes.

**mDNS is healthy, end to end.** Measured with Bonjour's own `dns-sd.exe`, which
ships in the guest at `C:\Windows\System32\dns-sd.exe`:

- the service type is `_blizzard._udp`
- the host's advertisement resolves from the joiner:
  `mdns._blizzard._udp.local. can be reached at WC3DOUGIE.local.:NNNNN`
- `WC3DOUGIE.local` → `192.168.31.128` from the joiner, and the reverse
  direction works too (`lan-name-probe.ps1`)

**The advertised port looks wrong but is not.** `dns-sd` reports a port that
nothing on the host is bound to. It is the **byte-swapped** form of WC3's real
TCP listening port — WC3 writes the SRV port in the opposite byte order from the
spec, so a correct mDNS client displays nonsense while a second WC3 reads it back
correctly:

| advertised | hex | swapped | WC3's actual TCP listener |
|---|---|---|---|
| 47315 | `0xB8D3` | `0xD3B8` = 54200 | 54200 |
| 39384 | `0x99D8` | `0xD899` = 55449 | 55449 |

So the join target is a **TCP** port, and `lan-diagnose.ps1` already proved the
joiner can reach it. Anyone who rediscovers the mismatch should stop here rather
than chase it — it cost a full cycle.

### What the joiner actually does at the moment of a join

Captured with `pktmon` (built into the guest) on both sides, with a control ping
that must appear or the run declares itself invalid —
`scripts/vmtest/lan-capture.ps1`:

- **The joiner emits no TCP at all. Not one SYN, to any address.** 897 decoded
  packets across a join attempt and not a single connection attempt.
- Nothing is refusing the join. The joiner gives up before it transmits.
- What it *does* emit is a stream of failing DNS lookups to the host-only
  gateway `192.168.31.1:53`, which runs no DNS server:
  `us.actual.battle.net`, `distribution.version.battle.net`,
  `telemetry-in.battle.net`.

### Battle.net reachability is NOT the cause (tested on WAN, 2026-08-19)

The obvious reading of those DNS failures — that Reforged needs its Battle.net
layer before it will attempt a LAN connection — is **wrong**. Tested with
`lan-capture.ps1 -Nat`, which switches the pair to NAT for one run (the vmx edit
must sit between the revert and the start; reverting rewrites it back):

- Battle.net resolved and was reachable (`bnet=34.125.12.10`)
- the joiner emitted **92 SYNs** — every one of them to the internet
- traffic to the peer: still **zero**

So the DNS flood is Battle.net.exe and Agent phoning home, not the join path.
`-Nat` restores host-only when it finishes, and a revert would anyway.

### A real defect, found and fixed, that was still not the blocker

The host was **not publishing an A record for its own hostname**. It announced
its `_blizzard._udp` service (hence a correctly listed game) while nothing on the
network ever answered with an address for `WC3DOUGIE.local.` — the SRV target.
Cause: mDNSResponder starts inside the snapshot while the adapter is still
disconnected, so it has no interface to publish a host record on.

`lan-capture.ps1 -RestartBonjour` fixes it — `A 192.168.31.128` goes from 0
announcements to 4, and the joiner's browse response now carries the address.
**The join still fails**, so this was a genuine gap but not the cause. The
durable version is to start Bonjour *after* the NIC is live during the mint,
which costs nothing per run; it is deliberately opt-in here rather than adding
~20s to every LAN run for an unproven benefit.

**Beware: resolving the peer from PowerShell does not test what WC3 tests.**
`[System.Net.Dns]::GetHostAddresses('WC3DOUGIE.local')` succeeds via LLMNR and
NetBIOS fallback even when mDNS has no such record. `lan-name-probe.ps1` passed
for hours while WC3, which uses the Bonjour API and only mDNS, had nothing.

### Leading hypothesis now: the clones share one Battle.net account

Both guests carry the same profile directory:

```
C:\Users\wc3\Documents\Warcraft III\BattleNet\394069848\
```

They are linked clones of a single login. Reforged identifies players by
Battle.net account, and a client asked to join a game hosted by **its own
account** has every reason to refuse locally — which is exactly what is
observed: no connection attempt, no error text, a permanent 999ms ping, and
nothing wrong anywhere below the game.

This fits all the evidence better than any network explanation, and every
network explanation has now been eliminated by measurement.

**Testing it needs a second Blizzard account with a Reforged license** — an
account creation and probably a purchase, so it is the owner's call, not
something to try quietly. If a second account is available, the test is one run:
sign the joiner VM into it and see whether a SYN appears.

### A harness bug that invalidated earlier results

`-FreshLaunch` never worked. The baked player name lives only in the snapshot's
**process memory**, so killing and relaunching WC3 arrives at ENTER PLAYER NAME
with an **empty field**; WC3 refuses an empty name, and the join never happens.
On screen and in a capture that is indistinguishable from the join failing.

Every `-FreshLaunch` conclusion recorded before 2026-08-19 measured that, not the
join. Both `lan-leave-test.ps1` and `lan-capture.ps1` now always type into the
field instead of trusting it to be pre-filled.

## 3. Leading hypothesis — DISPROVEN, see 2b

**WC3 must be launched while the network adapter is live.**

The `create-game` snapshot is minted with `ethernet0.startConnected = "FALSE"`,
so the WC3 process frozen into it started with **no network at all**. Connecting
the NIC after the revert gives the guest an IP, and discovery works because WC3
only has to *receive* multicast — but the sockets it needs to accept or make a
game connection were set up against no adapter.

Supporting evidence: the one time a join succeeded (a verified 3/5 lobby, earlier
session), the joiner's WC3 had been **launched fresh, after a reboot, with the
NIC already connected**. Every failure since has been a WC3 resumed from a
NIC-disconnected snapshot.

I was mid-way through testing this exact thing — kill WC3, relaunch with the
adapter live, host+join — when the guests hit the login screen. Treat it as a
strong lead, not a proven fact.

## 4. Recommended re-mint

1. **Switch the clones to `hostonly` networking** (`ethernet0.connectionType =
   "hostonly"`).

   The important one, and it solves two problems at once. VM-to-VM traffic still
   works, so LAN is fine — but there is **no route to the internet**, so
   Battle.net can never be reached, its single-use session token can never be
   consumed, and the offline entitlement can never be churned by a test run. It
   also settles the "does connecting the NIC put my VMs on the WAN" question:
   under NAT it does, under host-only it cannot.

2. **Mint with the NIC connected** to that host-only network — the hypothesis in
   §3. WC3 still cannot reach Blizzard on host-only, so the `PLAY OFFLINE` path
   you already automate should behave identically.

3. **Disable IPv6 on the guest adapter** before minting:
   ```powershell
   Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6
   ```

4. **Decide the firewall question.** Your rules look correct and ping passes, but
   I could not get a join through with the firewall on *or* off, so neither is
   proven. Under host-only isolation there is no exposure either way, so simply
   disabling it removes a variable.

5. Keep Bonjour and the per-agent hostnames exactly as they are.

Verify with `scripts/vmtest/lan-leave-test.ps1` before declaring it done — a
re-mint that looks right but still bounces costs another full cycle to discover.

---

# Part 2 — Reference: WC3 Reforged LAN inside VMware

Fold this into `VM-SETUP.md`.

## Discovery is mDNS, and that has consequences

Reforged does **not** use the classic broadcast LAN protocol. It uses Apple's
**Bonjour** (mDNS/zeroconf):

- **Bonjour must be installed** or the LAN menu will not even open — it prompts
  *"INSTALL BONJOUR? Bonjour installation is required in order to continue"*.
  The in-game installer works; it needs a UAC click, and **VNC can drive UAC**
  because it reaches the secure desktop.
- **Reforged does not listen on port 6112.** The host binds a *dynamic* high port
  (observed: UDP 60667) and advertises it over mDNS. Any port-based firewall rule
  you write will be aimed at the wrong port; scope rules to the **program**
  instead.
- **Peers are resolved by hostname.** This is the trap below.

## The hostname trap (cost me hours)

Clones inherit the base image's computer name. Identical names mean each VM
resolves the peer's hostname to **itself**, and the failure is maximally
misleading:

> Discovery works perfectly — the game appears in the browser with the correct
> name, map and host — but **every join silently bounces** back to the list at
> `999ms` ping, with no error anywhere in the UI.

Give every VM a unique hostname (`mint-vm.ps1` now derives it from the agent
name and verifies it after the reboot). If you ever see the signature above,
check hostnames *first*.

**Note that the same signature has at least one other cause** — it is what the
current, hostname-correct VMs still show. So "999ms + bounce" means *"the
connection could not be established"* generally, not specifically a name clash.

## IPv6 hands WC3 an unusable address

With IPv6 enabled, mDNS resolves the peer's hostname to an **IPv6 link-local**
address (`fe80::…`), not its `192.168.x`. Disabling IPv6 makes resolution return
IPv4. This did not fix the join by itself, but a link-local address is not
something you want WC3 trying to connect to.

## The guest firewall blocks peer traffic by default

Out of the box the guests could not even **ping** each other despite sharing a
subnet. The shipped `Warcraft III` rules were scoped to the **Public** profile
only. Widen to `profile=Any` and add a Bonjour rule, or disable the firewall
outright on an isolated network.

## Networking mode matters

- `nat` — VM-to-VM **and** internet. Convenient, but every powered-on VM can
  reach Blizzard.
- `hostonly` — VM-to-VM only, no internet. **Preferred for LAN tests**: LAN
  works, Battle.net is unreachable by construction.

## Battle.net session tokens are single-use across clones

All clones share one saved login. The first clone to go online **consumes** it;
the others then show *"session expired"*. Consequences:

- **Never kill Battle.net in a guest.** It does not simply restart — it lands on
  a login prompt that only a human can clear. (This is how I stranded two VMs.)
- Expect exactly one VM to auto-login after an online excursion. The rest need
  the *Continue Offline* path.
- The WC3 **offline entitlement** is separate and time-based (~30 days from last
  online sign-in). Going online refreshes it; it is not consumed like the token.

## Both machines need the same map filename

LAN matches host and joiner by **filename**. The normal runner uploads
`ZZ<random>.w3x` per call, which is correct for single-VM runs and wrong here —
generate one name and upload it to both.

## Menu navigation from the `create-game` snapshot

One snapshot serves single player *and* LAN; a LAN run pays ~20s of navigation.
Fullscreen clone coordinates:

| Step | Click |
|---|---|
| BACK (out of Create Game) | `137,1204` |
| BACK (to main menu) | `137,1204` |
| LOCAL AREA NETWORK | `1226,711` |
| CREATE (host) | `785,1047` |
| game-name field | `240,307` |
| refresh list (joiner) | `954,167` |
| first game row | `400,333` |
| JOIN | `637,1047` |

Gotchas:

- **The LAN menu click usually needs two clicks** — the first is eaten by the
  menu transition.
- **The map browser remembers its last folder.** After backing out it may open
  inside `frozenthrone/maps`; walk `(up one level)` until `Download` is the top
  row.
- **The player-name prompt appears on every JOIN**, and the typing does not
  always land. Screenshot and verify the field before clicking CONFIRM.

## Use autoRun for anything multi-VM

There is no reliable way to type a chat command into two guests at once — WC3
samples the keyboard once per render frame, so fast VNC input transposes
characters. `initTestKit('leave')` starts the test itself when play begins. The
harness self-check verifies the autoRun name matches the test being run.

## Test design for multiplayer behaviour

`src/leavetest.ts` is the worked example. Two things worth copying:

- **Report a control, not just the thing under test.** It reports the leaver's
  unit count *and* a remaining player's, so `leaverAfter == 0` with
  `stayerAfter > 0` distinguishes "despawned the leaver" from "killed everyone".
- **Fail loudly on a bad setup.** It reports
  *"need 2+ humans (LAN); this looks like a single-player run"* rather than
  waiting for a timeout. That single line is how I knew the join had failed
  rather than the map being broken — every failed run diagnosed itself.

---

## When you are done

Fold Part 2 into `VM-SETUP.md`, then delete this file.

```bash
git rm LAN-REMINT-PLAN.md
```
