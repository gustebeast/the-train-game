# Convenience CLI over TrainVMTest.psm1, for running a test without writing
# any PowerShell of your own:
#
#   powershell -File scripts/vmtest/run-test.ps1 -Test damage
#   powershell -File scripts/vmtest/run-test.ps1 -Test damage -Vm dougie
#
# Exits non-zero if the test fails, so it drops straight into a CI-style check.
# For anything more involved, import the module and call Invoke-MapTest.
param(
  [string]$Test = 'damage',
  [string]$Vm,
  [string]$Map,
  [int]$TestTimeoutSec = 120,
  [switch]$NoPrewarm    # skip the background pre-warm; the VM won't be left running
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force

$params = @{ Test = $Test; TestTimeoutSec = $TestTimeoutSec }
if ($Vm)  { $params.Vm  = $Vm }
if ($Map) { $params.Map = $Map }
if ($NoPrewarm) { $params.NoPrewarm = $true }
$r = Invoke-MapTest @params

Write-Host ''
if ($r.Results.Count -gt 0) {
  Write-Host 'Results:'
  $r.Results.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-14} {1}" -f $_.Key, $_.Value) }
}
if ($r.Ok) {
  Write-Host "PASS ($($r.DurationSeconds)s)" -ForegroundColor Green
  exit 0
}
Write-Host "FAIL: $($r.FailureReason)" -ForegroundColor Red
Write-Host "Screenshot: $($r.Screenshot)"
exit 1
