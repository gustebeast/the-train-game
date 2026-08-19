# Does each guest resolve the OTHER guest's mDNS name to a usable IPv4 address?
#
# Reforged does not use the classic broadcast LAN protocol -- it advertises over
# Bonjour/mDNS and, per the reference in LAN-REMINT-PLAN.md, resolves peers BY
# HOSTNAME. That makes name resolution part of the join path, not a side issue:
# if 'WC3DOUGIE.local' does not resolve to 192.168.31.128 on the joiner, WC3 has
# nowhere to dial and the join bounces instantly with no error -- exactly the
# signature we have.
#
# Everything measured so far was addressed by IP (ping, TCP, UDP all pass), so
# this leg has never actually been tested. It also checks the thing the IPv6
# workaround could plausibly have broken: mDNSResponder has been running inside
# each snapshot since MINT time, with IPv6 enabled; the test disables IPv6 after
# the revert, which leaves the responder holding registrations for an address
# family the adapter no longer carries.
#
#   powershell -File scripts/vmtest/lan-name-probe.ps1            # VMs already up
#   powershell -File scripts/vmtest/lan-name-probe.ps1 -Reset     # revert first
param(
  [string]$HostVm = 'dougie',
  [string]$JoinVm = 'murph',
  [switch]$Reset,
  # Restart mDNSResponder after the IPv6 change, then re-probe. Separates "mDNS
  # cannot resolve this at all" from "mDNS is holding stale IPv6 registrations".
  [switch]$RestartBonjour,
  [string]$OutDir = 'C:\VMs\lan-name'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$psExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$guest = @('-T', 'ws', '-gu', $cfg.guestUser, '-gp', $cfg.guestPassword)
$h = Get-TestVm $HostVm
$j = Get-TestVm $JoinVm

# Run a snippet in a guest and bring back what it wrote to C:\probe.txt.
# Returns '(NO OUTPUT)' rather than '' so a failed round-trip cannot be misread
# as an empty-but-successful result -- that confusion has produced two wrong
# conclusions in this investigation already.
function Guest-Eval($vm, [string]$body, [string]$tag) {
  $local = Join-Path $OutDir "$tag.ps1"
  Set-Content $local $body -Encoding ASCII
  $out = Join-Path $OutDir "$tag.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  & $vmrun @guest CopyFileFromHostToGuest $vm.Vmx $local 'C:\probe.ps1' | Out-Null
  & $vmrun @guest runProgramInGuest $vm.Vmx $psExe '-ExecutionPolicy' 'Bypass' '-File' 'C:\probe.ps1' 2>&1 | Out-Null
  & $vmrun @guest CopyFileFromGuestToHost $vm.Vmx 'C:\probe.txt' $out 2>&1 | Out-Null
  if (Test-Path $out) { return (Get-Content $out -Raw).TrimEnd() }
  return '(NO OUTPUT)'
}

if ($Reset) {
  Write-Host 'reverting both VMs'
  foreach ($vm in @($h, $j)) {
    & $vmrun revertToSnapshot $vm.Vmx $vm.Snapshot 2>&1 | Out-Null
    & $vmrun -T ws start $vm.Vmx nogui 2>&1 | Out-Null
    & $vmrun -T ws disconnectNamedDevice $vm.Vmx sound 2>&1 | Out-Null
    & $vmrun -T ws connectNamedDevice $vm.Vmx ethernet0 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 40
}

# What the harness does to every LAN run, reproduced so the probe measures the
# configuration the join actually sees rather than a pristine one.
$prep = @'
try { Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False -ErrorAction Stop } catch {}
Disable-NetAdapterBinding -Name * -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
$l = @()
$l += 'host=' + $env:COMPUTERNAME
$l += 'fw=' + (((Get-NetFirewallProfile) | ForEach-Object { "$($_.Name)=$($_.Enabled)" }) -join ' ')
$l += 'ipv4=' + (((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress) -join ',')
$l += 'bonjour=' + ((Get-Service 'Bonjour Service' -ErrorAction SilentlyContinue).Status)
$l -join [Environment]::NewLine | Set-Content C:\probe.txt
'@
foreach ($vm in @($h, $j)) { Write-Host "--- $($vm.Name) ---"; Write-Host (Guest-Eval $vm $prep "prep-$($vm.Name)") }

if ($RestartBonjour) {
  Write-Host ''
  Write-Host 'restarting mDNSResponder on both (clears registrations made while IPv6 was up)'
  $restart = @'
Restart-Service 'Bonjour Service' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
('bonjour=' + (Get-Service 'Bonjour Service' -ErrorAction SilentlyContinue).Status) | Set-Content C:\probe.txt
'@
  foreach ($vm in @($h, $j)) { Write-Host ("  $($vm.Name): " + (Guest-Eval $vm $restart "bonjour-$($vm.Name)")) }
  Start-Sleep -Seconds 15
}

# The actual question, asked in every form WC3 might be using.
function Probe($from, $peerName) {
  $body = @"
`$l = @()
foreach (`$n in @('$peerName', '$peerName.local')) {
  try {
    `$r = [System.Net.Dns]::GetHostAddresses(`$n)
    `$l += ("dns  {0,-18} -> {1}" -f `$n, ((`$r | ForEach-Object { `$_.IPAddressToString }) -join ','))
  } catch { `$l += ("dns  {0,-18} -> FAILED: {1}" -f `$n, `$_.Exception.Message) }
  try {
    `$p = Test-Connection -ComputerName `$n -Count 1 -ErrorAction Stop
    `$l += ("ping {0,-18} -> {1}" -f `$n, `$p.IPV4Address.IPAddressToString)
  } catch { `$l += ("ping {0,-18} -> FAILED" -f `$n) }
}
`$l -join [Environment]::NewLine | Set-Content C:\probe.txt
"@
  return (Guest-Eval $from $body ("probe-" + $from.Name))
}

$hName = "WC3$($h.Name)".ToUpper()
$jName = "WC3$($j.Name)".ToUpper()
Write-Host ''
Write-Host "--- $($j.Name) resolving the host, $hName ---"
Write-Host (Probe $j $hName)
Write-Host ''
Write-Host "--- $($h.Name) resolving the joiner, $jName ---"
Write-Host (Probe $h $jName)
Write-Host ''
Write-Host "artifacts in $OutDir"
