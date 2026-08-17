# Convenience CLI over TrainVMTest.psm1, for running a test without writing
# any PowerShell of your own:
#
#   powershell -File scripts/vmtest/run-test.ps1 -Test damage
#   powershell -File scripts/vmtest/run-test.ps1 -Test damage -Vm dougie
#   powershell -File scripts/vmtest/run-test.ps1 -SelfTest        # check the harness only
#
# Exits non-zero if the test fails, so it drops straight into a CI-style check.
# For anything more involved, import the module and call Invoke-MapTest.
param(
  [string]$Test = 'damage',
  [string]$Vm,
  [string]$Map,
  [int]$TestTimeoutSec = 120,
  [switch]$NoPrewarm,        # skip the background pre-warm; the VM won't be left running
  [switch]$AllowNoResults,   # let a test pass without reporting any measurements
  [switch]$SelfTest,         # only verify the harness (no VM boot, no test run)
  [switch]$SkipSelfTest      # don't pre-flight the harness before running
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force

$checkParams = @{ Test = $Test }
if ($Vm)  { $checkParams.Vm  = $Vm }
if ($Map) { $checkParams.Map = $Map }

# -SelfTest: report on the harness and stop. Cheap (a few seconds, no VM boot).
if ($SelfTest) {
  Write-Host 'Harness self-check:'
  $c = Test-TestHarness @checkParams
  exit $(if ($c.Ok) { 0 } else { 1 })
}

# Pre-flight by default. A stale build or an unregistered test otherwise shows up
# as a confusing failure -- or worse, a green pass against the previous map.
if (-not $SkipSelfTest) {
  $c = Test-TestHarness @checkParams -Quiet
  $bad = @($c.Checks.Keys | Where-Object { $c.Checks[$_].State -eq 'Fail' })
  if ($bad.Count -gt 0) {
    Write-Host 'Harness not ready -- refusing to run (a result here would not be trustworthy):' -ForegroundColor Red
    foreach ($k in $bad) { Write-Host ("  {0,-24} {1}" -f $k, $c.Checks[$k].Detail) -ForegroundColor Red }
    Write-Host 'Re-run with -SkipSelfTest to override.' -ForegroundColor Yellow
    exit 1
  }
}

$params = @{ Test = $Test; TestTimeoutSec = $TestTimeoutSec }
if ($Vm)  { $params.Vm  = $Vm }
if ($Map) { $params.Map = $Map }
if ($NoPrewarm)      { $params.NoPrewarm = $true }
if ($AllowNoResults) { $params.AllowNoResults = $true }
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
