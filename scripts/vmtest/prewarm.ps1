# Background pre-warm: revert a VM to its create-game snapshot so the NEXT test
# can skip the ~15-20s reset. Launched detached by the runner after a test, so
# the revert happens during the agent's build/edit time instead of on the
# critical path. Writes its progress to a state file the runner polls:
#   warming -> revert in flight    warm -> reverted and running, ready to use
# The runner treats a stale 'warming' (process died) as cold and resets itself.
param(
  [Parameter(Mandatory)][string]$Vmx,
  [Parameter(Mandatory)][string]$Snapshot,
  [Parameter(Mandatory)][string]$StateFile
)
$ErrorActionPreference = 'SilentlyContinue'
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
Set-Content $StateFile 'warming' -Encoding ascii
& $vmrun revertToSnapshot $Vmx $Snapshot | Out-Null
& $vmrun -T ws start $Vmx nogui | Out-Null
Set-Content $StateFile 'warm' -Encoding ascii
