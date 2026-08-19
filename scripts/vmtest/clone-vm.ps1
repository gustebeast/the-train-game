# Clone one agent VM from the base image's powered-off snapshot and configure
# its .vmx. Pairs with mint-vm.ps1, which then drives WC3 to the Custom Games
# root and takes the live create-game snapshot.
#
#   powershell -File scripts/vmtest/clone-vm.ps1 -Vm murph
#   powershell -File scripts/vmtest/clone-vm.ps1 -Vm murph -Replace   # delete an existing one first
#
# Linked clone, so each agent costs single-digit GB against the shared parent
# rather than another copy of a 140 GB image.
param(
  [Parameter(Mandatory)][string]$Vm,
  [string]$Snapshot = 'base-off5',
  [switch]$Replace
)
$ErrorActionPreference = 'Stop'
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json

$name = $Vm.ToLower()
$entry = $cfg.vms.$name
if ($null -eq $entry) { throw "Unknown VM '$Vm'. Known: $(($cfg.vms.PSObject.Properties.Name) -join ', ')" }
$vmx = $entry.vmx
$dir = Split-Path $vmx -Parent
$display = (Get-Culture).TextInfo.ToTitleCase($name)
$baseVmx = $cfg.base.vmx

if ((& $vmrun -T ws list) -match [regex]::Escape($vmx)) {
  Write-Host "Stopping running $display..."
  & $vmrun -T ws stop $vmx hard 2>&1 | Out-Null
  Start-Sleep -Seconds 5
}

if (Test-Path $dir) {
  if (-not $Replace) { throw "$dir already exists. Pass -Replace to delete and re-clone it." }
  Write-Host "Removing old $display ($([math]::Round(((Get-ChildItem $dir -Recurse -File | Measure-Object Length -Sum).Sum)/1GB,1)) GB)..."
  Remove-Item $dir -Recurse -Force
}

Write-Host "Cloning $display from $Snapshot (linked)..."
$out = & $vmrun -T ws clone $baseVmx $vmx linked "-snapshot=$Snapshot" "-cloneName=$display" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Clone failed: $out" }

# Rewrite the identity- and device-scoped settings. Everything here differs per
# clone or must not be inherited from the base.
$lines = Get-Content $vmx | Where-Object {
  $_ -notmatch '^(displayName|RemoteDisplay\.vnc\.(enabled|port|password)|ethernet0\.(startConnected|generatedAddress|generatedAddressOffset|address|addressType)|sound\.startConnected|uuid\.(bios|location|action))\s*='
}
$lines += 'displayName = "' + $display + '"'
$lines += 'RemoteDisplay.vnc.enabled = "TRUE"'
$lines += 'RemoteDisplay.vnc.port = "' + $entry.vncPort + '"'
$lines += 'RemoteDisplay.vnc.password = "' + $cfg.vncPassword + '"'
# Fresh network identity: a duplicate MAC on the NAT subnet breaks LAN peering
# as surely as a duplicate hostname does.
$lines += 'ethernet0.addressType = "generated"'
# Minted offline so WC3 commits to PLAY OFFLINE and no stale Battle.net session
# is frozen into the snapshot. A LAN test connects the NIC at runtime with
# `vmrun connectNamedDevice <vmx> ethernet0` -- that keeps the far more common
# single-player path exactly as it was.
$lines += 'ethernet0.startConnected = "FALSE"'
$lines += 'sound.startConnected = "FALSE"'
# Take the new identity silently instead of prompting "moved or copied?"
$lines += 'uuid.action = "create"'
$lines | Set-Content $vmx -Encoding ASCII

Write-Host "  $display cloned to $vmx (vnc $($entry.vncPort))"
Write-Host "Next: powershell -File scripts/vmtest/mint-vm.ps1 -Vm $name"
