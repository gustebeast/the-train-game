# Background pre-warm: revert a VM to its create-game snapshot and SUSPEND it, so
# the next test can skip the ~15-20s reset AND the VM burns zero CPU while idle
# (a running WC3 renders its menu at ~1.5 cores; suspended it renders nothing).
# Launched detached by the runner after a test, so the revert happens during the
# agent's build/edit time. The next test resumes the suspended VM in ~3s.
# State file the runner polls:
#   warming -> revert/suspend in flight    warm -> suspended at create-game, ready
param(
  [Parameter(Mandatory)][string]$Vmx,
  [Parameter(Mandatory)][string]$Snapshot,
  [Parameter(Mandatory)][string]$StateFile
)
$ErrorActionPreference = 'SilentlyContinue'
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
Set-Content $StateFile 'warming' -Encoding ascii
& $vmrun revertToSnapshot $Vmx $Snapshot | Out-Null
# Same guarantee the runner enforces (Set-TestVmHostOnly), duplicated because
# this script runs standalone and does not import the module: a guest that can
# reach the internet can reach Battle.net and churn the shared session token.
# It must sit between the revert and the start -- the revert restores the
# snapshot's network config, so a clone minted on NAT comes back as NAT.
if (Test-Path $Vmx) {
  $txt = [IO.File]::ReadAllText($Vmx)
  $fixed = [regex]::Replace($txt, 'ethernet0\.connectionType\s*=\s*"[^"]*"', 'ethernet0.connectionType = "hostonly"')
  if ($fixed -ne $txt) { [IO.File]::WriteAllText($Vmx, $fixed) }
}
# Reverting a live snapshot leaves the VM running; the start is a defensive
# no-op in case it doesn't, so the following suspend always has a running VM.
& $vmrun -T ws start $Vmx nogui | Out-Null
& $vmrun -T ws suspend $Vmx | Out-Null
Set-Content $StateFile 'warm' -Encoding ascii
