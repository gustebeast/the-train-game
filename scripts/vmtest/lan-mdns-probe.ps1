# What does the host's LAN advertisement actually say?
#
# Measured in lan-leave-test.ps1: at the moment of a join the joiner's WC3 has
# NO connection to the host at all -- not a failed one, not a SYN_SENT. Every
# established socket it owns is to 127.0.0.1:5354, which is mDNSResponder. So
# the join dies before any packet is aimed at the peer, and the only thing WC3
# is talking to at that moment is Bonjour.
#
# Reforged advertises LAN games as the mDNS service type '_blizzard._udp'. The
# SRV record in that advertisement carries the target host and port the joiner
# is supposed to dial. This hosts a game and then asks Bonjour, from the joiner,
# for exactly that record.
#
# Peer name resolution itself is already proven good (lan-name-probe.ps1):
# WC3DOUGIE.local -> 192.168.31.128 both ways, IPv4, firewall off. So this is
# about the SERVICE record, not the host record.
#
#   powershell -File scripts/vmtest/lan-mdns-probe.ps1
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [string]$Map,
  # Kill the snapshot's WC3 and relaunch it before hosting. The snapshot's WC3
  # is a process frozen with its network stack in one state and thawed into
  # another, and the measured symptom is that it advertises a port it does not
  # own. This tests whether a WC3 that started normally advertises correctly.
  [switch]$FreshLaunch,
  [string]$OutDir = 'C:\VMs\lan-mdns'
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

function Guest-Eval($vm, [string]$body, [string]$tag) {
  $local = Join-Path $OutDir "$tag.ps1"
  Set-Content $local $body -Encoding ASCII
  $out = Join-Path $OutDir "$tag.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  $gp = "C:\p_$tag.ps1"
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $local $gp | Out-Null
  & $vmrun @guest runProgramInGuest $vm.Vmx $psExe '-ExecutionPolicy' 'Bypass' '-File' $gp 2>&1 | Out-Null
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx 'C:\probe.txt' $out 2>&1 | Out-Null
  if (Test-Path $out) { return (Get-Content $out -Raw).TrimEnd() }
  return '(NO OUTPUT -- the guest side did not run; treat as unmeasured)'
}

Say 'reset both'
foreach ($vm in @($h, $j)) {
  & $vmrun revertToSnapshot $vm.Vmx $vm.Snapshot 2>&1 | Out-Null
  & $vmrun -T ws start $vm.Vmx nogui 2>&1 | Out-Null
  & $vmrun -T ws disconnectNamedDevice $vm.Vmx sound 2>&1 | Out-Null
  & $vmrun -T ws connectNamedDevice $vm.Vmx ethernet0 2>&1 | Out-Null
}
Start-Sleep -Seconds 35

Say 'same prep the LAN test applies (firewall off, IPv6 off)'
$prep = @'
try { Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False -ErrorAction Stop } catch {}
Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
('host=' + $env:COMPUTERNAME + ' fw=' + (((Get-NetFirewallProfile) | ForEach-Object { $_.Enabled }) -join ',')) | Set-Content C:\probe.txt
'@
foreach ($vm in @($h, $j)) { Say ("  " + (Guest-Eval $vm $prep "prep-$($vm.Name)")) }

if ($FreshLaunch) {
  Say 'killing WC3 on both and relaunching it with the NIC already live'
  foreach ($vm in @($h, $j)) {
    & $vmrun @guest runProgramInGuest $vm.Vmx 'C:\Windows\System32\taskkill.exe' '/IM' 'Warcraft III.exe' '/F' 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 8
  # Killing WC3 leaves Battle.net in the foreground. Relaunch from its Play
  # button: the Run dialog never takes focus with Battle.net in front, and this
  # is the same path mint-vm.ps1 drives.
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
  Say 'both relaunched, sitting at the main menu'
}

Say 'upload the map to both'
$shared = "ZZMDNS$(Get-Random -Minimum 1000 -Maximum 9999).w3x"
foreach ($vm in @($h, $j)) {
  $dl = "$($vm.GuestHome)\Documents\Warcraft III\Maps\Download"
  & $vmrun @guest deleteDirectoryInGuest $vm.Vmx $dl 2>$null | Out-Null
  & $vmrun @guest createDirectoryInGuest $vm.Vmx $dl | Out-Null
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $Map "$dl\$shared" | Out-Null
}

Say 'host: into LAN and hosting'
$hc = Vnc-Connect $h.VncPort
try {
  # BACK on the MAIN MENU is EXIT, so these two are only correct when WC3 was
  # resumed from the snapshot and is parked on Create Game. After -FreshLaunch
  # it is already at the main menu and a single extra back-click quits the game.
  if (-not $FreshLaunch) {
    Vnc-Click $hc 137 1204; Start-Sleep -Seconds 3     # -> Single Player
    Vnc-Click $hc 137 1204; Start-Sleep -Seconds 3     # -> main menu
  }
  Vnc-Click $hc 1226 711; Start-Sleep -Seconds 3       # LAN (first click often eaten)
  Vnc-Click $hc 1226 711; Start-Sleep -Seconds 5
  Vnc-Click $hc 785 1047; Start-Sleep -Seconds 4       # CREATE
  Vnc-Click $hc 240 307;  Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $hc 'mdns'; Start-Sleep -Milliseconds 400
  for ($i = 0; $i -lt 3; $i++) { Vnc-DblClick $hc $ui.downloadFolder[0] $ui.downloadFolder[1]; Start-Sleep -Seconds 2 }
  Vnc-Click $hc $ui.firstMapRow[0] $ui.firstMapRow[1]; Start-Sleep -Seconds 1
  Vnc-Click $hc $ui.createButton[0] $ui.createButton[1]; Start-Sleep -Seconds 4
  Vnc-Click $hc $ui.nameField[0] $ui.nameField[1]; Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $hc $HostVm; Start-Sleep -Milliseconds 300
  Vnc-Click $hc $ui.confirmButton[0] $ui.confirmButton[1]; Start-Sleep -Seconds 8
} finally { $hc.cli.Close() }
$shot = Vnc-Connect $h.VncPort
try { Vnc-Shot $shot (Join-Path $OutDir 'host-lobby.png') } finally { $shot.cli.Close() }
Say 'host: lobby should be up'

# dns-sd -B and -L never exit on their own, so each is run under a timeout with
# its stdout redirected and then killed.
$browse = @'
$exe = 'C:\Windows\System32\dns-sd.exe'
$l = @()
# The parameter cannot be named $args -- that is a PowerShell automatic variable,
# and binding it produces a function that silently does nothing.
function RunFor([string[]]$argList, [string]$file, [int]$secs) {
  $p = Start-Process $exe -ArgumentList $argList -RedirectStandardOutput $file -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds $secs
  try { $p.Kill() } catch {}
  Start-Sleep -Milliseconds 800
  if (Test-Path $file) { return (Get-Content $file) }
  return @('(no output file)')
}
$l += '--- browse _blizzard._udp ---'
$b = RunFor @('-B','_blizzard._udp','local.') 'C:\blizb.txt' 10
$l += $b
$inst = @()
foreach ($line in $b) {
  if ($line -match '_blizzard\._udp\.\s+(.+?)\s*$') { $inst += $matches[1].Trim() }
}
$inst = @($inst | Sort-Object -Unique)
$l += ('--- instances: ' + $inst.Count + ' ---')
$n = 0
foreach ($i in $inst) {
  $n++
  $l += ("--- resolve [" + $i + "] ---")
  $l += RunFor @('-L', $i, '_blizzard._udp', 'local.') ("C:\blizr$n.txt") 10
}
$l -join [Environment]::NewLine | Set-Content C:\probe.txt
'@
Say 'joiner: browsing and resolving the advertisement'
$joinerView = Guest-Eval $j $browse 'browse-joiner'
Write-Host $joinerView

# The whole point. The advertisement names a port; WC3 either owns that port or
# it does not, and if it does not the joiner is sending game traffic into a
# closed port -- which looks exactly like the 999ms silent bounce, with every
# lower-layer test (ICMP, TCP, UDP on ports that exist) passing.
$ports = @'
$p = Get-Process 'Warcraft III' -ErrorAction SilentlyContinue
$l = @()
if ($null -eq $p) { $l += 'WC3 NOT RUNNING' } else {
  $l += "pid=$($p.Id)"
  Get-NetUDPEndpoint -OwningProcess $p.Id -ErrorAction SilentlyContinue | ForEach-Object { $l += ("udp {0}:{1}" -f $_.LocalAddress,$_.LocalPort) }
  Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $l += ("tcplisten {0}:{1}" -f $_.LocalAddress,$_.LocalPort) }
}
$l -join [Environment]::NewLine | Set-Content C:\probe.txt
'@
Write-Host ''
Say 'host: what WC3 is actually bound to'
$bound = Guest-Eval $h $ports 'host-ports'
Write-Host $bound

$advPort = $null
if ($joinerView -match 'can be reached at\s+\S+?:(\d+)') { $advPort = [int]$matches[1] }
$boundPorts = @()
foreach ($m in [regex]::Matches($bound, '(?m)^(?:udp|tcplisten)\s+\S+?:(\d+)')) { $boundPorts += [int]$m.Groups[1].Value }

Write-Host ''
if ($null -eq $advPort) {
  Write-Host 'INCONCLUSIVE: the joiner never resolved an advertised port.' -ForegroundColor Yellow
} elseif ($boundPorts -contains $advPort) {
  Write-Host "MATCH: advertised port $advPort is bound by WC3. The advertisement is honest." -ForegroundColor Green
} else {
  Write-Host "MISMATCH: advertised port $advPort is NOT bound by WC3 (bound: $($boundPorts -join ', '))." -ForegroundColor Red
  Write-Host '  The joiner is sending game traffic to a closed port. This is the join failure.'
}
Say "artifacts in $OutDir"
