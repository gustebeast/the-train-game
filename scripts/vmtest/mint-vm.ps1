# Mint a clone's live create-game snapshot: boot offline, drive WC3 to the
# Create Game map-list root, snapshot. See VM-SETUP.md step 8. One-time per VM.
#
#   powershell -File scripts/vmtest/mint-vm.ps1 -Vm brenner
#
# Drives the guest over VNC using the clone's fullscreen coordinates and saves a
# screenshot before every click into -OutDir, so a misfire is diagnosable
# without reminting. Stops BEFORE taking the snapshot if -DriveOnly is passed,
# so you can eyeball the final position first.
param(
  [Parameter(Mandatory)][string]$Vm,
  [string]$OutDir,
  [switch]$DriveOnly,
  [switch]$SkipBoot,
  # Baked into the guest profile so test runs never see ENTER PLAYER NAME.
  # Must match Start-TestVmMatch's default, which is what a run would type.
  [string]$PlayerName = 'agent'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'

# Percentage of sampled pixels in a region that are lit. WC3's menus are dark,
# so thresholds here are calibrated against real screens rather than guessed:
#
#   ENTER PLAYER NAME dialog   ~1% lit   (the modal dims the whole screen)
#   single-player lobby title  ~26%      (bright yellow heading)
#
function Get-RegionBrightness([string]$png, [int]$x1, [int]$y1, [int]$x2, [int]$y2) {
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($png)
  try {
    $lit = 0; $n = 0
    for ($y = $y1; $y -lt [Math]::Min($y2, $bmp.Height); $y += 6) {
      for ($x = $x1; $x -lt [Math]::Min($x2, $bmp.Width); $x += 6) {
        $px = $bmp.GetPixel($x, $y); $n++
        if (($px.R + $px.G + $px.B) -gt 200) { $lit++ }
      }
    }
    if ($n -eq 0) { return 0 }
    return [math]::Round(100.0 * $lit / $n, 1)
  } finally { $bmp.Dispose() }
}

# Resolve straight from the registry, bypassing the ready:false guard (that
# guard is exactly what this script clears).
$cfg   = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$entry = $cfg.vms.($Vm.ToLower())
if ($null -eq $entry) { throw "Unknown VM '$Vm'" }
$vmx  = $entry.vmx
$port = $entry.vncPort
$ui   = $cfg.uiSets.($entry.ui)
$guest = @('-T','ws','-gu',$cfg.guestUser,'-gp',$cfg.guestPassword)
if (-not $OutDir) { $OutDir = "C:\VMs\mint-$Vm" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$step = 0
function Shot($c, $label){ $script:step++; Vnc-Shot $c (Join-Path $OutDir ("{0:D2}-{1}.png" -f $script:step, $label)); Write-Host "  shot $label" }

function Wait-Desktop($label) {
  $sw=[Diagnostics.Stopwatch]::StartNew()
  do { Start-Sleep -Seconds 5; $p="$(& $vmrun @guest listProcessesInGuest $vmx 2>&1)" }
  while ($p -notmatch 'explorer.exe' -and $sw.Elapsed.TotalSeconds -lt 200)
  if ($p -notmatch 'explorer.exe') { throw "Guest never reached the desktop ($label)" }
  Write-Host "  desktop up ($label)"
  Start-Sleep -Seconds 3
}

if (-not $SkipBoot) {
  Write-Host "Booting $Vm..."
  & $vmrun -T ws start $vmx nogui 2>&1 | Out-Null
  Wait-Desktop 'first boot'

  # Every clone inherits the base image's computer name (WC3TEST). Warcraft III
  # Reforged resolves LAN peers BY HOSTNAME over mDNS, so identical names make
  # each VM resolve the other to itself. The symptom is deeply misleading:
  # discovery works perfectly -- the game is listed with the right map and host
  # -- but every join silently bounces back to the browser at 999ms ping, with
  # no error anywhere. Name each VM after its agent, before WC3 is ever
  # launched, so the reboot costs no extra menu navigation.
  $hostName = 'WC3' + $Vm.ToUpper()
  $ps = 'C:' + [char]92 + 'Windows' + [char]92 + 'System32' + [char]92 + 'WindowsPowerShell' + [char]92 + 'v1.0' + [char]92 + 'powershell.exe'
  $hnLocal = Join-Path $OutDir 'hostname.txt'

  function Get-GuestHostname {
    if (Test-Path $hnLocal) { Remove-Item $hnLocal -Force }
    & $vmrun @guest runProgramInGuest $vmx -noWait $ps '-Command' '$env:COMPUTERNAME | Set-Content C:\hn.txt' 2>&1 | Out-Null
    Start-Sleep -Seconds 5
    & $vmrun @guest CopyFileFromGuestToHost $vmx 'C:\hn.txt' $hnLocal 2>&1 | Out-Null
    if (Test-Path $hnLocal) { return (Get-Content $hnLocal -Raw).Trim() }
    return ''
  }

  $current = Get-GuestHostname
  if ($current -eq $hostName) {
    Write-Host "  hostname already $hostName"
  } else {
    Write-Host "  renaming '$current' -> $hostName (LAN peer resolution)"
    $r = & $vmrun @guest runProgramInGuest $vmx $ps '-Command' "Rename-Computer -NewName $hostName -Force" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Rename-Computer failed: $r" }
    & $vmrun -T ws reset $vmx soft 2>&1 | Out-Null
    Start-Sleep -Seconds 15
    Wait-Desktop 'after rename'
    # Verify rather than assume: a silently-failed rename produces a VM that
    # tests fine on its own and then cannot be joined over LAN, which is a
    # miserable thing to debug later.
    $after = Get-GuestHostname
    if ($after -ne $hostName) { throw "Hostname is '$after', expected '$hostName' -- LAN peer resolution would break." }
    Write-Host "  hostname now $after"
  }

  # mDNS otherwise hands WC3 an IPv6 address for a peer and the join goes
  # nowhere. IPv4-only keeps discovery and connection on the same family.
  Write-Host '  disabling IPv6 on the guest adapter'
  & $vmrun @guest runProgramInGuest $vmx $ps '-Command' 'Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue' 2>&1 | Out-Null
}

# Mint with the NIC UNPLUGGED so WC3 commits to PLAY OFFLINE.
#
# With a live adapter that has no route (host-only), WC3 does not fail fast --
# it retries, so the "check your VPN" modal is dismissed by the OK click and
# immediately comes back. The PLAY OFFLINE click then lands on a modal that is
# up again, and the mint stalls at the error screen with everything after it
# clicking into nothing. With no cable at all it gives up at once and the
# offline path runs cleanly.
#
# This is done here rather than trusted to the vmx because the LAN work set
# ethernet0.startConnected = "TRUE" on some clones, and a revert restores
# whatever the snapshot held. Guest ops keep working -- VMware Tools talks over
# the hypervisor channel, not the network.
Write-Host 'Unplugging the NIC so WC3 goes offline without retrying...'
& $vmrun -T ws disconnectNamedDevice $vmx ethernet0 2>&1 | Out-Null
Start-Sleep -Seconds 3

$c = Vnc-Connect $port
try {
  if ("$($c.w)x$($c.h)" -ne $ui.framebuffer) {
    throw "Framebuffer $($c.w)x$($c.h) != expected $($ui.framebuffer); coordinates would miss."
  }
  # 1. Launch WC3 via Run dialog. Escape dismisses the path autocomplete
  #    dropdown, which otherwise swallows the Enter.
  Write-Host "Launching WC3..."
  Vnc-Key $c 0xFFEB 1; Start-Sleep -Milliseconds 100; Vnc-Key $c 0x72 1; Start-Sleep -Milliseconds 80; Vnc-Key $c 0x72 0; Vnc-Key $c 0xFFEB 0
  Start-Sleep -Seconds 2
  Vnc-TypeSmart $c '"C:\Program Files (x86)\Warcraft III\_retail_\x86_64\Warcraft III.exe"'
  Start-Sleep -Milliseconds 400
  Shot $c 'run-dialog'
  Vnc-Tap $c 0xFF1B; Start-Sleep -Milliseconds 200; Vnc-Tap $c 0xFF0D

  # 2. Battle.net: "Could not log in" -> Continue Offline.
  Write-Host "Waiting for Battle.net offline prompt..."
  Start-Sleep -Seconds 25
  Shot $c 'bnet-offline-prompt'
  Vnc-Click $c $ui.bnetContinueOffline[0] $ui.bnetContinueOffline[1]
  Start-Sleep -Seconds 10
  Shot $c 'bnet-main'
  # 3. Battle.net: Play.
  Vnc-Click $c $ui.bnetPlay[0] $ui.bnetPlay[1]

  # 4-5. WC3 launches -> VPN error OK -> PLAY OFFLINE.
  Write-Host "Waiting for WC3 process..."
  $sw=[Diagnostics.Stopwatch]::StartNew()
  do { Start-Sleep -Seconds 5; $p="$(& $vmrun @guest listProcessesInGuest $vmx 2>&1)" }
  while ($p -notmatch 'Warcraft III.exe' -and $sw.Elapsed.TotalSeconds -lt 180)
  Start-Sleep -Seconds 20
  Shot $c 'wc3-vpn-error'
  Vnc-Click $c $ui.wc3ErrorOk[0]  $ui.wc3ErrorOk[1]
  Start-Sleep -Seconds 2
  Vnc-Click $c $ui.wc3PlayOffline[0] $ui.wc3PlayOffline[1]
  Start-Sleep -Seconds 10
  Shot $c 'wc3-main-menu'

  # 6-7. Single Player -> Custom Games.
  Vnc-Click $c $ui.menuSinglePlayer[0] $ui.menuSinglePlayer[1]
  Start-Sleep -Seconds 4
  Shot $c 'single-player'
  Vnc-Click $c $ui.menuCustomGames[0] $ui.menuCustomGames[1]
  Start-Sleep -Seconds 6
  Shot $c 'create-game-root'
  Write-Host "At Create Game root (should be ABOVE the Download folder)."

  # 8. Bake the player name into the guest profile.
  #
  # A fresh profile has none, so WC3 raises ENTER PLAYER NAME on every CREATE.
  # Typing it during a test run is the single flakiest step in the harness --
  # WC3 samples the keyboard once per render frame and the field needs a moment
  # to take focus, so a dropped keystroke leaves an empty box and burns the run.
  # Setting it once here removes the dialog from the hot path entirely: the
  # tests get faster AND deterministic, instead of paying a retry to hide it.
  #
  # Slow and repeated is fine HERE -- minting is a one-off. What must not happen
  # is shipping a snapshot that still prompts, so this verifies and throws.
  Write-Host "Baking player name '$PlayerName' into the profile..."
  #
  # A fresh profile has no name, so WC3 raises ENTER PLAYER NAME on every
  # CREATE. Typing it during a test run is the flakiest step in the harness --
  # WC3 samples the keyboard once per render frame and the field needs a moment
  # to take focus, so one dropped keystroke leaves an empty box and burns the
  # run. Setting it once here removes the dialog from the hot path entirely:
  # tests get faster AND deterministic, with no retry hiding anything.
  #
  # The name lives only in WC3's memory -- it is in no file and no registry key
  # -- which is why it has to be baked into a LIVE snapshot.
  #
  # Keep the click count minimal. Every extra navigation step is a chance to
  # derail, and BACK is especially unforgiving: at the main menu that same
  # coordinate is EXIT, so one back-click too many quits WC3 and the snapshot
  # captures the Windows desktop instead of the game.
  Vnc-Click $c $ui.createButton[0] $ui.createButton[1];   Start-Sleep -Seconds 4
  Shot $c 'name-dialog'
  Vnc-Click $c $ui.nameField[0] $ui.nameField[1];         Start-Sleep -Seconds 1
  Vnc-TypeSmart $c $PlayerName;                           Start-Sleep -Seconds 1
  Vnc-Click $c $ui.confirmButton[0] $ui.confirmButton[1]; Start-Sleep -Seconds 6
  Shot $c 'after-name'

  # Reaching the lobby IS the proof the name was accepted: with an empty or
  # unconfirmed name WC3 keeps the dialog up and never gets here. The lobby is
  # identified by its bright title bar ("SINGLE-PLAYER CUSTOM LOBBY"), which the
  # dimmed modal does not have.
  # Capture on a FRESH connection. Vnc-Shot paints a new blank bitmap and fills
  # only the rectangles the server sends; a connection that has already received
  # a frame gets sent just the CHANGED region, so a second capture on the same
  # connection comes back nearly black. That is not a torn frame -- it is the
  # protocol working as designed, and it reads identically to "screen is dark".
  # A new client always gets a full frame.
  $lobbyShot = Join-Path $OutDir 'verify-lobby.png'
  $vc = Vnc-Connect $port
  try { Vnc-Shot $vc $lobbyShot } finally { $vc.cli.Close() }
  $titleLit = Get-RegionBrightness $lobbyShot 90 140 760 200
  Write-Host ("  lobby title region: {0}% lit" -f $titleLit)
  if ($titleLit -lt 10) {
    throw ("After confirming the name we are not in the lobby, so the name was " +
           "not accepted. Minting now would leave every test run flaky. See $OutDir")
  }

  # BACK from the lobby lands on the SINGLE PLAYER menu (Campaign / Custom
  # Campaign / Custom Games / Load), NOT the map list -- so re-enter Custom
  # Games to park where the runner expects. Getting this wrong is quiet and
  # nasty: the snapshot looks fine, then every run's first click lands on
  # "Custom Campaign" and the map never loads.
  Vnc-Click $c $ui.backButton[0] $ui.backButton[1];          Start-Sleep -Seconds 5
  Vnc-Click $c $ui.menuCustomGames[0] $ui.menuCustomGames[1]; Start-Sleep -Seconds 6
  Shot $c 'final-position'

  # Confirm we really are on the Create Game screen before freezing. Its
  # "CREATE GAME" heading lights the title region (~15%); the Single Player
  # menu has no heading there and reads 0%.
  $rootShot = Join-Path $OutDir 'verify-root.png'
  $rc = Vnc-Connect $port
  try { Vnc-Shot $rc $rootShot } finally { $rc.cli.Close() }
  $rootLit = Get-RegionBrightness $rootShot 90 140 760 200
  Write-Host ("  create-game heading: {0}% lit" -f $rootLit)
  if ($rootLit -lt 8) {
    throw ("Not parked on the Create Game screen, so every test run would " +
           "start from the wrong menu. See $rootShot")
  }

  # 9. PARK ABOVE THE DOWNLOAD FOLDER. Do not "fix" this by parking inside it.
  #
  # Parking inside looks better -- it would spare the runner a double-click that
  # is unreliable over VNC at 15fps -- and it was tried on murph on 2026-08-21.
  # It silently ran the WRONG MAP.
  #
  # A snapshot-restored WC3 keeps knowledge of the map files that existed when
  # the snapshot was taken (the same quirk that makes it reject a map which
  # OVERWRITES a name it already knew). Parked inside Download with a map
  # selected, the runner's firstMapRow click re-selects that STALE list entry
  # and WC3 loads the mint-time map from its own cache -- even though the runner
  # has deleted the whole Download directory and uploaded a fresh one. The proof
  # was a run whose ready marker advertised tests that had been deleted from the
  # source days earlier.
  #
  # Entering the folder from ABOVE is what forces a fresh directory read, so the
  # double-click is not incidental: it is the step that makes the run use the
  # map you just built. A flaky click that fails loudly beats a reliable one
  # that quietly tests the wrong binary.
  #
  # The block below is kept, disabled, so the next person reads this before
  # rediscovering it the expensive way.
  if ($false) {
  #
  # Row 1 of the map browser is "Download" at the top level and "(up one level)"
  # inside it, so where a VM is parked decides what the runner's first click
  # does. The clones were minted inconsistently -- murph above, boof inside --
  # and the runner, written for one of them, escaped upwards on the other and
  # ran a stock Blizzard map instead of the built one.
  #
  # Parking inside is the better of the two consistent choices: the runner then
  # never has to enter the folder, which removes a double-click from the hot
  # path. That click is genuinely unreliable over VNC at 15fps (WC3 samples the
  # mouse once per frame, so the two presses can land in one frame and read as a
  # single click), and the cheapest way to make an unreliable step stop mattering
  # is to stop performing it.
  #
  # Doing it HERE is safe in a way that doing it per-run is not: minting is a
  # one-off, so it can afford to look, retry and verify.
  #
  # It does NOT lock the map file. Measured on murph: with WC3 sitting inside
  # Download on a selected map, deleting the whole Download directory and
  # uploading a new one both succeeded. Nothing here overwrites a filename WC3
  # already knows -- the runner uploads a fresh random name every run -- which
  # is the case that actually breaks a snapshot-restored WC3.
  Write-Host 'Parking inside the Download folder...'
  $dl = "C:\Users\$($cfg.guestUser)\Documents\Warcraft III\Maps\Download"
  $mapSrc = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'dist\bin\TheTrainGame.w3x'
  if (-not (Test-Path $mapSrc)) { throw "No map at $mapSrc -- run 'npm run build' before minting." }
  & $vmrun @guest deleteDirectoryInGuest $vmx $dl 2>$null | Out-Null
  & $vmrun @guest createDirectoryInGuest $vmx $dl | Out-Null
  & $vmrun @guest CopyFileFromHostToGuest $vmx $mapSrc "$dl\ZZMINT.w3x" | Out-Null
  Start-Sleep -Seconds 3

  # Enter it, and CONFIRM rather than assume: inside Download the list holds two
  # rows and is empty beneath them (~6 mean brightness), at the top level it is
  # full of stock maps (~27). Threshold 15, measured on both.
  $inside = $false
  foreach ($attempt in 1..6) {
    Vnc-DblClick $c $ui.downloadFolder[0] $ui.downloadFolder[1]
    Start-Sleep -Seconds 2
    $probeShot = Join-Path $OutDir "enter-download-$attempt.png"
    $pc = Vnc-Connect $port
    try { Vnc-Shot $pc $probeShot } finally { $pc.cli.Close() }
    $lit = Get-ImageRegionBrightness $probeShot 590 430 390 560
    Write-Host ("  attempt {0}: list region {1}" -f $attempt, $lit)
    if ($lit -le 15) { $inside = $true; break }
  }
  if (-not $inside) {
    throw ("Could not enter the Download folder after 6 attempts, so this VM would " +
           "be minted in the wrong state. See $OutDir")
  }
  # Select the map so the parked state matches what a run expects to click.
  Vnc-Click $c $ui.firstMapRow[0] $ui.firstMapRow[1]
  Start-Sleep -Seconds 2
  Shot $c 'parked-inside-download'
  }

  # Leave the Download folder EMPTY. A file left here becomes a stale entry in
  # the snapshot's in-memory map list, which is the failure described above.
  $dl = "C:\Users\$($cfg.guestUser)\Documents\Warcraft III\Maps\Download"
  & $vmrun @guest deleteDirectoryInGuest $vmx $dl 2>$null | Out-Null
  & $vmrun @guest createDirectoryInGuest $vmx $dl | Out-Null
  Shot $c 'parked-above-download'
}
finally { $c.cli.Close() }

if ($DriveOnly) {
  Write-Host "DriveOnly: stopping before snapshot. Inspect $OutDir, then re-run with -SkipBoot to snapshot, or snapshot manually."
  return
}
# Silence host audio before freezing: WC3 has already initialised its device,
# so disconnecting it now is safe and the snapshot stays quiet on every revert.
# A snapshot is only worth taking if WC3 is still up. It is easy to lose it --
# BACK at the main menu is EXIT -- and a snapshot of the Windows desktop looks
# fine until every test mysteriously times out waiting for a map.
$procs = & $vmrun @guest listProcessesInGuest $vmx 2>&1
if ("$procs" -notmatch 'Warcraft III\.exe') {
  throw ("Warcraft III is not running, so there is nothing worth snapshotting " +
         "(a stray BACK at the main menu quits the game). Inspect $OutDir.")
}
Write-Host '  WC3 still running -- safe to snapshot'

Write-Host "Disconnecting sound..."
& $vmrun -T ws disconnectNamedDevice $vmx sound 2>&1 | Out-Null

if ((& $vmrun listSnapshots $vmx) -match '(?m)^create-game$') {
  Write-Host 'Removing the previous create-game snapshot...'
  & $vmrun deleteSnapshot $vmx create-game 2>&1 | Out-Null
}
Write-Host "Snapshotting create-game (~5 min)..."
$sw=[Diagnostics.Stopwatch]::StartNew()
& $vmrun -T ws snapshot $vmx create-game 2>&1 | Out-Null
Write-Host ("  done in {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds,0))
& $vmrun listSnapshots $vmx
Write-Host "Now set ready:true for '$Vm' in vms.json and validate with run-test.ps1 -Vm $Vm."
Write-Host "Parked ABOVE the Download folder, which is left EMPTY. The runner enters the"
Write-Host "folder itself, and that is what makes it read the map you actually built --"
Write-Host "see the long comment in this script before changing it."
