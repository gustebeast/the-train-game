# Does UDP actually pass between the two guests?
#
# The LAN join shows a permanent 999ms ping while the game lists correctly, and
# lan-diagnose.ps1 showed the host's game port (TCP 0.0.0.0:54178) IS reachable
# from the joiner. WC3's ping probe is UDP, and a UDP round-trip that never
# completes looks exactly like 999ms -- so this tests UDP unicast on its own.
#
# Care is needed to avoid testing the harness instead of the network:
#   - the firewall must be verifiably OFF (an unauthorised listener is blocked
#     by default, which looks identical to "UDP is broken")
#   - the listener must be bound BEFORE anything is sent, so it announces itself
#     and the sender repeats, rather than firing one datagram into a race
#   - a loopback datagram proves the listener works at all
#
#   powershell -File scripts/vmtest/lan-udp-check.ps1
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [int]$Port = 55555,
  # Explicit address, not a name: the VM name ('dougie') is NOT the guest
  # hostname ('WC3DOUGIE'), and sending to an unresolvable name still reports
  # success while the datagrams go nowhere -- which reads as "UDP is blocked".
  [string]$HostIp = '192.168.31.128',
  [string]$OutDir = 'C:\VMs\lan-udp'
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

# --- firewall OFF, and verified rather than assumed ------------------------
$fwOff = @'
try { Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False -ErrorAction Stop } catch {}
((Get-NetFirewallProfile | ForEach-Object { "$($_.Name)=$($_.Enabled)" }) -join ' ') | Set-Content C:\fw.txt
'@
foreach ($vm in @($h, $j)) {
  Put $vm $fwOff 'fwoff.ps1'
  Run $vm 'fwoff.ps1'
  $state = Fetch $vm 'C:\fw.txt' "fw-$($vm.Name)"
  Write-Host "$($vm.Name) firewall: $state"
  if ($state -match 'True') { throw "Firewall still enabled on $($vm.Name) -- a UDP result here would be meaningless." }
}

# --- listener: announce when bound, then collect for 60s -------------------
$listener = @"
`$u = New-Object System.Net.Sockets.UdpClient($Port)
'bound' | Set-Content C:\udpready.txt
`$u.Client.ReceiveTimeout = 60000
`$ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
`$got = @()
`$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt `$deadline) {
  try {
    `$data = `$u.Receive([ref]`$ep)
    `$got += ('from ' + `$ep.Address + ': ' + [System.Text.Encoding]::ASCII.GetString(`$data))
  } catch { break }
}
`$u.Close()
if (`$got.Count -eq 0) { 'NOTHING RECEIVED' | Set-Content C:\udp.txt }
else { (`$got -join [Environment]::NewLine) | Set-Content C:\udp.txt }
"@
Put $h $listener 'udplisten.ps1'
Write-Host "host: starting UDP listener on $Port"
Run $h 'udplisten.ps1' -NoWait

# Wait for the socket to actually be bound before sending anything.
$ready = $false
foreach ($i in 1..12) {
  Start-Sleep -Seconds 3
  if ((Fetch $h 'C:\udpready.txt' 'ready') -match 'bound') { $ready = $true; break }
}
if (-not $ready) { throw 'Listener never reported bound; the test would be inconclusive.' }
Write-Host 'host: listener bound'

# --- loopback control: proves the listener receives at all -----------------
$loop = @"
`$u = New-Object System.Net.Sockets.UdpClient
`$b = [System.Text.Encoding]::ASCII.GetBytes('loopback')
`$u.Send(`$b, `$b.Length, '127.0.0.1', $Port) | Out-Null
`$u.Close()
"@
Put $h $loop 'udploop.ps1'
Run $h 'udploop.ps1'
Start-Sleep -Seconds 3

# --- the real test: 10 datagrams from the joiner ---------------------------
$sender = @"
`$u = New-Object System.Net.Sockets.UdpClient
`$b = [System.Text.Encoding]::ASCII.GetBytes('from-joiner')
foreach (`$i in 1..10) {
  `$u.Send(`$b, `$b.Length, '$HostIp', $Port) | Out-Null
  Start-Sleep -Milliseconds 1500
}
`$u.Close()
'sent 10' | Set-Content C:\udpsent.txt
"@
Put $j $sender 'udpsend.ps1'
Write-Host 'joiner: sending 10 datagrams'
Run $j 'udpsend.ps1'
Write-Host ("joiner: " + (Fetch $j 'C:\udpsent.txt' 'joiner-send'))

Start-Sleep -Seconds 45
Write-Host '--- host received ---'
Write-Host (Fetch $h 'C:\udp.txt' 'host-recv')
