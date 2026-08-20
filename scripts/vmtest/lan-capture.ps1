# Does ANY packet cross between the guests during a join attempt?
#
# This is the measurement that has been missing all along. Every previous test
# asked the OS a question (can I ping, can I open a socket, does the name
# resolve) and every one passed; none of them observed what WC3 itself puts on
# the wire. pktmon is built into Windows, so the host can capture the joiner's
# traffic while the join is actually attempted.
#
# It settles the fork directly:
#   packets arrive  -> the network is fine and WC3 is refusing at the protocol
#                      level (version, map, identity, something in the payload)
#   nothing arrives -> WC3 is not sending, and the problem is on the joiner
#                      before the wire
#
# Two earlier conclusions in this investigation were wrong because a silent
# harness failure was read as a measurement, so this fails loudly instead of
# returning an empty capture:
#   - the capture is verified to have started
#   - a control ping from the joiner must appear in the capture, proving pktmon
#     is genuinely recording that peer's traffic
#
#   powershell -File scripts/vmtest/lan-capture.ps1
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [string]$Map,
  [string]$HostIp = '192.168.31.128',
  [string]$JoinIp = '192.168.31.129',
  # Relaunch WC3 AFTER the map is uploaded, so the game indexes the map at
  # startup like a real player's would.
  #
  # Every run in this investigation -- including the two that relaunched WC3 --
  # copied the map into the guest while WC3 was already running, because the
  # upload step sits after the launch step. Reforged builds its map list at
  # startup and does not transfer custom maps over LAN, so a joiner that cannot
  # find the map locally has nothing to do but refuse. That matches the capture
  # exactly: the joiner emits no packets at all, so it is not being rejected by
  # the host, it is giving up on its own.
  [switch]$FreshLaunch,
  # Run this one attempt on NAT instead of host-only, i.e. WITH internet access.
  #
  # The joiner spends a join attempt failing DNS lookups for us.actual.battle.net
  # and friends, and the only join that ever succeeded in this project predates
  # the switch to host-only. This is the single measurement that settles whether
  # Reforged needs to reach its Battle.net layer before it will attempt a LAN
  # connection: on NAT the joiner either emits a SYN or it does not.
  #
  # Only ever use this deliberately. Going online refreshes the offline
  # entitlement (which is time-based, not consumed) but it also burns the shared
  # Battle.net session token across clones, so expect at most one VM to
  # auto-login afterwards. Nothing here is permanent: a snapshot revert rewrites
  # the vmx back to host-only on its own, and this script restores it too.
  [switch]$Nat,
  # Restart mDNSResponder after the NIC is connected, so it publishes a host
  # (A) record for the guest. See the block where this is used.
  [switch]$RestartBonjour,
  [string]$OutDir = 'C:\VMs\lan-capture'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$psExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) }

$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$ui = $cfg.uiSets.fullscreen
$guest = @('-T', 'ws', '-gu', $cfg.guestUser, '-gp', $cfg.guestPassword)
$h = Get-TestVm $HostVm
$j = Get-TestVm $JoinVm
if (-not $Map) { $Map = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'dist\bin\TheTrainGame.w3x' }
if (-not (Test-Path $Map)) { throw "No map at $Map -- run 'npm run build' first." }

$lan = @{ back = @(137, 1204); menuLan = @(1226, 711); create = @(785, 1047)
          gameName = @(240, 307); refresh = @(954, 167); firstGameRow = @(400, 333); join = @(637, 1047) }

function Guest-Eval($vm, [string]$body, [string]$tag) {
  $local = Join-Path $OutDir "$tag.ps1"
  Set-Content $local $body -Encoding ASCII
  $out = Join-Path $OutDir "$tag.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $local "C:\p_$tag.ps1" | Out-Null
  & $vmrun @guest runProgramInGuest $vm.Vmx $psExe '-ExecutionPolicy' 'Bypass' '-File' "C:\p_$tag.ps1" 2>&1 | Out-Null
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx 'C:\probe.txt' $out 2>&1 | Out-Null
  if (Test-Path $out) { return (Get-Content $out -Raw).TrimEnd() }
  return '(NO OUTPUT -- the guest side did not run; treat as unmeasured)'
}
function Shot($vm, $tag) {
  $c = Vnc-Connect $vm.VncPort
  try { Vnc-Shot $c (Join-Path $OutDir "$tag.png") } finally { $c.cli.Close() }
}

Say 'reset both'
foreach ($vm in @($h, $j)) {
  & $vmrun revertToSnapshot $vm.Vmx $vm.Snapshot 2>&1 | Out-Null
  if ($Nat) {
    # The edit MUST sit between the revert and the start. Reverting restores the
    # snapshot's hardware config and rewrites this line back to host-only, so an
    # edit made any earlier is silently undone -- which would leave the run
    # measuring host-only while reporting NAT.
    $txt = [IO.File]::ReadAllText($vm.Vmx)
    $txt = $txt.Replace('ethernet0.connectionType = "hostonly"', 'ethernet0.connectionType = "nat"')
    [IO.File]::WriteAllText($vm.Vmx, $txt)
    $now = (Select-String -Path $vm.Vmx -Pattern 'ethernet0.connectionType').Line
    if ($now -notmatch 'nat') { throw "Could not switch $($vm.Name) to NAT; vmx still says: $now" }
  }
  & $vmrun -T ws start $vm.Vmx nogui 2>&1 | Out-Null
  & $vmrun -T ws disconnectNamedDevice $vm.Vmx sound 2>&1 | Out-Null
  & $vmrun -T ws connectNamedDevice $vm.Vmx ethernet0 2>&1 | Out-Null
}
Start-Sleep -Seconds 35

Say 'firewall off, IPv6 off (the configuration the join runs under)'
$prep = @'
try { Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False -ErrorAction Stop } catch {}
Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
('host=' + $env:COMPUTERNAME + ' fw=' + (((Get-NetFirewallProfile) | ForEach-Object { $_.Enabled }) -join ',')) | Set-Content C:\probe.txt
'@
foreach ($vm in @($h, $j)) {
  $state = Guest-Eval $vm $prep "prep-$($vm.Name)"
  Say "  $state"
  if ($state -match 'True') { throw "Firewall still enabled on $($vm.Name) -- a capture here would be meaningless." }
}

# NAT puts the guests on a different subnet, so the hard-coded host-only
# addresses would aim the pktmon filter and the control ping at machines that no
# longer exist. Ask the guests instead of assuming.
$addr = @'
$l = @()
$l += 'ip=' + (((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress) -join ',')
try { $l += 'bnet=' + (([System.Net.Dns]::GetHostAddresses('us.actual.battle.net') | ForEach-Object { $_.IPAddressToString }) -join ',') }
catch { $l += 'bnet=UNRESOLVED' }
$l -join ' ' | Set-Content C:\probe.txt
'@
foreach ($vm in @($h, $j)) {
  $info = Guest-Eval $vm $addr "addr-$($vm.Name)"
  Say "  $($vm.Name): $info"
  if ($info -match 'ip=([\d\.]+)') {
    if ($vm.Name -eq $h.Name) { $HostIp = $matches[1] } else { $JoinIp = $matches[1] }
  }
  # Fail loudly rather than run a NAT test that is secretly still offline: the
  # whole point of -Nat is that Battle.net is reachable.
  if ($Nat -and $info -match 'bnet=UNRESOLVED') { throw "$($vm.Name) is on NAT but still cannot resolve Battle.net -- the run would prove nothing." }
  if (-not $Nat -and $info -notmatch 'bnet=UNRESOLVED') { Say "  NOTE: $($vm.Name) resolved Battle.net without -Nat; this guest is NOT isolated." }
}
Say "addresses in play: host=$HostIp joiner=$JoinIp"

if ($RestartBonjour) {
  # Restart mDNSResponder now that the NIC is live.
  #
  # Measured cause of the failed join: the host announces its _blizzard._udp
  # service (so the game lists correctly, with the right name, map and player
  # count) but never publishes an A record for its own hostname. The SRV record
  # points at WC3DOUGIE.local. and nothing ever answers with an address for it,
  # so the joiner holds a name it cannot resolve, has nothing to dial, and gives
  # up silently -- no packets, no error, a permanent 999ms ping.
  #
  # The responder is started inside the snapshot while the adapter is still
  # disconnected, which leaves it with no interface to publish a host record on.
  # WC3's own service registration happens later, when hosting, and does go out.
  #
  # Note that resolving the peer from PowerShell does NOT catch this: the Windows
  # resolver falls back to LLMNR and NetBIOS, which both work here. WC3 uses the
  # Bonjour API, which has only mDNS.
  Say 'restarting Bonjour on both, now that the adapter is up'
  $bonjour = @'
Restart-Service 'Bonjour Service' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6
('bonjour=' + (Get-Service 'Bonjour Service' -ErrorAction SilentlyContinue).Status) | Set-Content C:\probe.txt
'@
  foreach ($vm in @($h, $j)) {
    $st = Guest-Eval $vm $bonjour "bonjour-$($vm.Name)"
    Say "  $($vm.Name): $st"
    if ($st -notmatch 'Running') { throw "Bonjour is not running on $($vm.Name) after the restart." }
  }
  Start-Sleep -Seconds 12
}

Say 'upload the map to both'
$shared = "ZZCAP$(Get-Random -Minimum 1000 -Maximum 9999).w3x"
foreach ($vm in @($h, $j)) {
  $dl = "$($vm.GuestHome)\Documents\Warcraft III\Maps\Download"
  & $vmrun @guest deleteDirectoryInGuest $vm.Vmx $dl 2>$null | Out-Null
  & $vmrun @guest createDirectoryInGuest $vm.Vmx $dl | Out-Null
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $Map "$dl\$shared" | Out-Null
}

if ($FreshLaunch) {
  Say 'restarting WC3 on both, now that the map is already on disk'
  foreach ($vm in @($h, $j)) {
    & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\taskkill.exe' '/IM' 'Warcraft III.exe' '/F' 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 8
  foreach ($vm in @($h, $j)) {
    $c = Vnc-Connect $vm.VncPort
    try { Vnc-Click $c $ui.bnetPlay[0] $ui.bnetPlay[1] } finally { $c.cli.Close() }
  }
  foreach ($vm in @($h, $j)) {
    $t = [Diagnostics.Stopwatch]::StartNew()
    do { Start-Sleep -Seconds 5; $procs = "$(& $vmrun @guest listProcessesInGuest $vm.Vmx 2>&1)" }
    while ($procs -notmatch 'Warcraft III\.exe' -and $t.Elapsed.TotalSeconds -lt 240)
    if ($procs -notmatch 'Warcraft III\.exe') { throw "WC3 did not relaunch on $($vm.Name)" }
  }
  Start-Sleep -Seconds 30
  foreach ($vm in @($h, $j)) {
    $c = Vnc-Connect $vm.VncPort
    try {
      Vnc-Click $c $ui.wc3ErrorOk[0] $ui.wc3ErrorOk[1];         Start-Sleep -Seconds 2
      Vnc-Click $c $ui.wc3PlayOffline[0] $ui.wc3PlayOffline[1]; Start-Sleep -Seconds 10
    } finally { $c.cli.Close() }
  }
  Say 'both at the main menu with the map already indexed'
}

Say 'host: into LAN and hosting'
$hc = Vnc-Connect $h.VncPort
try {
  # BACK on the MAIN MENU is EXIT. These two backs are only correct when WC3 was
  # resumed from the snapshot and is parked on Create Game.
  if (-not $FreshLaunch) {
    Vnc-Click $hc $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3
    Vnc-Click $hc $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3
  }
  Vnc-Click $hc $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 3
  Vnc-Click $hc $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 5
  Vnc-Click $hc $lan.create[0] $lan.create[1]; Start-Sleep -Seconds 4
  Vnc-Click $hc $lan.gameName[0] $lan.gameName[1]; Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $hc 'cap'; Start-Sleep -Milliseconds 400
  for ($i = 0; $i -lt 3; $i++) { Vnc-DblClick $hc $ui.downloadFolder[0] $ui.downloadFolder[1]; Start-Sleep -Seconds 2 }
  Vnc-Click $hc $ui.firstMapRow[0] $ui.firstMapRow[1]; Start-Sleep -Seconds 1
  Vnc-Click $hc $ui.createButton[0] $ui.createButton[1]; Start-Sleep -Seconds 4
  Vnc-Click $hc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $hc $HostVm; Start-Sleep -Milliseconds 300
  Vnc-Click $hc $ui.confirmButton[0] $ui.confirmButton[1]; Start-Sleep -Seconds 8
} finally { $hc.cli.Close() }
Shot $h 'host-lobby'
Say 'host: lobby up'

# --- start capturing the joiner's traffic on the host ----------------------
Say 'host: starting pktmon, filtered to the joiner'
$capStart = @"
pktmon filter remove | Out-Null
pktmon filter add lanpeer -i $JoinIp | Out-Null
pktmon start --capture --pkt-size 256 --file-name C:\cap.etl --file-size 64 2>&1 | Set-Content C:\probe.txt
Add-Content C:\probe.txt ('status: ' + ((pktmon status) -join ' | '))
"@
$started = Guest-Eval $h $capStart 'cap-start'
Write-Host $started
if ($started -notmatch 'ogging|tarted|ctive') { throw "pktmon did not report that it started -- refusing to run a blind capture. Got: $started" }

# Capture on the JOINER too, and with NO address filter.
#
# The host-side capture can only ever see traffic aimed at the host, so "the
# joiner sent nothing" is really "the joiner sent nothing TO THE HOST" -- it
# cannot distinguish that from the joiner dialling somewhere else entirely
# (itself over loopback, a stale address, the wrong interface). Unfiltered on
# the joiner, every packet WC3 emits is visible wherever it is addressed.
Say 'joiner: starting pktmon, unfiltered'
$capStartJ = @'
pktmon filter remove | Out-Null
pktmon start --capture --pkt-size 256 --file-name C:\cap.etl --file-size 64 2>&1 | Set-Content C:\probe.txt
Add-Content C:\probe.txt ('status: ' + ((pktmon status) -join ' | '))
'@
$startedJ = Guest-Eval $j $capStartJ 'cap-start-joiner'
if ($startedJ -notmatch 'ogging|tarted|ctive') { throw "pktmon did not start on the joiner. Got: $startedJ" }

# Control: a ping from the joiner MUST show up. If it does not, the capture is
# not seeing this peer and any 'no packets' result would be meaningless.
Say 'joiner: control ping (must appear in the capture)'
Guest-Eval $j "Test-Connection -ComputerName $HostIp -Count 3 -ErrorAction SilentlyContinue | Out-Null; 'pinged' | Set-Content C:\probe.txt" 'ctrl-ping' | Out-Null

# --- the join attempt ------------------------------------------------------
Say 'joiner: into LAN and joining'
$jc = Vnc-Connect $j.VncPort
try {
  if (-not $FreshLaunch) {
    Vnc-Click $jc $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3
    Vnc-Click $jc $lan.back[0] $lan.back[1]; Start-Sleep -Seconds 3
  }
  Vnc-Click $jc $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 3
  Vnc-Click $jc $lan.menuLan[0] $lan.menuLan[1]; Start-Sleep -Seconds 5
  Vnc-Click $jc $lan.refresh[0] $lan.refresh[1]; Start-Sleep -Seconds 5
} finally { $jc.cli.Close() }
Shot $j 'joiner-list'
$jc = Vnc-Connect $j.VncPort
try {
  Vnc-Click $jc $lan.firstGameRow[0] $lan.firstGameRow[1]; Start-Sleep -Milliseconds 700
  Vnc-Click $jc $lan.join[0] $lan.join[1]; Start-Sleep -Seconds 6
} finally { $jc.cli.Close() }
Shot $j 'joiner-name-prompt'
# ALWAYS type a name, never rely on the field being pre-filled.
#
# The baked player name lives only in the snapshot's process memory, so a
# -FreshLaunch run kills it and arrives here with an EMPTY field. WC3 refuses an
# empty name and the join never happens -- which is indistinguishable, in the
# capture and on screen, from the join failing. Every fresh-launch result in
# this investigation before this fix was measuring that, not the join.
#
# Typing is safe in both paths: the snapshot path appends to the baked name
# ('agentmurph'), the fresh path types it alone ('murph'). Both are non-empty
# and both differ from the host's name, which is all that matters.
$jc = Vnc-Connect $j.VncPort
try {
  Vnc-Click $jc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $jc $JoinVm; Start-Sleep -Milliseconds 400
} finally { $jc.cli.Close() }
Shot $j 'joiner-name-typed'
$jc = Vnc-Connect $j.VncPort
try { Vnc-Click $jc $ui.confirmButton[0] $ui.confirmButton[1] } finally { $jc.cli.Close() }
Start-Sleep -Seconds 10
Shot $j 'joiner-after-confirm'
Shot $h 'host-after-join'

# --- stop and decode -------------------------------------------------------
Say 'host: stopping capture and decoding'
$capStop = @'
pktmon stop | Out-Null
Start-Sleep -Seconds 2
pktmon etl2txt C:\cap.etl --out C:\cap.txt 2>&1 | Out-Null
if (Test-Path C:\cap.txt) {
  $lines = Get-Content C:\cap.txt
  ('decoded lines: ' + $lines.Count) | Set-Content C:\probe.txt
  Add-Content C:\probe.txt (($lines | Select-Object -First 400) -join [Environment]::NewLine)
} else { 'NO DECODE OUTPUT' | Set-Content C:\probe.txt }
'@
$decoded = Guest-Eval $h $capStop 'cap-stop'
Set-Content (Join-Path $OutDir 'capture.txt') $decoded -Encoding utf8

# The joiner's own view: everything WC3 put on the wire, to any destination.
# Decoded with a bigger window because this one is unfiltered.
$capStopJ = $capStop.Replace('Select-Object -First 400', 'Select-Object -First 4000')
$decodedJ = Guest-Eval $j $capStopJ 'cap-stop-joiner'
Set-Content (Join-Path $OutDir 'capture-joiner.txt') $decodedJ -Encoding utf8
Say ("joiner capture written to " + (Join-Path $OutDir 'capture-joiner.txt'))

$icmp = ([regex]::Matches($decoded, 'ICMP')).Count
Say "capture decoded; ICMP records (the control): $icmp"
if ($icmp -eq 0) {
  Write-Host 'INVALID: the control ping never appeared -- pktmon was not capturing this peer. No conclusion can be drawn.' -ForegroundColor Yellow
} else {
  Write-Host "Control ping present, so the capture is genuinely recording $JoinIp." -ForegroundColor Green
}
Write-Host ''
Write-Host '--- first 120 decoded records ---'
($decoded -split "`r?`n" | Select-Object -First 120) | ForEach-Object { Write-Host "  $_" }

# The question this whole script exists to answer: did the joiner's WC3 try to
# open a connection at all? On host-only the answer has been a flat no, to any
# address, every time.
$syn = ([regex]::Matches($decodedJ, 'Flags \[S\]|SYN')).Count
Write-Host ''
if ($syn -gt 0) {
  Write-Host "JOINER ATTEMPTED A CONNECTION: $syn SYN packet(s) in its own capture." -ForegroundColor Green
} else {
  Write-Host 'JOINER SENT NO SYN AT ALL -- it gave up before transmitting, same as every host-only run.' -ForegroundColor Red
}
if ($Nat) {
  Say 'restoring host-only networking on both'
  foreach ($vm in @($h, $j)) {
    $txt = [IO.File]::ReadAllText($vm.Vmx)
    $txt = $txt.Replace('ethernet0.connectionType = "nat"', 'ethernet0.connectionType = "hostonly"')
    [IO.File]::WriteAllText($vm.Vmx, $txt)
  }
}
Say "full capture in $(Join-Path $OutDir 'capture.txt')"
