# LAN re-mint: what still blocks a two-VM game (for the Lead)

Handoff from sub-agent `dougie`. Supersedes the earlier LAN plan, which got the
prerequisites right but missed the one below.

**Goal:** a LAN test should be nothing more than *back out of the WC3 menus →
LOCAL AREA NETWORK → host on one VM, join on the other*. Everything else baked
into the image.

---

## First: the VMs are not broken, but they are stuck

I killed Battle.net on `dougie` and `murph` while testing, and they are now
sitting at a Battle.net login screen. **A snapshot revert fixes them** — nothing
persistent was damaged:

```powershell
vmrun -T ws revertToSnapshot C:\VMs\Dougie\Dougie.vmx create-game
vmrun -T ws revertToSnapshot C:\VMs\Murph\Murph.vmx create-game
```

Lesson worth keeping: **do not kill Battle.net in a guest.** The saved login
token is single-use across clones, so it does not simply restart — it lands on a
login prompt that only a human can clear.

---

## What your re-mint already fixed (verified by me, working)

| Thing | State |
|---|---|
| Bonjour installed | ✅ `mDNSResponder` running on both |
| Unique hostnames | ✅ `WC3DOUGIE`, `WC3MURPH` |
| Firewall rules | ✅ `Warcraft III` and `Bonjour mDNS in` both `profile=Any`, program paths correct |
| VM-to-VM connectivity | ✅ ping succeeds both ways |
| LAN discovery | ✅ the joiner sees the hosted game, right name, right map, right host |

So the earlier plan's items are genuinely done. Discovery works end to end.

## What still fails

**The join.** The joiner selects the game, enters a name, confirms — and bounces
straight back to the browser. Ping shows `999ms`. No error text anywhere.

Ruled out by direct experiment (each of these was tried and the join still
failed):

- Firewall fully disabled on both guests (not just the rules) — still fails.
- IPv6 disabled on both adapters — still fails.
- Hostnames confirmed unique at the moment of the attempt — still fails.

One diagnostic worth keeping: with IPv6 on, mDNS resolves the peer's hostname to
an **IPv6 link-local** address (`fe80::…`), not its `192.168.x`. Disabling IPv6
makes it resolve to IPv4. That did not fix the join on its own, but it removes a
confusing variable and is probably worth doing anyway.

## The remaining hypothesis (untested — I ran out of VM)

**WC3 has to be launched while the network adapter is live.**

The `create-game` snapshot is minted with `ethernet0.startConnected = "FALSE"`
so the guest can reach WC3's offline path. That means the WC3 process frozen
into the snapshot **started with no network at all**. Connecting the NIC after
the revert gives the guest an IP, and multicast discovery works because WC3 only
has to *receive* announcements — but the socket state it needs to accept or make
a game connection was set up when there was no adapter.

The evidence for this is that the one time it *did* work — a 3/5 lobby, earlier
session — the joiner's WC3 had been **launched fresh, after a reboot, with the
NIC already connected**. Every failure since has been a WC3 resumed from a
NIC-disconnected snapshot.

I was mid-way through testing exactly this (kill WC3, relaunch with the adapter
live, then host+join) when the guests got stuck on the login screen, so treat it
as a strong lead rather than a proven fact.

## Recommended re-mint

1. **Switch the clones to `hostonly` networking** (`ethernet0.connectionType =
   "hostonly"`) instead of `nat`.

   This is the important one and it solves two problems at once. VM-to-VM
   traffic still works, so LAN is fine — but there is **no route to the
   internet**, so Battle.net can never be reached, the saved session token can
   never be consumed, and the offline entitlement can never be churned by a test
   run. It also removes the "did connecting the NIC just put my VMs on the WAN"
   question entirely, which is a real one under NAT: NAT gives them both LAN
   *and* internet.

2. **Mint with the NIC CONNECTED** (to that host-only network).

   This is the hypothesis above. WC3 then initialises with a live adapter, and
   the snapshot you revert to has a WC3 that can actually host and join. WC3
   still cannot reach Blizzard on a host-only network, so the `PLAY OFFLINE`
   path you already automate should behave the same.

3. **Disable IPv6 on the guest adapter** before minting, so mDNS hands WC3 an
   IPv4 address:
   ```powershell
   Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6
   ```

4. **Decide the firewall question.** The rules you added look correct and ping
   passes, but I could not get a join through with the firewall on *or* off, so
   neither is proven. With host-only isolation there is no exposure either way —
   simply disabling it in the base removes a variable.

5. Keep Bonjour and the per-agent hostnames exactly as they are.

Then verify with the script below before declaring it done — a re-mint that
"looks right" but still bounces the join costs another full cycle to discover.

## What I am leaving you

- **`src/leavetest.ts`** — the actual measurement, committed and typechecking.
  Reports the leaver's living-unit count at the leave event and again once it
  settles, plus a remaining player's count as a control. `leaverAfter == 0` with
  `stayerAfter > 0` is the pass condition. It also fails loudly with
  *"need 2+ humans (LAN); this looks like a single-player run"* rather than
  hanging, which is how I knew the join had failed rather than the map.

- **`scripts/vmtest/lan-leave-test.ps1`** — the full orchestration: reset both
  VMs, upload the *same* map filename to both (LAN matches by filename), drive
  host and joiner through the menus, start, kill WC3 on the joiner to simulate an
  abrupt disconnect, then read the verdict off the host. It has `-KeepFirewall`
  and `-KeepIpv6` switches so you can isolate those variables. Runs end to end
  today; it just reports `players=FAIL` because only one player is ever in the
  game.

  It lives in `scripts/vmtest/`, which is yours now — adopt or rewrite it as you
  see fit.

- The `leave` test is registered but `main.ts` calls plain `initTestKit()`. For a
  LAN run set `initTestKit('leave')` so the test starts itself: there is no
  reliable way to type a chat command into two guests at once, and your autoRun
  addition removes the need entirely. The harness self-check verifies that the
  autoRun name matches the test being run.

---

## When you are done

Delete this file — one-time handoff, not reference material. Anything durable
belongs in `scripts/vmtest/VM-SETUP.md`.

```bash
git rm LAN-REMINT-PLAN.md
```
