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
  [switch]$Replace,
  # hostonly (default): VM-to-VM LAN with NO route to the internet. This is what
  # makes LAN testing safe -- Battle.net is unreachable, so a test run can never
  # consume the single-use session token or churn the ~30-day offline
  # entitlement. nat is for the rare case of deliberately wanting WAN.
  [ValidateSet('hostonly','nat')][string]$Network = 'hostonly'
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
  $_ -notmatch '^(displayName|RemoteDisplay\.vnc\.(enabled|port|password)|ethernet0\.(startConnected|generatedAddress|generatedAddressOffset|address|addressType|connectionType)|sound\.startConnected|uuid\.(bios|location|action))\s*='
}
$lines += 'displayName = "' + $display + '"'
$lines += 'RemoteDisplay.vnc.enabled = "TRUE"'
$lines += 'RemoteDisplay.vnc.port = "' + $entry.vncPort + '"'
$lines += 'RemoteDisplay.vnc.password = "' + $cfg.vncPassword + '"'
# Fresh network identity: a duplicate MAC on the NAT subnet breaks LAN peering
# as surely as a duplicate hostname does.
$lines += 'ethernet0.addressType = "generated"'
$lines += 'ethernet0.connectionType = "' + $Network + '"'
# The NIC is CONNECTED at boot and stays connected. WC3 sets up its networking
# when it launches, so a WC3 frozen into a snapshot that booted with no adapter
# can discover LAN games but cannot host or join one -- connecting the NIC after
# the revert is too late. Minting with the adapter live is what makes a LAN join
# work. On hostonly this costs nothing: there is no WAN to reach, so WC3 still
# takes the PLAY OFFLINE path exactly as before.
$lines += 'ethernet0.startConnected = "TRUE"'
$lines += 'sound.startConnected = "FALSE"'
# Take the new identity silently instead of prompting "moved or copied?"
$lines += 'uuid.action = "create"'
$lines | Set-Content $vmx -Encoding ASCII

Write-Host "  $display cloned to $vmx (vnc $($entry.vncPort))"
Write-Host "Next: powershell -File scripts/vmtest/mint-vm.ps1 -Vm $name"
