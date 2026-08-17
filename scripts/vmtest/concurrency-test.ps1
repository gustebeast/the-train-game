# Prove two agents can test their own maps at the same time without colliding.
# Launches a full Invoke-MapTest on two VMs in parallel (separate processes, so
# genuinely concurrent) and checks that both pass and their runs overlapped.
#
#   powershell -File scripts/vmtest/concurrency-test.ps1 -VmA brenner -VmB murph
param(
  [string]$VmA = 'brenner',
  [string]$VmB = 'murph',
  [string]$Test = 'damage'
)
$ErrorActionPreference = 'Stop'
$module = Join-Path $PSScriptRoot 'TrainVMTest.psm1'

$job = {
  param($module, $vm, $test)
  Import-Module $module -Force
  $start = Get-Date
  $r = Invoke-MapTest -Test $test -Vm $vm -Quiet
  [pscustomobject]@{
    Vm = $vm; Ok = $r.Ok; FailureReason = $r.FailureReason
    Results = $r.Results; Start = $start; End = Get-Date
  }
}

Write-Host "Launching concurrent tests on '$VmA' and '$VmB'..."
$jobs = @(
  Start-Job -ScriptBlock $job -ArgumentList $module, $VmA, $Test
  Start-Job -ScriptBlock $job -ArgumentList $module, $VmB, $Test
)
$jobs | Wait-Job | Out-Null
$results = $jobs | Receive-Job
$jobs | Remove-Job

$byVm = @{}
foreach ($r in $results) { $byVm[$r.Vm] = $r }
$a = $byVm[$VmA]; $b = $byVm[$VmB]

Write-Host ''
foreach ($r in @($a, $b)) {
  Write-Host ("=== {0} : {1} ===" -f $r.Vm, $(if($r.Ok){'PASS'}else{"FAIL - $($r.FailureReason)"}))
  if ($r.Results) { $r.Results.GetEnumerator() | ForEach-Object { Write-Host ("    {0,-12} {1}" -f $_.Key, $_.Value) } }
}

# Overlap: the later start began before the earlier finished -> they really ran
# at the same time, not one-then-the-other.
$overlapStart = if ($a.Start -gt $b.Start) { $a.Start } else { $b.Start }
$overlapEnd   = if ($a.End   -lt $b.End)   { $a.End }   else { $b.End }
$overlapSec   = [math]::Round(($overlapEnd - $overlapStart).TotalSeconds, 1)

Write-Host ''
Write-Host ("Overlap: {0}s of concurrent execution" -f $overlapSec)
if ($a.Ok -and $b.Ok -and $overlapSec -gt 0) {
  Write-Host "CONCURRENCY PASS: both VMs tested their own map simultaneously and passed." -ForegroundColor Green
  exit 0
}
Write-Host "CONCURRENCY FAIL" -ForegroundColor Red
exit 1
