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

# vmrun needs -T ws. Without it every guest operation fails with the very
# misleading "Error: A file was not found".
function Invoke-VmRun {
  param([Parameter(Mandatory)][object]$Vm, [Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $auth = @('-T','ws','-gu',$Vm.GuestUser,'-gp',$Vm.GuestPassword)
  & $script:VmRun @auth @Args 2>&1
}

<#
.SYNOPSIS
  Look up a VM by agent name (brenner/boof/dougie/murph/shared).
.DESCRIPTION
  Falls back to $env:TRAINVM, then the registry default. Set $env:TRAINVM once
  per session so you never have to pass -Vm.
#>
function Get-TestVm {
  [CmdletBinding()]
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $env:TRAINVM }
  if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $script:Config.default }
  $Name = $Name.ToLower()
  $entry = $script:Config.vms.$Name
  if ($null -eq $entry) {
    $known = ($script:Config.vms.PSObject.Properties.Name) -join ', '
    throw "Unknown VM '$Name'. Known VMs: $known"
  }
  $snapshot = if ($entry.PSObject.Properties.Name -contains 'snapshot') { $entry.snapshot } else { $script:Config.snapshot }
  if ($entry.PSObject.Properties.Name -contains 'ready' -and -not $entry.ready) {
    throw ("VM '$Name' has no live create-game snapshot yet, so there is nothing to revert to. " +
           "Mint it by following step 7 of VM-SETUP.md, then set ready:true in vms.json. " +
           "Until then use -Vm shared or -Vm dougie.")
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
  $clr = Join-Path $env:TEMP "trainvm-clear-$($Vm.Name).ps1"
  # Clearing old maps also keeps the listing to exactly one row, so the UI
  # click coordinates stay valid regardless of what previous runs left behind.
  Set-Content $clr "Remove-Item '$dl\*.w3x' -Force -ErrorAction SilentlyContinue" -Encoding utf8
  Invoke-VmRun $Vm CopyFileFromHostToGuest $Vm.Vmx $clr "$($Vm.GuestHome)\clear.ps1" | Out-Null
  Invoke-VmRun $Vm runProgramInGuest $Vm.Vmx -interactive `
    'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' "$($Vm.GuestHome)\clear.ps1" | Out-Null
  $guestName = "ZZ$(Get-Random -Minimum 100000 -Maximum 999999).w3x"
  Invoke-VmRun $Vm CopyFileFromHostToGuest $Vm.Vmx $Map "$dl\$guestName" | Out-Null
  return $guestName
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
    [switch]$Quiet
  )
  $vmInfo = Get-TestVm $Vm
  if (-not $Map)    { $Map    = Join-Path $script:RepoRoot 'dist\bin\TheTrainGame.w3x' }
  if (-not $OutDir) { $OutDir = Join-Path $env:TEMP "trainvm-$($vmInfo.Name)" }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  function Say($m){ if (-not $Quiet) { Write-Host ("[{0,6:N1}s] {1}" -f $sw.Elapsed.TotalSeconds, $m) } }

  $result = [ordered]@{
    Ok = $false; Test = $Test; Vm = $vmInfo.Name
    Results = [ordered]@{}; Failures = [ordered]@{}
    Raw = ''; DurationSeconds = 0; FailureReason = $null
    Screenshot = (Join-Path $OutDir 'final.png')
  }

  Say "reset $($vmInfo.Name) -> $($vmInfo.Snapshot)"
  Reset-TestVm $vmInfo
  Say 'upload map'
  $guestMap = Copy-MapToTestVm $vmInfo -Map $Map
  Say "uploaded as $guestMap"

  $conn = Vnc-Connect $vmInfo.VncPort
  try {
    Say 'start match'
    Start-TestVmMatch $vmInfo $conn -PlayerName $PlayerName

    # The map writes test_ready.txt from initTestKit(), which is the only
    # reliable "we are in game and chat works" signal. Until it shows up, keep
    # tapping space to clear the map's "press any key to continue" screen --
    # harmless once in game (space just recentres the camera).
    Say 'waiting for map ready'
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      Vnc-Tap $conn 0x20
      if (Get-TestVmResultFile $vmInfo -Name 'test_ready.txt') { $ready = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
      $result.FailureReason = "Map never became ready within ${ReadyTimeoutSec}s. Is initTestKit() called in main.ts? See $($result.Screenshot)."
      Get-TestVmScreenshot $vmInfo -Path $result.Screenshot -Connection $conn | Out-Null
      $result.DurationSeconds = [math]::Round($sw.Elapsed.TotalSeconds,1)
      return [pscustomobject]$result
    }

    Say "running -test $Test"
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
  finally { $conn.cli.Close() }

  $result.DurationSeconds = [math]::Round($sw.Elapsed.TotalSeconds,1)
  Say ("done -- " + $(if($result.Ok){'PASS'}else{'FAIL: ' + $result.FailureReason}))
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
  Start-ManualSession -Vm shared
  # VMware window opens with the map uploaded; open Download and start it.
.EXAMPLE
  Start-ManualSession -Vm shared -AutoStart
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

Export-ModuleMember -Function Invoke-MapTest, Get-TestVm, Reset-TestVm, Stop-TestVm,
  Copy-MapToTestVm, Get-TestVmResultFile, Get-TestVmScreenshot, Send-TestVmChat,
  Start-TestVmMatch, Start-ManualSession
