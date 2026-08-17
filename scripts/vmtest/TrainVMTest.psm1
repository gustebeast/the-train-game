# TrainVMTest -- run TheTrainGame inside a VM and get results back, in ~50s.
#
#   Import-Module .\scripts\vmtest\TrainVMTest.psm1
#   $r = Invoke-MapTest -Test damage
#   $r.Results['axe']
#
# See TESTING.md for the whole workflow. Everything below is a supporting
# detail of that one call; the individual functions are exported so you can
# build a non-standard flow if a test needs one.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')

$script:VmRun  = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$script:Config = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json
$script:RepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# --- Focus courtesy -------------------------------------------------------
# If a VM has an open console tab in the Workstation GUI, reverting/starting it
# pulls that window to the foreground and steals focus from whatever the user is
# doing. We can't stop VMware doing it, but we can put the user's window back.
# Best-effort: capture the foreground window before a power op, restore it after.
if (-not ('TrainVM.Fg' -as [type])) {
  Add-Type -Namespace TrainVM -Name Fg -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
}
function Save-Foreground { try { return [TrainVM.Fg]::GetForegroundWindow() } catch { return [IntPtr]::Zero } }
function Restore-Foreground([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return }
  try {
    # Windows only lets a process set the foreground window if it is attached to
    # the current foreground thread's input, hence the AttachThreadInput dance.
    $cur = [TrainVM.Fg]::GetForegroundWindow()
    if ($cur -eq $h) { return }
    $p = 0
    $fgThread = [TrainVM.Fg]::GetWindowThreadProcessId($cur, [ref]$p)
    $me = [TrainVM.Fg]::GetCurrentThreadId()
    [void][TrainVM.Fg]::AttachThreadInput($me, $fgThread, $true)
    [void][TrainVM.Fg]::SetForegroundWindow($h)
    [void][TrainVM.Fg]::AttachThreadInput($me, $fgThread, $false)
  } catch {}
}

# vmrun needs -T ws. Without it every guest operation fails with the very
# misleading "Error: A file was not found".
function Invoke-VmRun {
  param([Parameter(Mandatory)][object]$Vm, [Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $auth = @('-T','ws','-gu',$Vm.GuestUser,'-gp',$Vm.GuestPassword)
  & $script:VmRun @auth @Args 2>&1
}

<#
.SYNOPSIS
  Resolve which VM to test on. Normally you pass nothing.
.DESCRIPTION
  Resolution order:
    1. explicit -Name
    2. $env:TRAINVM
    3. auto-detected from the git branch of the calling worktree: agent/<name>
  Each agent works in its own worktree (.worktrees/dougie on branch
  agent/dougie), so step 3 makes the dougie worktree target the dougie VM with
  zero config, and there is no shared default to fall back onto by accident.
  Targeting the clone-parent base VM is refused outright.
#>
function Get-TestVm {
  [CmdletBinding()]
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $env:TRAINVM }
  if ([string]::IsNullOrWhiteSpace($Name)) {
    # Infer the agent from the current branch (agent/<name>). Run from the repo
    # root so a worktree reports its own branch, not the main checkout's.
    $branch = (& git -C $script:RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
    if ($branch -match '^(?:agent/)?(brenner|boof|dougie|murph)$') { $Name = $matches[1] }
  }
  if ([string]::IsNullOrWhiteSpace($Name)) {
    $known = ($script:Config.vms.PSObject.Properties.Name) -join ', '
    throw ("Could not determine which VM to use. Pass -Vm <name>, set " +
           "`$env:TRAINVM, or run from an agent worktree (branch agent/<name>). " +
           "Named VMs: $known.")
  }
  $Name = $Name.ToLower()
  # The base image is the clone parent + mint base; testing on it can corrupt
  # in-flight clones and is never what an agent wants.
  if ($Name -in @('base', 'shared', 'traingametest')) {
    throw ("'$Name' is the clone-parent base image, not a test target. Use your " +
           "named VM (brenner/boof/dougie/murph) -- normally just run with no -Vm " +
           "and it is picked from your worktree.")
  }
  $entry = $script:Config.vms.$Name
  if ($null -eq $entry) {
    $known = ($script:Config.vms.PSObject.Properties.Name) -join ', '
    throw "Unknown VM '$Name'. Named VMs: $known"
  }
  $snapshot = if ($entry.PSObject.Properties.Name -contains 'snapshot') { $entry.snapshot } else { $script:Config.snapshot }
  if ($entry.PSObject.Properties.Name -contains 'ready' -and -not $entry.ready) {
    throw ("VM '$Name' has no live create-game snapshot yet, so there is nothing to revert to. " +
           "Mint it by following step 8 of VM-SETUP.md, then set ready:true in vms.json.")
  }
  [pscustomobject]@{
    Name          = $Name
    Vmx           = $entry.vmx
    VncPort       = $entry.vncPort
    Snapshot      = $snapshot
    Ui            = $script:Config.uiSets.($entry.ui)
    GuestUser     = $script:Config.guestUser
    GuestPassword = $script:Config.guestPassword
    GuestHome     = "C:\Users\$($script:Config.guestUser)"
  }
}

<#
.SYNOPSIS
  Revert the VM to its test snapshot and power it on.
.DESCRIPTION
  The snapshot is a live one parked on WC3's Create Game screen, so this both
  resets state and skips the ~60s of launching and navigating WC3.
#>
function Reset-TestVm {
  [CmdletBinding()]
  param([object]$Vm, [switch]$Gui)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  # Automated runs use 'nogui' so nothing steals focus; manual sessions pass
  # -Gui so the VMware console window opens on the host for a human to watch
  # and play. Either way the guest's built-in VNC server stays available.
  $startArg = if ($Gui) { 'gui' } else { 'nogui' }
  & $script:VmRun revertToSnapshot $Vm.Vmx $Vm.Snapshot 2>&1 | Out-Null
  $out = & $script:VmRun start $Vm.Vmx $startArg 2>&1
  if ($LASTEXITCODE -ne 0) {
    # Known failure mode: a previous run died mid-restore and left a stale
    # checkpoint reference in the vmx. Documented recovery is to drop those
    # lines and start again; snapshots survive it.
    if ("$out" -match 'checkpoint|CheckpointLate|notCheckpointed') {
      Write-Warning 'Stale checkpoint in vmx; clearing checkpoint.vmState and retrying.'
      (Get-Content $Vm.Vmx) | Where-Object { $_ -notmatch '^checkpoint\.vmState' } | Set-Content $Vm.Vmx
      & $script:VmRun start $Vm.Vmx $startArg 2>&1 | Out-Null
    } else {
      throw "Could not start $($Vm.Name): $out"
    }
  }
}

# --- Pre-warming ----------------------------------------------------------
# After a test, a detached process reverts the VM to create-game and SUSPENDS
# it, so the NEXT test skips the ~15-20s reset (resume takes ~3s) AND the VM
# burns no CPU while idle (a running WC3 renders its menu at ~1.5 cores). The
# revert+suspend runs during the agent's build/edit time. A state file tracks
# it: 'warming' while in flight, 'warm' once suspended and ready. See prewarm.ps1.
function Get-PrewarmStateFile($Vm) { Join-Path $env:TEMP "trainvm-prewarm-$($Vm.Name).state" }
function Get-PrewarmState($Vm) {
  $f = Get-PrewarmStateFile $Vm
  if (-not (Test-Path $f)) { return 'cold' }
  $s = (Get-Content $f -Raw -ErrorAction SilentlyContinue).Trim()
  if ($s -eq 'warm') {
    # Only trust 'warm' if a suspend state actually exists (.vmss) -- the VM may
    # have been powered off (GUI, manual, reboot) since the pre-warm, in which
    # case resuming would cold-boot instead of landing at create-game. Fall back
    # to cold and do a full reset.
    if (Get-ChildItem (Split-Path $Vm.Vmx) -Filter '*.vmss' -ErrorAction SilentlyContinue) { return 'warm' }
    return 'cold'
  }
  if ($s -eq 'warming') {
    # A 'warming' marker older than 90s means the pre-warm process died; the
    # revert takes ~20s, so anything this old is stale -> treat as cold.
    if (((Get-Date) - (Get-Item $f).LastWriteTime).TotalSeconds -gt 90) { return 'cold' }
    return 'warming'
  }
  return 'cold'
}

<#
.SYNOPSIS
  Launch a detached background revert so the next test skips the reset.
#>
function Start-PrewarmVm {
  [CmdletBinding()]
  param([object]$Vm)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  $script = Join-Path $PSScriptRoot 'prewarm.ps1'
  Start-Process powershell -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File', $script,
    '-Vmx', $Vm.Vmx, '-Snapshot', $Vm.Snapshot, '-StateFile', (Get-PrewarmStateFile $Vm)
  ) | Out-Null
}

<#
.SYNOPSIS
  Copy the built .w3x into the guest under a filename that has never existed.
.DESCRIPTION
  CRITICAL: a snapshot-restored WC3 rejects a map that OVERWRITES a filename it
  already knew about ("The map is unavailable or corrupted"), but accepts one
  under a new name. So each run gets a fresh random name and the previous map
  is deleted. Do not change this to a fixed filename.
#>
function Copy-MapToTestVm {
  [CmdletBinding()]
  param([object]$Vm, [Parameter(Mandatory)][string]$Map)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  if (-not (Test-Path $Map)) { throw "Map not found: $Map. Run 'npm run build' first." }
  $dl = "$($Vm.GuestHome)\Documents\Warcraft III\Maps\Download"
  # Empty the whole Download folder -- files AND leftover subfolders -- so the
  # uploaded map is the ONLY entry and lands on the firstMapRow coordinate.
  # (WC3 lists subfolders before maps, so a stray folder would shift the row.)
  # Recreating the folder with vmrun's native directory ops is ~4s faster than
  # spawning a guest PowerShell to do it -- delete is recursive, and WC3 is
  # parked ABOVE Download (not holding it) so the delete succeeds.
  Invoke-VmRun $Vm deleteDirectoryInGuest $Vm.Vmx $dl 2>$null | Out-Null
  Invoke-VmRun $Vm createDirectoryInGuest $Vm.Vmx $dl | Out-Null
  $guestName = "ZZ$(Get-Random -Minimum 100000 -Maximum 999999).w3x"
  Invoke-VmRun $Vm CopyFileFromHostToGuest $Vm.Vmx $Map "$dl\$guestName" | Out-Null
  return $guestName
}

<#
.SYNOPSIS
  Fast existence check for a CustomMapData file. No file transfer, so it is
  cheaper than Get-TestVmResultFile for polling a readiness marker.
#>
function Test-TestVmFile {
  [CmdletBinding()]
  param([object]$Vm, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  $guestPath = "$($Vm.GuestHome)\Documents\Warcraft III\CustomMapData\TheTrainGame\$Name"
  $out = Invoke-VmRun $Vm fileExistsInGuest $Vm.Vmx $guestPath
  return ("$out" -match 'The file exists')
}

<#
.SYNOPSIS
  Read a file out of the guest's CustomMapData folder. Returns $null if absent.
#>
function Get-TestVmResultFile {
  [CmdletBinding()]
  param([object]$Vm, [Parameter(Mandatory)][string]$Name, [string]$Destination)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  if (-not $Destination) { $Destination = Join-Path $env:TEMP "trainvm-$($Vm.Name)-$([IO.Path]::GetFileName($Name))" }
  Remove-Item $Destination -Force -ErrorAction SilentlyContinue
  $guestPath = "$($Vm.GuestHome)\Documents\Warcraft III\CustomMapData\TheTrainGame\$Name"
  Invoke-VmRun $Vm CopyFileFromGuestToHost $Vm.Vmx $guestPath $Destination 2>&1 | Out-Null
  if (Test-Path $Destination) { return (Get-Content $Destination -Raw) }
  return $null
}

<#
.SYNOPSIS
  Save a PNG of the guest's screen. Use this to see what a failed run was doing.
#>
function Get-TestVmScreenshot {
  [CmdletBinding()]
  param([object]$Vm, [Parameter(Mandatory)][string]$Path, $Connection)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  $own = $null -eq $Connection
  if ($own) { $Connection = Vnc-Connect $Vm.VncPort }
  try   { Vnc-Shot $Connection $Path }
  finally { if ($own) { $Connection.cli.Close() } }
  return $Path
}

<#
.SYNOPSIS
  Type a chat command into the running game (Enter, text, Enter).
#>
function Send-TestVmChat {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Connection, [Parameter(Mandatory)][string]$Text)
  Vnc-Tap $Connection 0xFF0D
  Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $Connection $Text
  Start-Sleep -Milliseconds 200
  Vnc-Tap $Connection 0xFF0D
}

<#
.SYNOPSIS
  Drive WC3 from the Create Game screen into a running match on the uploaded map.
#>
function Start-TestVmMatch {
  [CmdletBinding()]
  param([object]$Vm, $Connection, [string]$PlayerName = 'agent')
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  $ui = $Vm.Ui
  $expected = $ui.framebuffer
  $actual = "$($Connection.w)x$($Connection.h)"
  if ($expected -and $actual -ne $expected) {
    throw ("VM $($Vm.Name) framebuffer is $actual but the UI coordinates in vms.json " +
           "were captured at $expected. Either fix the guest resolution or re-capture " +
           "coordinates with Get-TestVmScreenshot.")
  }
  Vnc-DblClick $Connection $ui.downloadFolder[0]  $ui.downloadFolder[1]
  Start-Sleep -Milliseconds 800
  Vnc-Click    $Connection $ui.firstMapRow[0]     $ui.firstMapRow[1]
  Start-Sleep -Milliseconds 500
  Vnc-Click    $Connection $ui.createButton[0]    $ui.createButton[1]
  Start-Sleep -Milliseconds 1500
  Vnc-Click    $Connection $ui.nameField[0]       $ui.nameField[1]
  Vnc-TypeSmart $Connection $PlayerName
  Vnc-Click    $Connection $ui.confirmButton[0]   $ui.confirmButton[1]
  Start-Sleep -Seconds 3
  Vnc-Click    $Connection $ui.startGameButton[0] $ui.startGameButton[1]
}

# --- Session lifecycle (shared by Invoke-MapTest and Use-TestVm) -----------
# Each takes an optional -Log scriptblock ({ param($m) ... }) so the caller can
# route messages through its own timestamped logger; it defaults to Write-Host.

<#
.SYNOPSIS
  Get the VM to a live, clean create-game menu -- resume it if a prior run
  pre-warmed it (~3s), otherwise a full reset (~15-20s).
#>
function Reset-OrResumeTestVm {
  [CmdletBinding()]
  param([object]$Vm, [scriptblock]$Log = { param($m) Write-Host $m })
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  $stateFile = Get-PrewarmStateFile $Vm
  if ((Get-PrewarmState $Vm) -eq 'warming') {
    & $Log 'waiting for background pre-warm to finish'
    $wd = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $wd -and (Get-PrewarmState $Vm) -eq 'warming') { Start-Sleep -Milliseconds 500 }
  }
  # Reverting/resuming a VM with an open GUI console tab yanks that window to the
  # front; capture the user's window and hand focus back once the VM is up.
  $fg = Save-Foreground
  if ((Get-PrewarmState $Vm) -eq 'warm') {
    & $Log "resuming pre-warmed $($Vm.Name) (skipped reset)"
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    & $script:VmRun -T ws start $Vm.Vmx nogui 2>&1 | Out-Null   # resume from suspend
  } else {
    & $Log "reset $($Vm.Name) -> $($Vm.Snapshot)"
    Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
    Reset-TestVm $Vm
  }
  Start-Sleep -Milliseconds 400
  Restore-Foreground $fg
}

<#
.SYNOPSIS
  After Start-TestVmMatch, wait until the map writes its ready marker. Returns
  $true if the map went live, $false on timeout. Re-clicks START GAME if a run
  looks stuck at the lobby.
#>
function Wait-TestVmReady {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Connection, [object]$Vm, [int]$TimeoutSec = 90,
        [scriptblock]$Log = { param($m) Write-Host $m })
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  & $Log 'waiting for map ready'
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $waitStart = Get-Date; $lastStartClick = Get-Date
  while ((Get-Date) -lt $deadline) {
    Vnc-Tap $Connection 0x20   # dismiss "press any key to continue"; harmless in-game
    if (Test-TestVmFile $Vm -Name 'test_ready.txt') { return $true }
    # A single lobby START GAME click sometimes drops. The happy path is ready in
    # <10s, so only re-click after that -- re-clicking during a normal load slows it.
    if (((Get-Date) - $waitStart).TotalSeconds -ge 10 -and ((Get-Date) - $lastStartClick).TotalSeconds -ge 5) {
      Vnc-Click $Connection $Vm.Ui.startGameButton[0] $Vm.Ui.startGameButton[1]
      $lastStartClick = Get-Date
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

<#
.SYNOPSIS
  The clean end point: a run never leaves its VM running (a running WC3 burns
  ~1.5 CPU cores). Default -- detached revert+suspend (VM at 0 CPU, next run
  resumes). -NoPrewarm -- stop the VM (next run pays the full reset).
#>
function Complete-TestVm {
  [CmdletBinding()]
  param([object]$Vm, [switch]$NoPrewarm, [scriptblock]$Log = { param($m) Write-Host $m })
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  if ($NoPrewarm) {
    & $Log 'stopping VM (-NoPrewarm)'
    & $script:VmRun -T ws stop $Vm.Vmx soft 2>&1 | Out-Null
  } else {
    & $Log 'pre-warming next run (revert + suspend in background)'
    Start-PrewarmVm $Vm
  }
}

<#
.SYNOPSIS
  Run your own steps against a live map, with setup and cleanup handled for you.
.DESCRIPTION
  The flexible sibling of Invoke-MapTest: it resets/resumes the VM, uploads the
  map, drives into a live match, then invokes your -Body scriptblock with
  ($vm, $conn) -- do whatever you need (send chat commands, grab screenshots,
  read files). Whatever your body does or throws, the VM is cleaned up in a
  finally (revert+suspend, or -NoPrewarm to stop). This is how a custom flow
  gets the same "never leave a VM running" guarantee as the standard runner --
  use it instead of hand-rolling Reset -> upload -> ... and forgetting cleanup.
.PARAMETER Body
  Scriptblock invoked as & $Body $vm $conn. $conn is a live VNC connection
  (see Send-TestVmChat / Get-TestVmScreenshot / Vnc-* in vnc-fast.ps1).
.PARAMETER NoMap
  Skip the map upload + match start; the body gets the VM at the create-game
  menu instead of in a live match.
.EXAMPLE
  # Screenshot the peasant after a cheat command:
  Use-TestVm -Vm dougie -Body {
    param($vm, $conn)
    Send-TestVmChat $conn '-cheatmode'
    Start-Sleep -Seconds 3
    Get-TestVmScreenshot $vm -Path C:\out\peasant.png -Connection $conn
  }
#>
function Use-TestVm {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][scriptblock]$Body,
    [string]$Vm,
    [string]$Map,
    [string]$PlayerName = 'agent',
    [int]$ReadyTimeoutSec = 90,
    [switch]$NoMap,
    [switch]$NoPrewarm,
    [switch]$Quiet
  )
  $vmInfo = Get-TestVm $Vm
  if (-not $Map) { $Map = Join-Path $script:RepoRoot 'dist\bin\TheTrainGame.w3x' }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $log = { param($m) if (-not $Quiet) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) } }.GetNewClosure()

  Reset-OrResumeTestVm $vmInfo -Log $log
  if (-not $NoMap) {
    & $log 'upload map'
    $guestMap = Copy-MapToTestVm $vmInfo -Map $Map
    & $log "uploaded as $guestMap"
  }
  $conn = Vnc-Connect $vmInfo.VncPort
  try {
    if (-not $NoMap) {
      & $log 'start match'
      Start-TestVmMatch $vmInfo $conn -PlayerName $PlayerName
      if (-not (Wait-TestVmReady $conn $vmInfo -TimeoutSec $ReadyTimeoutSec -Log $log)) {
        throw "Map never became ready within ${ReadyTimeoutSec}s. Is initTestKit() called in main.ts?"
      }
    }
    & $Body $vmInfo $conn
  }
  finally {
    $conn.cli.Close()
    Complete-TestVm $vmInfo -NoPrewarm:$NoPrewarm -Log $log
  }
}

<#
.SYNOPSIS
  Build-free end-to-end test run: reset VM, load the map, run a test, return results.
.DESCRIPTION
  Run 'npm run build' first -- this uses whatever is already in dist/bin.
.PARAMETER Test
  Name registered with registerTest() in the map, e.g. 'damage' for
  registerTest('damage', ...). Sends '-test <name>' in game.
.EXAMPLE
  $r = Invoke-MapTest -Test damage
  if (-not $r.Ok) { $r.FailureReason }
  $r.Results['axe']            # '7.50'
.OUTPUTS
  Ok, Test, Vm, Results (ordered dict of key -> value), Failures, Raw,
  DurationSeconds, FailureReason, Screenshot.
#>
function Invoke-MapTest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Test,
    [string]$Vm,
    [string]$Map,
    [string]$PlayerName = 'agent',
    [int]$ReadyTimeoutSec = 90,
    [int]$TestTimeoutSec = 120,
    [string]$OutDir,
    [switch]$Quiet,
    [switch]$NoPrewarm
  )
  $vmInfo = Get-TestVm $Vm
  if (-not $Map)    { $Map    = Join-Path $script:RepoRoot 'dist\bin\TheTrainGame.w3x' }
  if (-not $OutDir) { $OutDir = Join-Path $env:TEMP "trainvm-$($vmInfo.Name)" }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $Say = { param($m) if (-not $Quiet) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) } }.GetNewClosure()

  $result = [ordered]@{
    Ok = $false; Test = $Test; Vm = $vmInfo.Name
    Results = [ordered]@{}; Failures = [ordered]@{}
    Raw = ''; DurationSeconds = 0; FailureReason = $null
    Screenshot = (Join-Path $OutDir 'final.png')
  }

  Reset-OrResumeTestVm $vmInfo -Log $Say
  & $Say 'upload map'
  $guestMap = Copy-MapToTestVm $vmInfo -Map $Map
  & $Say "uploaded as $guestMap"

  $conn = Vnc-Connect $vmInfo.VncPort
  try {
    & $Say 'start match'
    Start-TestVmMatch $vmInfo $conn -PlayerName $PlayerName
    $ready = Wait-TestVmReady $conn $vmInfo -TimeoutSec $ReadyTimeoutSec -Log $Say
    if (-not $ready) {
      $result.FailureReason = "Map never became ready within ${ReadyTimeoutSec}s. Is initTestKit() called in main.ts? See $($result.Screenshot)."
      Get-TestVmScreenshot $vmInfo -Path $result.Screenshot -Connection $conn | Out-Null
      $result.DurationSeconds = [math]::Round($sw.Elapsed.TotalSeconds,1)
      return [pscustomobject]$result
    }

    & $Say "running -test $Test"
    Send-TestVmChat $conn "-test $Test"

    # Results are rewritten after every measurement, so existence alone can
    # catch a half-written file -- wait for the trailing 'done' line.
    $deadline = (Get-Date).AddSeconds($TestTimeoutSec)
    $raw = $null
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
      $raw = Get-TestVmResultFile $vmInfo -Name "test_$Test.txt" -Destination (Join-Path $OutDir "test_$Test.txt")
      if ($raw -and $raw -match '"done"') { break }
    }
    Get-TestVmScreenshot $vmInfo -Path $result.Screenshot -Connection $conn | Out-Null

    if (-not $raw) {
      $result.FailureReason = "No results for '$Test'. Is it registered with registerTest('$Test', ...) and imported from main.ts?"
    } else {
      $result.Raw = $raw
      # Preload files are Jass source; the payload is each Preload("...") string.
      foreach ($m in [regex]::Matches($raw, 'Preload\(\s*"(.*?)"\s*\)')) {
        $line = $m.Groups[1].Value
        if ($line -in @('started','done')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $k = $line.Substring(0, $eq); $v = $line.Substring($eq+1)
        $result.Results[$k] = $v
        if ($v -like 'FAIL*') { $result.Failures[$k] = $v.Substring(4).Trim() }
      }
      if ($raw -notmatch '"done"') {
        $result.FailureReason = "Test '$Test' did not finish within ${TestTimeoutSec}s (partial results kept)."
      } elseif ($result.Failures.Count -gt 0) {
        $result.FailureReason = "Test reported failures: " + (($result.Failures.Keys) -join ', ')
      } else {
        $result.Ok = $true
      }
    }
  }
  finally {
    $conn.cli.Close()
    Complete-TestVm $vmInfo -NoPrewarm:$NoPrewarm -Log $Say
  }

  $result.DurationSeconds = [math]::Round($sw.Elapsed.TotalSeconds,1)
  & $Say ("done -- " + $(if($result.Ok){'PASS'}else{'FAIL: ' + $result.FailureReason}))
  return [pscustomobject]$result
}

<#
.SYNOPSIS
  Bring the map up in a VM and hand it over for a human to watch and play.
.DESCRIPTION
  Reverts the VM to its parked Create Game snapshot, uploads the current build,
  and leaves the VM running for you -- it never fires a -test command and never
  tears down. By default the VMware console window opens on the host (-Gui) so
  you can drive WC3 yourself; pass -Headless to keep it windowless and connect a
  VNC client to 127.0.0.1:<vncPort> (password below) instead.

  It deliberately does NOT block waiting for the map to go live, and by default
  does NOT auto-click through the menus. The menu-driving is calibrated for the
  focus/timing of the headless automated runs; with the GUI window up those
  clicks are unreliable, and a human watching can just start the match. The map
  is uploaded into Maps\Download -- open that folder, pick the ZZ*.w3x, Create,
  Start. Pass -AutoStart to attempt the menu-driving anyway (best effort).

  The session lives on a snapshot-backed VM: everything you do is discarded the
  next time anyone reverts it (e.g. the next Invoke-MapTest), so there is no
  cleanup and nothing to commit.

  Like Invoke-MapTest this loads whatever .w3x is already in dist/bin -- build
  first (npm run build) so the map reflects the code you want to try.
.PARAMETER AutoStart
  After uploading, try to drive the menus into a match (best effort) and wait
  briefly (ReadyTimeoutSec) for the map to signal ready. Never fatal.
.PARAMETER NoMap
  Revert and power on only, stopping at WC3's Create Game screen without
  uploading a map. Useful to poke the menus by hand.
.EXAMPLE
  Start-ManualSession
  # Targets your worktree's VM. VMware window opens with the map uploaded;
  # open Download and start it.
.EXAMPLE
  Start-ManualSession -AutoStart
  # Also attempts to click into a live match for you.
.OUTPUTS
  Vm, Ready, Map, GuestMap, VncHost, VncPort, VncPassword, Gui.
#>
function Start-ManualSession {
  [CmdletBinding()]
  param(
    [string]$Vm,
    [string]$Map,
    [string]$PlayerName = 'agent',
    [int]$ReadyTimeoutSec = 30,
    [switch]$Headless,
    [switch]$AutoStart,
    [switch]$NoMap
  )
  $vmInfo = Get-TestVm $Vm
  if (-not $Map) { $Map = Join-Path $script:RepoRoot 'dist\bin\TheTrainGame.w3x' }
  $gui = -not $Headless

  Write-Host "Reverting $($vmInfo.Name) to '$($vmInfo.Snapshot)' and powering on$(if($gui){' (GUI)'})..."
  Reset-TestVm $vmInfo -Gui:$gui

  $ready = $false
  $guestMap = $null
  if (-not $NoMap) {
    Write-Host 'Uploading map...'
    $guestMap = Copy-MapToTestVm $vmInfo -Map $Map
    Write-Host "Uploaded as $guestMap"

    if ($AutoStart) {
      $conn = Vnc-Connect $vmInfo.VncPort
      try {
        Write-Host 'Attempting to drive into a match (best effort)...'
        Start-TestVmMatch $vmInfo $conn -PlayerName $PlayerName
        Write-Host "Waiting up to ${ReadyTimeoutSec}s for the map to go live..."
        $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
        while ((Get-Date) -lt $deadline) {
          Vnc-Tap $conn 0x20
          if (Get-TestVmResultFile $vmInfo -Name 'test_ready.txt') { $ready = $true; break }
          Start-Sleep -Milliseconds 500
        }
      } finally { $conn.cli.Close() }
    }
  }

  Write-Host ''
  if ($gui) {
    Write-Host "The VMware window for '$($vmInfo.Name)' is open. Click in to control it; Ctrl+Alt releases the mouse." -ForegroundColor Green
  } else {
    Write-Host "Connect a VNC client to 127.0.0.1:$($vmInfo.VncPort) (password: $script:pw) to view/control it." -ForegroundColor Green
  }
  if ($NoMap) {
    Write-Host 'Stopped at the Create Game screen (no map uploaded).'
  } elseif ($ready) {
    Write-Host 'Map is live -- go play.' -ForegroundColor Green
  } else {
    Write-Host "To start the map: open the Download folder, pick $guestMap, Create, then Start."
  }
  Write-Host 'Everything is discarded on the next revert -- nothing to clean up.'

  return [pscustomobject]@{
    Vm = $vmInfo.Name; Ready = $ready; Map = $Map; GuestMap = $guestMap
    VncHost = '127.0.0.1'; VncPort = $vmInfo.VncPort; VncPassword = $script:pw; Gui = $gui
  }
}

<#
.SYNOPSIS
  Stop a test VM. Optional -- the next Invoke-MapTest reverts anyway.
#>
function Stop-TestVm {
  [CmdletBinding()]
  param([object]$Vm)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  & $script:VmRun -T ws stop $Vm.Vmx soft 2>&1 | Out-Null
}

Export-ModuleMember -Function Invoke-MapTest, Use-TestVm, Get-TestVm, Reset-TestVm,
  Stop-TestVm, Copy-MapToTestVm, Get-TestVmResultFile, Test-TestVmFile,
  Get-TestVmScreenshot, Send-TestVmChat, Start-TestVmMatch, Start-ManualSession,
  Start-PrewarmVm, Get-PrewarmState, Reset-OrResumeTestVm, Wait-TestVmReady,
  Complete-TestVm
