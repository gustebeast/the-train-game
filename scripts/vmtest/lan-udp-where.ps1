# Where exactly does UDP die?
#
# Established so far: TCP crosses between the guests, mDNS multicast crosses
# (discovery works), but UDP unicast from the joiner never arrives -- with the
# firewall verifiably off and a loopback datagram proving the listener works.
#
# Two very different causes produce that:
#   A. the host's socket does not receive on its LAN interface at all
#   B. the packets never cross the vmnet switch
#
# Sending from the HOST to its OWN LAN address separates them: if that arrives,
# the socket is fine and the network is at fault (B); if it does not, the
# receive path is at fault (A).
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [int]$Port = 55556,
  [string]$HostIp = '192.168.31.128',
  [string]$JoinIp = '192.168.31.129',
  [string]$OutDir = 'C:\VMs\lan-udp-where'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$guest = @('-T','ws','-gu',$cfg.guestUser,'-gp',$cfg.guestPassword)
$psExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$h = Get-TestVm $HostVm
$j = Get-TestVm $JoinVm

function Put($vm, [string]$body, [string]$name) {
  $local = Join-Path $OutDir $name
  Set-Content $local $body -Encoding ASCII
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $local "C:\$name" | Out-Null
}
function Run($vm, [string]$name, [switch]$NoWait) {
  if ($NoWait) { & $vmrun @guest runProgramInGuest $vm.Vmx -noWait $psExe '-ExecutionPolicy' 'Bypass' '-File' "C:\$name" 2>&1 | Out-Null }
  else { & $vmrun @guest runProgramInGuest $vm.Vmx $psExe '-ExecutionPolicy' 'Bypass' '-File' "C:\$name" 2>&1 | Out-Null }
}
function Fetch($vm, [string]$guestPath, [string]$tag) {
  $out = Join-Path $OutDir "$tag.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx $guestPath $out 2>&1 | Out-Null
  if (Test-Path $out) { return (Get-Content $out -Raw).Trim() }
  return '(no result)'
}

$listener = @"
`$u = New-Object System.Net.Sockets.UdpClient($Port)
'bound' | Set-Content C:\w-ready.txt
`$ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
`$u.Client.ReceiveTimeout = 50000
`$got = @()
`$deadline = (Get-Date).AddSeconds(50)
while ((Get-Date) -lt `$deadline) {
  try { `$d = `$u.Receive([ref]`$ep); `$got += ('from ' + `$ep.Address + ': ' + [System.Text.Encoding]::ASCII.GetString(`$d)) } catch { break }
}
`$u.Close()
if (`$got.Count -eq 0) { 'NOTHING' | Set-Content C:\w-got.txt } else { (`$got -join [Environment]::NewLine) | Set-Content C:\w-got.txt }
"@
Put $h $listener 'wlisten.ps1'
Run $h 'wlisten.ps1' -NoWait
$ready = $false
foreach ($i in 1..10) { Start-Sleep -Seconds 3; if ((Fetch $h 'C:\w-ready.txt' 'ready') -match 'bound') { $ready = $true; break } }
if (-not $ready) { throw 'listener never bound' }
Write-Host "host: listener bound on $Port"

# A: host -> its own LAN address (leaves the loopback path, stays on one guest)
$selfSend = @"
`$u = New-Object System.Net.Sockets.UdpClient
`$b = [System.Text.Encoding]::ASCII.GetBytes('self-lan')
foreach (`$i in 1..3) { `$u.Send(`$b, `$b.Length, '$HostIp', $Port) | Out-Null; Start-Sleep -Milliseconds 500 }
`$u.Close()
"@
Put $h $selfSend 'wself.ps1'
Write-Host "host: sending to its own LAN address $HostIp"
Run $h 'wself.ps1'
Start-Sleep -Seconds 4

# B: joiner -> host
$peerSend = @"
`$u = New-Object System.Net.Sockets.UdpClient
`$b = [System.Text.Encoding]::ASCII.GetBytes('peer-lan')
foreach (`$i in 1..5) { `$u.Send(`$b, `$b.Length, '$HostIp', $Port) | Out-Null; Start-Sleep -Milliseconds 800 }
`$u.Close()
"@
Put $j $peerSend 'wpeer.ps1'
Write-Host "joiner: sending to $HostIp"
Run $j 'wpeer.ps1'

Start-Sleep -Seconds 40
Write-Host '--- what the host received ---'
Write-Host (Fetch $h 'C:\w-got.txt' 'got')
