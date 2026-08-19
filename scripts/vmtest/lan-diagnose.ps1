# LAN diagnosis: what is WC3 actually listening on, and can the peer reach it?
#
#   powershell -File scripts/vmtest/lan-diagnose.ps1
#
# The LAN join fails with a permanent 999ms ping while discovery works perfectly
# (the game is listed with the right name, map and player count). Everything
# below the game has been eliminated by measurement: hostname resolution, ICMP
# and arbitrary TCP all pass between the guests, with the firewall off and IPv6
# disabled, on a host-only network. Fresh-launching WC3 rather than resuming it
# from the snapshot changes nothing.
#
# So this stops guessing at the UI and asks the two questions that decide it:
#   1. which address/port does the HOST's WC3 process actually listen on?
#   2. can the JOINER reach that endpoint?
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [string]$OutDir = 'C:\VMs\lan-diag'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($m) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) }

$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$ui = $cfg.uiSets.fullscreen
$h = Get-TestVm $HostVm
$j = Get-TestVm $JoinVm
$guest = @('-T','ws','-gu',$cfg.guestUser,'-gp',$cfg.guestPassword)
$psExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

# Run a PowerShell snippet in a guest and bring its stdout back as text.
function Guest-Eval($vm, [string]$script, [string]$tag) {
  $local = Join-Path $OutDir "$tag.ps1"
  Set-Content $local $script -Encoding ASCII
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $local 'C:\diag.ps1' | Out-Null
  & $vmrun @guest runProgramInGuest $vm.Vmx $psExe '-ExecutionPolicy' 'Bypass' '-File' 'C:\diag.ps1' 2>&1 | Out-Null
  $out = Join-Path $OutDir "$tag.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx 'C:\diag.txt' $out 2>&1 | Out-Null
  if (Test-Path $out) { return (Get-Content $out -Raw) }
  return ''
}

Say "reset $($h.Name) + $($j.Name)"
foreach ($vm in @($h, $j)) {
  & $vmrun revertToSnapshot $vm.Vmx $vm.Snapshot 2>&1 | Out-Null
  & $vmrun -T ws start $vm.Vmx nogui 2>&1 | Out-Null
}
Start-Sleep -Seconds 30

Say 'firewall off on both (matches the LAN test)'
foreach ($vm in @($h, $j)) {
  Guest-Eval $vm 'Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False; "ok" | Set-Content C:\diag.txt' 'fw' | Out-Null
}

# Host: Create Game root -> main menu -> LAN -> create a game.
Say 'host: into LAN and hosting'
$hc = Vnc-Connect $h.VncPort
try {
  Vnc-Click $hc 137 1204; Start-Sleep -Seconds 3       # -> Single Player
  Vnc-Click $hc 137 1204; Start-Sleep -Seconds 3       # -> main menu
  Vnc-Click $hc 1226 711; Start-Sleep -Seconds 3       # LAN (first click often eaten)
  Vnc-Click $hc 1226 711; Start-Sleep -Seconds 5
  Vnc-Click $hc 785 1047; Start-Sleep -Seconds 5       # CREATE
  Vnc-DblClick $hc $ui.downloadFolder[0] $ui.downloadFolder[1]; Start-Sleep -Seconds 2
  Vnc-Click $hc $ui.firstMapRow[0] $ui.firstMapRow[1];          Start-Sleep -Seconds 2
  Vnc-Click $hc 240 307; Start-Sleep -Milliseconds 500
  Vnc-TypeSmart $hc 'diag'
  Vnc-Click $hc $ui.createButton[0] $ui.createButton[1]; Start-Sleep -Seconds 8
} finally { $hc.cli.Close() }
$shot = Vnc-Connect $h.VncPort
try { Vnc-Shot $shot (Join-Path $OutDir 'host-lobby.png') } finally { $shot.cli.Close() }

# 1. What is WC3 listening on?
Say 'host: listing WC3 sockets'
$listen = @'
$p = Get-Process 'Warcraft III' -ErrorAction SilentlyContinue
$lines = @()
if ($null -eq $p) { $lines += 'WC3 NOT RUNNING' }
else {
  $lines += "wc3 pid=$($p.Id)"
  $lines += '-- UDP --'
  Get-NetUDPEndpoint -OwningProcess $p.Id -ErrorAction SilentlyContinue |
    ForEach-Object { $lines += ("udp {0}:{1}" -f $_.LocalAddress, $_.LocalPort) }
  $lines += '-- TCP listen --'
  Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { $lines += ("tcp {0}:{1}" -f $_.LocalAddress, $_.LocalPort) }
  $lines += '-- TCP established --'
  Get-NetTCPConnection -OwningProcess $p.Id -State Established -ErrorAction SilentlyContinue |
    ForEach-Object { $lines += ("tcp {0}:{1} -> {2}:{3}" -f $_.LocalAddress, $_.LocalPort, $_.RemoteAddress, $_.RemotePort) }
}
$lines -join [Environment]::NewLine | Set-Content C:\diag.txt
'@
$hostSockets = Guest-Eval $h $listen 'host-sockets'
Write-Host $hostSockets

# 2. Can the joiner reach those ports?
$ports = @()
foreach ($line in ($hostSockets -split "`n")) {
  if ($line -match '^(udp|tcp) [\d\.]+:(\d+)') { $ports += [int]$matches[2] }
}
$ports = $ports | Sort-Object -Unique | Where-Object { $_ -gt 1024 }
Say ("joiner: probing " + ($ports -join ', '))
$probe = "`$hostIp='" + '192.168.31.128' + "'`n`$lines=@()`n"
foreach ($p in $ports) {
  $probe += "`$r = Test-NetConnection `$hostIp -Port $p -WarningAction SilentlyContinue; `$lines += ('tcp $p =' + `$r.TcpTestSucceeded)`n"
}
$probe += '$lines -join [Environment]::NewLine | Set-Content C:\diag.txt'
$joinerProbe = Guest-Eval $j $probe 'joiner-probe'
Write-Host $joinerProbe

Say "artifacts in $OutDir"
