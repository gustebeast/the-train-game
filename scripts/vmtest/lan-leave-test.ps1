# LAN test: a leaving player's units are despawned.
#
#   npm run build      # with initTestKit('leave') set in main.ts
#   powershell -File scripts/vmtest/lan-leave-test.ps1
#
# Needs TWO VMs, because the behaviour under test (playerLeave.ts reacting to
# EVENT_PLAYER_LEAVE) cannot be exercised in single player -- it needs a second
# real player who can quit. Host on -HostVm, join on -JoinVm, let the map's
# 'leave' test start itself via autoRun, kill WC3 on the joiner to simulate an
# abrupt disconnect, then read the verdict off the HOST (still running).
#
# autoRun matters here: typing a chat command over VNC into two machines is the
# least reliable step available, and this flow removes it entirely.
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [string]$Map,
  [int]$ResultTimeoutSec = 90,
  [string]$OutDir = 'C:\VMs\lan-leave',
  # The base image ships firewall rules for WC3 and Bonjour, but with the
  # firewall ON the LAN join still bounces (discovery works, connect does not).
  # Disabling it in-guest is the configuration proven to work. Applied AFTER the
  # revert, since the revert would undo it. -KeepFirewall to test the rules.
  [switch]$KeepFirewall,
  # mDNS resolves the peer's hostname to an IPv6 LINK-LOCAL address
  # (fe80::...) when IPv6 is on, and the join then fails while discovery still
  # works -- the misleading 999ms-bounce signature. Forcing IPv4 makes the peer
  # resolve to its 192.168.x address. -KeepIpv6 to test with it left on.
  [switch]$KeepIpv6
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) }

$h = Get-TestVm $HostVm
$j = Get-TestVm $JoinVm
if (-not $Map) { $Map = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'dist\bin\TheTrainGame.w3x' }
if (-not (Test-Path $Map)) { throw "No map at $Map -- run 'npm run build' first." }
$ui = $h.Ui
$guest = @('-T', 'ws', '-gu', $h.GuestUser, '-gp', $h.GuestPassword)

# LAN-only click targets, kept here rather than in vms.json because only this
# script uses them. Captured at the 1656x1249 fullscreen framebuffer, same as
# the shared uiSet.
$lan = @{
  back          = @(137, 1204)
  menuLan       = @(1226, 711)
  create        = @(785, 1047)
  gameName      = @(240, 307)
  refresh       = @(954, 167)
  firstGameRow  = @(400, 333)
  join          = @(637, 1047)
}
$step = 0
function Shot($c, $tag) {
  $script:step++
  Vnc-Shot $c (Join-Path $OutDir ("{0:D2}-{1}.png" -f $script:step, $tag))
}

# --- 1. both VMs to a clean create-game, networked ------------------------
Say "reset $($h.Name) + $($j.Name)"
foreach ($vm in @($h, $j)) {
  Reset-OrResumeTestVm $vm -Log { param($m) }
  & $vmrun -T ws disconnectNamedDevice $vm.Vmx sound 2>&1 | Out-Null
  # LAN needs the NIC. The snapshots boot with it disconnected for offline play.
  & $vmrun -T ws connectNamedDevice $vm.Vmx ethernet0 2>&1 | Out-Null
}
Start-Sleep -Seconds 8

if (-not $KeepFirewall) {
  Say 'disabling guest firewalls (LAN join needs it; see -KeepFirewall)'
  $fwPs = Join-Path $OutDir 'fwoff.ps1'
  Set-Content $fwPs 'Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False' -Encoding utf8
  foreach ($vm in @($h, $j)) {
    & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $fwPs "$($vm.GuestHome)\fwoff.ps1" | Out-Null
    # No -interactive: that runs unelevated and the change silently fails.
    & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' "$($vm.GuestHome)\fwoff.ps1" 2>&1 | Out-Null
  }
}

if (-not $KeepIpv6) {
  Say 'disabling IPv6 on the guest adapters (mDNS otherwise hands WC3 a link-local address)'
  $v6 = Join-Path $OutDir 'ipv6off.ps1'
  Set-Content $v6 'Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue' -Encoding utf8
  foreach ($vm in @($h, $j)) {
    & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $v6 (Join-Path $vm.GuestHome 'ipv6off.ps1') | Out-Null
    & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' (Join-Path $vm.GuestHome 'ipv6off.ps1') 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 6
}

# --- 2. the SAME map filename on both -- LAN matches host and joiner by name --
$shared = "ZZLAN$(Get-Random -Minimum 1000 -Maximum 9999).w3x"
Say "upload $shared to both"
foreach ($vm in @($h, $j)) {
  $dl = "$($vm.GuestHome)\Documents\Warcraft III\Maps\Download"
  & $vmrun @guest deleteDirectoryInGuest $vm.Vmx $dl 2>$null | Out-Null
  & $vmrun @guest createDirectoryInGuest $vm.Vmx $dl | Out-Null
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $Map "$dl\$shared" | Out-Null
}

# --- 3. out of Create Game and into the LAN menu --------------------------
# One snapshot serves single player AND LAN, so a LAN run pays this navigation.
function Enter-Lan($conn) {
  Vnc-Click $conn $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3        # -> Single Player
  Vnc-Click $conn $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3        # -> main menu
  # The first LAN click is often eaten by the menu transition.
  Vnc-Click $conn $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 3
  Vnc-Click $conn $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 5
}
# The map browser remembers its last folder, so walk up until Download is top.
function Enter-Download($conn) {
  for ($i = 0; $i -lt 3; $i++) {
    Vnc-DblClick $conn $ui.downloadFolder[0] $ui.downloadFolder[1]
    Start-Sleep -Seconds 2
  }
}

Say 'host: into LAN'
$hc = Vnc-Connect $h.VncPort
Enter-Lan $hc
Shot $hc 'host-lan'
Say 'host: create game'
Vnc-Click $hc $lan.create[0] $lan.create[1]; Start-Sleep -Seconds 4
Vnc-Click $hc $lan.gameName[0] $lan.gameName[1]; Start-Sleep -Milliseconds 400
$gameName = "leave$(Get-Random -Minimum 100 -Maximum 999)"
Vnc-TypeSmart $hc $gameName; Start-Sleep -Milliseconds 400
Enter-Download $hc
Vnc-Click $hc $ui.firstMapRow[0] $ui.firstMapRow[1]; Start-Sleep -Seconds 1
Shot $hc 'host-map-selected'
Vnc-Click $hc $ui.createButton[0] $ui.createButton[1]; Start-Sleep -Seconds 4
Vnc-Click $hc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 400
Vnc-TypeSmart $hc $HostVm; Start-Sleep -Milliseconds 300
Vnc-Click $hc $ui.confirmButton[0] $ui.confirmButton[1]; Start-Sleep -Seconds 6
Shot $hc 'host-lobby'
Say "host: lobby up as '$gameName'"

# --- 4. joiner finds and joins -------------------------------------------
Say 'joiner: into LAN'
$jc = Vnc-Connect $j.VncPort
Enter-Lan $jc
Vnc-Click $jc $lan.refresh[0] $lan.refresh[1]; Start-Sleep -Seconds 5
Shot $jc 'joiner-list'
Vnc-Click $jc $lan.firstGameRow[0] $lan.firstGameRow[1]; Start-Sleep -Milliseconds 700
Vnc-Click $jc $lan.join[0] $lan.join[1]; Start-Sleep -Seconds 3
# The player-name prompt appears on every JOIN and the typing does not always
# land, so screenshot it rather than trusting it.
Vnc-Click $jc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 500
Vnc-TypeSmart $jc $JoinVm; Start-Sleep -Milliseconds 400
Shot $jc 'joiner-name'
Vnc-Click $jc $ui.confirmButton[0] $ui.confirmButton[1]; Start-Sleep -Seconds 10
Shot $jc 'joiner-joined'
Shot $hc 'host-lobby-2p'

# --- 5. host starts the match -------------------------------------------
Say 'host: start game'
Vnc-Click $hc $ui.startGameButton[0] $ui.startGameButton[1]
Start-Sleep -Seconds 12
Vnc-Tap $hc 0x20; Vnc-Tap $jc 0x20      # dismiss "press any key to continue"
Start-Sleep -Seconds 10
Shot $hc 'host-ingame'
Shot $jc 'joiner-ingame'

# autoRun starts the test itself. Wait for its baseline line before quitting, so
# we know it is genuinely watching for the leave and not still loading.
Say 'waiting for the test to start on the host'
$deadline = (Get-Date).AddSeconds(60)
$started = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $raw = Get-TestVmResultFile $h -Name 'test_leave.txt' -Destination (Join-Path $OutDir 'partial.txt')
  if ($raw -and $raw -match 'players=') { $started = $true; break }
}
if (-not $started) {
  Shot $hc 'host-no-start'; Shot $jc 'joiner-no-start'
  $hc.cli.Close(); $jc.cli.Close()
  throw "The 'leave' test never started on the host. Is the map built with initTestKit('leave')? See $OutDir."
}
Say 'test running; killing WC3 on the joiner'

# --- 6. the leave -------------------------------------------------------
# A hard process kill is what an abrupt disconnect looks like to the host, which
# is the case worth testing; a clean menu quit is the gentler path.
$killPs = Join-Path $OutDir 'killwc3.ps1'
Set-Content $killPs "Get-Process 'Warcraft III' -ErrorAction SilentlyContinue | Stop-Process -Force" -Encoding utf8
& $vmrun @guest CopyFileFromHostToGuest $j.Vmx $killPs "$($j.GuestHome)\killwc3.ps1" | Out-Null
& $vmrun @guest runProgramInGuest $j.Vmx 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' "$($j.GuestHome)\killwc3.ps1" 2>&1 | Out-Null

# --- 7. read the verdict off the host -----------------------------------
Say 'waiting for results on the host'
$deadline = (Get-Date).AddSeconds($ResultTimeoutSec)
$raw = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $raw = Get-TestVmResultFile $h -Name 'test_leave.txt' -Destination (Join-Path $OutDir 'test_leave.txt')
  if ($raw -and $raw -match '"done"') { break }
}
Shot $hc 'host-final'
$hc.cli.Close(); $jc.cli.Close()

$results = [ordered]@{}
if ($raw) {
  foreach ($m in [regex]::Matches($raw, 'Preload\(\s*"(.*?)"\s*\)')) {
    $line = $m.Groups[1].Value
    if ($line -in @('started', 'done')) { continue }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $results[$line.Substring(0, $eq)] = $line.Substring($eq + 1)
  }
}

# Leave both VMs parked, never running -- same contract as the normal runner.
Complete-TestVm $h -Log { param($m) }
Complete-TestVm $j -Log { param($m) }

Write-Host ''
if ($results.Count -gt 0) {
  Write-Host 'Results (from the host):'
  $results.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-16} {1}" -f $_.Key, $_.Value) }
}
$finished = $raw -and $raw -match '"done"'
$leaverGone = $results.Contains('leaverAfter') -and [double]$results['leaverAfter'] -eq 0
$stayerKept = $results.Contains('stayerAfter') -and [double]$results['stayerAfter'] -gt 0
Write-Host ''
if ($finished -and $leaverGone -and $stayerKept) {
  Write-Host ("PASS: the leaver's units were despawned, the remaining player kept theirs ({0}s)" -f [math]::Round($sw.Elapsed.TotalSeconds, 1)) -ForegroundColor Green
  exit 0
}
if (-not $finished) { Write-Host 'FAIL: the test never reported done.' -ForegroundColor Red }
elseif (-not $leaverGone) { Write-Host "FAIL: leaver still had units after leaving (leaverAfter=$($results['leaverAfter']))." -ForegroundColor Red }
else { Write-Host "FAIL: remaining player lost units too (stayerAfter=$($results['stayerAfter'])) -- the despawn is too broad." -ForegroundColor Red }
Write-Host "Screenshots: $OutDir"
exit 1
