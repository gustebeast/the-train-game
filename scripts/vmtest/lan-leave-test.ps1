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
  [switch]$KeepIpv6,
  # Relaunch WC3 from scratch after the revert instead of using the WC3 frozen
  # into the snapshot. The snapshot's WC3 discovers LAN games correctly but every
  # join bounces at 999ms, while the one join that ever worked was a freshly
  # launched WC3 -- the suspicion being that a game restored from a memory
  # snapshot comes back with unusable network sockets. Costs ~3 min per run.
  [switch]$FreshLaunch
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
# Capture on a FRESH connection every time, not on the driving one.
#
# Vnc-Shot paints a blank bitmap and fills only the rectangles the server sends.
# A connection that has already received a frame is sent just the CHANGED
# region, so every capture after the first on the same connection comes back
# nearly black -- which is indistinguishable from "the screen went dark" and
# makes exactly the diagnostic screenshots you need to read useless. A new
# client always gets a full frame.
function Shot($c, $tag) {
  $script:step++
  $path = Join-Path $OutDir ("{0:D2}-{1}.png" -f $script:step, $tag)
  $port = if ($c.PSObject.Properties.Name -contains 'port') { $c.port } else { $null }
  if ($null -eq $port) { Vnc-Shot $c $path; return }
  $fresh = Vnc-Connect $port
  try { Vnc-Shot $fresh $path } finally { $fresh.cli.Close() }
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

# --- 1b. optionally relaunch WC3 so its sockets are built on a live adapter ---
if ($FreshLaunch) {
  Say 'killing WC3 on both and relaunching it fresh'
  foreach ($vm in @($h, $j)) {
    & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\taskkill.exe' '/IM' 'Warcraft III.exe' '/F' 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 8
  # Killing WC3 leaves the Battle.net client in the foreground (it sits at
  # "Connecting..." forever on host-only, which is fine). Relaunch from its Play
  # button rather than typing a path into the Run dialog -- the Run dialog never
  # gets focus with Battle.net in front, and this is the same path the mint uses.
  foreach ($vm in @($h, $j)) {
    $c = Vnc-Connect $vm.VncPort
    try {
      Vnc-Click $c $ui.bnetPlay[0] $ui.bnetPlay[1]
    } finally { $c.cli.Close() }
  }
  Say 'waiting for WC3 to come up on both'
  foreach ($vm in @($h, $j)) {
    $t = [Diagnostics.Stopwatch]::StartNew()
    do { Start-Sleep -Seconds 5; $p = "$(& $vmrun @guest listProcessesInGuest $vm.Vmx 2>&1)" }
    while ($p -notmatch 'Warcraft III\.exe' -and $t.Elapsed.TotalSeconds -lt 240)
    if ($p -notmatch 'Warcraft III\.exe') { throw "WC3 did not relaunch on $($vm.Name)" }
  }
  Start-Sleep -Seconds 30
  # Same offline path the mint drives: VPN error OK -> PLAY OFFLINE -> menu.
  foreach ($vm in @($h, $j)) {
    $c = Vnc-Connect $vm.VncPort
    try {
      Vnc-Click $c $ui.wc3ErrorOk[0] $ui.wc3ErrorOk[1];       Start-Sleep -Seconds 2
      Vnc-Click $c $ui.wc3PlayOffline[0] $ui.wc3PlayOffline[1]; Start-Sleep -Seconds 10
      Shot $c "fresh-$($vm.Name)-menu"
    } finally { $c.cli.Close() }
  }
  Say 'both relaunched and sitting at the main menu'
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
  # Where WC3 starts depends on how we got here, and getting this wrong is
  # destructive rather than merely wrong: BACK on the MAIN MENU is EXIT, so an
  # extra back-click quits the game.
  #   snapshot revert -> parked on Create Game, so two BACKs reach the main menu
  #   -FreshLaunch    -> already AT the main menu, so no BACKs at all
  if (-not $FreshLaunch) {
    Vnc-Click $conn $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3      # -> Single Player
    Vnc-Click $conn $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3      # -> main menu
  }
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
Vnc-Click $jc $lan.join[0] $lan.join[1]
# JOIN always raises ENTER PLAYER NAME. ALWAYS type into it -- never rely on the
# field being pre-filled.
#
# The baked name lives only in the snapshot's PROCESS MEMORY, so it is present
# on the resume path and GONE after -FreshLaunch, which arrives here with an
# empty field. WC3 refuses an empty name and the join never happens, and that
# looks identical -- on screen and in a packet capture -- to the join itself
# failing. Every -FreshLaunch result recorded before 2026-08-19 was measuring
# that, not the join.
#
# Typing is correct on both paths: it appends to the baked name on the resume
# path ('agentmurph') and stands alone after a fresh launch ('murph'). Both are
# non-empty and differ from the host's name, which is all the join requires.
Start-Sleep -Seconds 6
Shot $jc 'joiner-name-prompt'
Vnc-Click $jc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 400
Vnc-TypeSmart $jc $JoinVm; Start-Sleep -Milliseconds 400
Shot $jc 'joiner-name-typed'
Vnc-Click $jc $ui.confirmButton[0] $ui.confirmButton[1]
# Catch the moment of truth. A failed join shows its error briefly and then
# drops back to the browser, so a single screenshot 12s later only ever shows
# the aftermath -- which is why every run so far looked like "it just bounced".
# What address is WC3 actually dialling? The join is refused instantly and
# silently, so the useful question is not "did it fail" but "who did it try to
# talk to" -- an unreachable or wrong peer address looks exactly like this.
$dial = @'
$p = Get-Process 'Warcraft III' -ErrorAction SilentlyContinue
$out = @()
if ($null -eq $p) { $out += 'WC3 NOT RUNNING' }
else {
  $out += 'tcp:'
  Get-NetTCPConnection -OwningProcess $p.Id -ErrorAction SilentlyContinue |
    ForEach-Object { $out += ("  {0}:{1} -> {2}:{3} [{4}]" -f $_.LocalAddress,$_.LocalPort,$_.RemoteAddress,$_.RemotePort,$_.State) }
  $out += 'udp:'
  Get-NetUDPEndpoint -OwningProcess $p.Id -ErrorAction SilentlyContinue |
    ForEach-Object { $out += ("  {0}:{1}" -f $_.LocalAddress,$_.LocalPort) }
}
$out -join [Environment]::NewLine | Set-Content C:\dial.txt
'@
$dialLocal = Join-Path $OutDir 'dial.ps1'
Set-Content $dialLocal $dial -Encoding ASCII
# Dump BOTH sides at the same moment. The joiner alone cannot distinguish "it
# dialled the wrong address" from "it never dialled at all"; the host's inbound
# connection list separates them.
foreach ($vm in @($j, $h)) {
  $tag = if ($vm.Name -eq $j.Name) { 'joiner' } else { 'host' }
  $dst = Join-Path $OutDir "dial-$tag.txt"
  if (Test-Path $dst) { Remove-Item $dst -Force }
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $dialLocal 'C:\dial.ps1' | Out-Null
  & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' 'C:\dial.ps1' 2>&1 | Out-Null
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx 'C:\dial.txt' $dst 2>&1 | Out-Null
  if (Test-Path $dst) {
    Say "$tag WC3 sockets at join time:"
    Get-Content $dst | ForEach-Object { Write-Host "    $_" }
  } else {
    # A silent diagnostic failure is how three earlier conclusions in this
    # investigation turned out to be wrong. Say so rather than letting an
    # empty result read as "there was nothing to see".
    Say "WARNING: $tag socket dump produced NOTHING -- this run is blind on that side."
  }
}
Start-Sleep -Seconds 2;  Shot $jc 'joiner-after-confirm-2s'
Start-Sleep -Seconds 3;  Shot $jc 'joiner-after-confirm-5s'
Start-Sleep -Seconds 4;  Shot $jc 'joiner-after-confirm-9s'
Start-Sleep -Seconds 6
Shot $jc 'joiner-joined'

# WC3 records what actually happened to a join attempt. Pull both logs while the
# guests are still up -- reading pixels only tells you the joiner bounced back
# to the browser, not why.
foreach ($vm in @($h, $j)) {
  $dst = Join-Path $OutDir ("war3log-" + $vm.Name + ".txt")
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx (Join-Path $vm.GuestHome 'Documents\Warcraft III\Logs\War3Log.txt') $dst 2>&1 | Out-Null
  if (Test-Path $dst) { Say ("captured War3Log for " + $vm.Name) }
}
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
