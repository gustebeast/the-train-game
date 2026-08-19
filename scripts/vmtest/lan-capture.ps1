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
Say "full capture in $(Join-Path $OutDir 'capture.txt')"
