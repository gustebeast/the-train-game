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
  [switch]$SkipBoot
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'

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
}

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
}
finally { $c.cli.Close() }

if ($DriveOnly) {
  Write-Host "DriveOnly: stopping before snapshot. Inspect $OutDir, then re-run with -SkipBoot to snapshot, or snapshot manually."
  return
}
# Silence host audio before freezing: WC3 has already initialised its device,
# so disconnecting it now is safe and the snapshot stays quiet on every revert.
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
Write-Host "This snapshot serves single player AND LAN: it is parked at the Custom Games"
Write-Host "root as before, and the base image carries Bonjour + firewall rules, so a LAN"
Write-Host "test just navigates there from the same snapshot."
