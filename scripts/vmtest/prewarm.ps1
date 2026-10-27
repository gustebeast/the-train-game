# Background pre-warm: revert a VM to its create-game snapshot and SUSPEND it, so
# the next test can skip the ~15-20s reset AND the VM burns zero CPU while idle
# (a running WC3 renders its menu at ~1.5 cores; suspended it renders nothing).
# Launched detached by the runner after a test, so the revert happens during the
# agent's build/edit time. The next test resumes the suspended VM in ~3s.
# State file the runner polls:
#   warming -> revert/suspend in flight    warm -> suspended at create-game, ready
#   failed  -> the reset threw; the next run does a full reset itself
param(
  [Parameter(Mandatory)][string]$Vm,
  [Parameter(Mandatory)][string]$StateFile
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force
Set-Content $StateFile 'warming' -Encoding ascii
try {
  $vmInfo = Get-TestVm $Vm
  # The same reset every run uses -- host-only networking, the stale-checkpoint
  # recovery, sound and NIC unplugged -- rather than a copy of it. A copy here
  # once drifted and lost the sound disconnect, so a pre-warmed VM played WC3's
  # menu music through the host until the next run.
  Reset-TestVm $vmInfo
  # Suspending saves the unplugged devices with the VM, so every resume of it
  # comes back the same way.
  Suspend-TestVm $vmInfo
  Set-Content $StateFile 'warm' -Encoding ascii
} catch {
  Set-Content $StateFile 'failed' -Encoding ascii
  throw
}
