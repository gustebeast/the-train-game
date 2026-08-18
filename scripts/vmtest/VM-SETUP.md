# Building the test VMs from scratch

You should not need this. The VMs exist and [README.md](README.md) covers using
them. This is the recovery document for if they are lost, or for moving the
setup to another machine.

Budget most of a day. Several steps below are one-time discoveries that each
cost hours; they are written down so nobody pays for them twice.

**Host used:** Windows 11 Home 25H2 (build 26200), Ryzen AI 9 HX 370, 31GB RAM,
VMware Workstation Pro 26H1 (26.0.0-25388281).

---

## 0. Host prerequisites

VMware's own hypervisor needs VBS/Hyper-V **fully off**, otherwise Workstation
falls back to ULM mode and `vmware-vmx` crashes with `0xc0000005` about four
seconds into every power-on.

```powershell
bcdedit /set hypervisorlaunchtype off
bcdedit /set vsmlaunchtype off
# plus HKLM\SYSTEM\CurrentControlSet\Control\DeviceGuard EnableVirtualizationBasedSecurity = 0
```

**VBS can be UEFI-pinned**, in which case the registry and bcdedit changes are
not enough and it stays on across reboots. Turning it off then requires
confirmation screens *during POST*, which only a human at the keyboard can do.
If VBS still reports running after a reboot, that is the situation.

Verify before continuing: `Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard`
should show `VirtualizationBasedSecurityStatus = 0`.

> Do not attempt a Workstation downgrade to dodge this. 26H1, 25H2u1 and 17.6.4
> all crash identically while VBS is on, and the installers refuse to downgrade
> over each other's driver/registry remnants. 26H1 is correct once VBS is off.
> Its drivers are internally stamped 25.x — that is expected, not stale.

## 1. Create the VM

A GUI-created VM is easiest, but if hand-writing the `.vmx`, these are the
non-obvious requirements:

- **`pciBridge0` plus `pciBridge4`–`pciBridge7`** (`virtualDev = "pcieRootPort"`,
  `functions = "8"`). Without them PCIe devices cannot get slots and the VM
  fails with *"No PCIe slot available for Ethernet0"*.
- **`sound.present = "TRUE"`** with `virtualDev = "hdaudio"`. WC3 refuses to
  start with *"Unable to initialize audio device"* and no sound card.
- `firmware = "efi"`, `uefi.secureBoot.enabled = "FALSE"`, `guestOS = "windows11-64"`.
- `memsize = "6144"`. Measured: idle Win11 uses ~2.6GB, and ~4.3GB with WC3 at
  the menu. **4GB is not enough** and swaps; 6GB each lets four VMs fit in 31GB.
- `mks.enable3d = "TRUE"` — WC3 Reforged does render on the virtual GPU.
- VNC, which is the control channel (see step 5):
  ```
  RemoteDisplay.vnc.enabled  = "TRUE"
  RemoteDisplay.vnc.port     = "5900"
  RemoteDisplay.vnc.password = "trainvm1"     # max 8 characters
  ```

A known-good reference config is `C:\VMs\TrainGameTest\TrainGameTest.vmx`.

## 2. Install Windows unattended

Put `autounattend.xml` on a small ISO and attach it. It bypasses the TPM and
Secure Boot checks, wipes disk 0, installs Windows 11 Pro, creates local admin
**wc3 / traintest** with permanent autologon, and skips OOBE.

Build the ISO with `-graft-points` or the file lands with its whole path as its
filename (`C__VMs_iso_autounattend.xml`) and Setup silently ignores it:

```
mkisofs -J -r -V ANSWER -graft-points -o answer.iso "autounattend.xml=C:\VMs\iso\autounattend.xml"
```

The Windows ISO still stops at *"Press any key to boot from CD"*, which a
headless VM cannot answer. Either press it once over VNC (step 5), or rebuild
the install ISO with `efisys_noprompt.bin` via `oscdimg`.

Install VMware Tools afterwards — everything in step 6 depends on it.

## 3. Get Warcraft III in without redownloading 30GB

`vmrun` file copy runs at ~1.9 MB/s, so a 28.5GB install would take over four
hours. Package the host's install as an ISO, attach it, and copy inside the
guest instead — **89 seconds at ~370 MB/s**:

```
mkisofs -udf -iso-level 3 -J -r -graft-points -o wc3.iso "WC3=C:\Program Files (x86)\Warcraft III"
# then in the guest:
robocopy D:\WC3 "C:\Program Files (x86)\Warcraft III" /E /MT:16
```

Keep the standard path `C:\Program Files (x86)\Warcraft III` so it matches the
host. Battle.net then shows **Play** rather than Install.

> HGFS shared folders do not work on this Workstation build. The driver
> installs, the provider registers, the vmx is correct, and
> `\\vmware-host\Shared Folders` still does not exist after a full power cycle.
> Do not spend time on it; use `vmrun` copy or the ISO trick.

## 4. Battle.net and offline play

Install Battle.net and log in once, by hand, via the VMware GUI console. The
login persists across reboots and clones.

The **game** does not need Battle.net afterwards. When it cannot reach Blizzard
it offers **PLAY OFFLINE**, which reaches the full main menu with Single Player
and LAN available. So every clone can run offline and they never contend over
one Battle.net session.

Remove Battle.net from `HKCU\...\Run` so it does not autostart; WC3 keeps
working and it saves memory.

Clear these first-launch prompts before minting, or they block the first run:

1. Windows Firewall's "allow Warcraft III on public/private networks" — click
   Allow, otherwise WC3 reports *"There was an error in handling the request.
   Please check your VPN"*.
2. Any OneDrive or Windows notification popups.

## 5. The control channel: VNC

The VMware GUI console **ignores synthetic input** (`keybd_event` / `mouse_event`),
so host-side automation cannot drive it. VNC can, and it works before VMware
Tools exists, which is what makes an unattended install recoverable.

`vnc-fast.ps1` is a minimal RFB client: VNC-DES auth (reverse the bits of each
password byte, then DES-ECB), framebuffer capture to PNG, and keyboard/mouse
events.

Capture screenshots with `LockBits` + `Marshal.Copy`, not `SetPixel` — per-pixel
copying took **minutes** per frame at 1656x1249 versus **0.3s** for the fast path.

## 6. The other control channel: vmrun

Once Tools is installed, `vmrun` handles files and processes. Three traps:

- **Always pass `-T ws`.** Without it every guest operation fails with the
  thoroughly misleading *"Error: A file was not found"*.
- `runProgramInGuest -interactive` runs **unelevated**, so guest scripts must
  write under `C:\Users\wc3\`, not `C:\`.
- **`vmrun` cannot launch WC3** — it silently fails. Launch it over VNC via the
  guest's own Run dialog. (The runner sidesteps this entirely by snapshotting
  with WC3 already running.)

Nested quoting through PowerShell → `vmrun` → guest PowerShell `-Command`
corrupts commands. The reliable pattern is: write a `.ps1` on the host,
`CopyFileFromHostToGuest`, run it with `-File`, then copy the output back.

## 7. Mint the snapshot

This is the step that makes runs fast, and its exact position matters.

1. Launch WC3, click **PLAY OFFLINE**.
2. Single Player → Custom Games.
3. Navigate to the map list root — the level that *contains* the `Download`
   folder. **Do not enter `Download`.** Entering it makes WC3 lock the map
   files, which breaks swapping the map in.
4. Dismiss any popups so the screen is exactly what the runner expects.
5. `vmrun snapshot <vmx> create-game` — takes about 5 minutes and captures RAM.

Reverting returns to this exact screen in ~11s, skipping the whole launch and
navigation.

> **Do not attach an independent-persistent disk.** They are fundamentally
> incompatible with memory snapshots: any change ever made to one causes
> *"Resuming virtual disk failed. The disk has been modified since a snapshot
> was taken"*. Keep maps on `C:`.
>
> If a restore fails and leaves the VM unbootable, delete the
> `checkpoint.vmState` lines from the `.vmx` and `vmrun start` again. The
> snapshots survive. `Reset-TestVm` does this automatically.

## 8. Clone per agent

**You cannot clone from a live snapshot.** VMware reports *"The virtual machine
should not be powered on. It is already running"* even with the VM shut down,
because a memory snapshot counts as powered on. Make a powered-off snapshot to
clone from first — revert to the live one, shut the guest down cleanly, then
snapshot (instant, and no `.vmem` file appears):

```
vmrun -T ws revertToSnapshot <golden.vmx> create-game
vmrun -T ws start <golden.vmx> nogui
vmrun -T ws stop  <golden.vmx> soft
vmrun -T ws snapshot <golden.vmx> base-off
```

Then clone — linked clones are copy-on-write, so each costs only its own changes
and takes under a second:

```
vmrun -T ws clone <golden.vmx> C:\VMs\Dougie\Dougie.vmx linked -snapshot=base-off -cloneName=Dougie
```

Per clone, edit the `.vmx`: unique `displayName`, unique
`RemoteDisplay.vnc.port` (5901–5904), and drop `uuid.bios` / `uuid.location` /
`ethernet0.generatedAddress` so VMware generates fresh ones.

### Refresh the offline entitlement first (one online login)

The VMs run WC3 **offline** — the game itself never needs Battle.net, which
sidesteps four VMs sharing one account. But WC3 Reforged only permits offline
play for ~30 days after the last online sign-in. Past that, a freshly minted VM
**cannot get past WC3's PLAY OFFLINE** (the button is dead). Existing live
snapshots keep working — they are frozen past that gate — so only new minting is
blocked, which is exactly what you are about to do.

So before (re-)cloning, refresh the entitlement once on the **base** VM. This is
the *only* step that needs a human (a password), and it is one login total, not
one per clone:

1. Boot the base with its NIC connected. Launch Battle.net; it shows "Welcome
   back / session expired". Open the VMware GUI console (`vmware.exe <vmx>`) so
   the human can type the password, and log in **Online**. (Battle.net may apply
   a required update first — click **Restart Now** and wait.)
2. Launch WC3 online once (Battle.net → Warcraft III → Play). Reaching the main
   menu with **MULTIPLAYER enabled** confirms the offline grace is refreshed.
3. Close WC3, shut the guest down cleanly, and take a fresh powered-off snapshot
   (`base-off2`). All clones will inherit the refreshed entitlement.

The saved "keep me logged in" token is **single-use across clones** — the first
clone to go online consumes it, so the others still show "session expired". That
is fine: they never need to log in (see below).

### Mint each clone (offline, no login)

Clone from the refreshed `base-off2` and set each clone's `.vmx`: unique
`displayName`, unique `RemoteDisplay.vnc.port` (5901–5904),
`ethernet0.startConnected = "FALSE"`, and drop `uuid.bios` / `uuid.location` /
`ethernet0.generatedAddress` for fresh identity. Then per clone:

After configuring the vmx, **boot each clone once and verify its VNC port** —
VMware silently rewrites `RemoteDisplay.vnc.port` back to the default 5900 in the
vmx if it can't bind the configured port at start (seen on Murph). Check with
`Test-NetConnection 127.0.0.1 -Port <port>`; if it landed on 5900, stop the VM,
re-set the port in the vmx, and restart.

**Render-CPU tuning (optional but recommended):** before the clone's WC3 launch,
set `maxfps` in the guest's `War3Preferences.txt` to `guestMaxFps` from
`vms.json` (15) (WC3 reads it only at
launch). A running WC3 renders its menu at ~1.5 CPU cores at the stock
`maxfps=200`; 15 cuts that to ~0.3-0.4. Keep the two in step: `vms.json`'s
`guestMaxFps` is the recorded value, and `vm-wall.ps1` caps its capture rate
at it (capturing faster only re-reads frames the guest has not redrawn). It does not change render
resolution, so the runner's click coordinates are unaffected. Set it on the
**base** before re-cloning and all clones inherit it. (Classic/SD graphics —
already the default here — is the other big reducer.)

Then per clone:

1. Boot (NIC off from the vmx). Wait for the desktop.
2. **Silence audio:** `vmrun disconnectNamedDevice <vmx> sound`.
3. Launch Battle.net (it will sit at "Connecting…" with the NIC off — that's
   fine). If the base snapshot was taken while logged in and the entitlement is
   fresh, you do **not** need to prime the offline path: just launch WC3 straight
   from here (Warcraft III tab → Play) and use WC3's own PLAY OFFLINE. Only if
   WC3's PLAY OFFLINE is dead (lapsed entitlement) do you need the online-refresh
   dance — see *Refresh the offline entitlement* above.
4. WC3 VPN error **OK** → **PLAY OFFLINE** → main menu (offline, MULTIPLAYER
   greyed).
5. Single Player → Custom Games. If it opens inside a subfolder (top row is
   "(up one level)"), double-click that until the top row is the **Download**
   folder — the runner's coordinates assume Download is the top row.
6. `vmrun -T ws snapshot <clone.vmx> create-game` (~5 minutes).
7. Set `ready: true` for that VM in `vms.json`, then validate:
   `run-test.ps1 -Vm <name>`.

> **Do NOT mint while online.** A snapshot taken with WC3 online replays a stale
> session on revert and pops a "DISCONNECT — disconnected from Battle.net" dialog
> that breaks the runner. The snapshot must be in committed **offline** mode
> (past PLAY OFFLINE). If you accidentally minted online, revert (which triggers
> the DISCONNECT dialog), click its **PLAY OFFLINE**, navigate back to the root,
> and re-snapshot.
>
> **That in-place recovery often is not enough** (learned re-minting Murph,
> 2026-08-18). Dismissing the DISCONNECT clears the dialog, but the WC3 process
> is still a Battle.net-connected session, and the repaired snapshot fails later
> and more confusingly: the run reaches the lobby, then WC3 prompts **ENTER
> PLAYER NAME** at START GAME and the runner times out at "map never became
> ready". Once a snapshot has been minted online, relaunch WC3 from scratch with
> the NIC disconnected and mint properly rather than patching the old session.

> **Reach Custom Games via SINGLE PLAYER, not LOCAL AREA NETWORK.** Both lead to
> a "Create Game" screen that looks nearly identical, but the LAN one adds a
> GAME NAME field, joins a Battle.net chat channel, and demands a player name at
> START GAME — none of which the runner drives, so it hangs. The correct screen
> is subtitled **Single Player** and has no GAME NAME field.

Clones run **fullscreen** while the original shared VM was minted windowed, so
their menu coordinates differ. Both sets live in `vms.json` under `uiSets`; each
VM names the one it uses.

`mint-vm.ps1` automates the click-driving with screenshot checkpoints, but the
Battle.net timing varies enough that minting is best supervised.

Multiple clones run simultaneously, each independently reachable on its own VNC
port and via `vmrun` — see `concurrency-test.ps1`.

---

## Reference

| Thing | Value |
|---|---|
| Guest credentials | `wc3` / `traintest` (local admin, autologon) |
| VNC password | `trainvm1` |
| VNC ports | shared 5900, brenner 5901, boof 5902, dougie 5903, murph 5904 |
| Snapshot name | `create-game` (`create-game-v2` on the shared VM) |
| Map drop folder | `C:\Users\wc3\Documents\Warcraft III\Maps\Download` |
| Results folder | `C:\Users\wc3\Documents\Warcraft III\CustomMapData\TheTrainGame` |
| WC3 install | `C:\Program Files (x86)\Warcraft III` |
| Guest resolution | 1656x1249 (UI coordinates in `vms.json` assume this) |
