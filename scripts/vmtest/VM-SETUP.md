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

Linked clones are copy-on-write, so they share the base disk and each cost only
their own changes:

```
vmrun -T ws clone <golden.vmx> C:\VMs\Dougie\Dougie.vmx linked -snapshot=create-game -cloneName=Dougie
```

Per clone, edit the `.vmx`: unique `displayName`, unique
`RemoteDisplay.vnc.port` (5901–5904), and remove `uuid.bios` / `uuid.location`
so VMware generates fresh ones.

Register them in `vms.json` and the runner can address each by name. Multiple
clones run simultaneously, each independently reachable on its own VNC port and
via `vmrun`.

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
