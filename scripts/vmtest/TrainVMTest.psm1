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

# Guest operations fail SILENTLY unless their OUTPUT is read: vmrun writes
# "Error: ..." to stdout, so a caller that pipes to Out-Null cannot tell a
# completed upload from one that never happened.
#
# That is exactly how a dead guest-operations link presented as a map bug. The
# upload no-opped, the guest kept whatever map the snapshot already held, the
# harness launched THAT, and 45 seconds later blamed the map for not writing a
# ready marker it was never going to write. An hour went into the map and the
# test before anyone looked at the VM.
function Invoke-VmRunChecked {
  param([Parameter(Mandatory)][object]$Vm, [string]$What = 'guest operation',
        [Parameter(ValueFromRemainingArguments)][string[]]$Args)
  $out = Invoke-VmRun $Vm @Args
  if ("$out" -match 'Error:') {
    throw ("$What failed on $($Vm.Name): $("$out".Trim()) -- this is the VMware " +
           'guest-operations link, NOT the map, the test or your code. Check ' +
           "'vmrun -T ws checkToolsState' and the guest credentials in vms.json.")
  }
  return $out
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
    # 'off' unplugs the virtual NIC on every start; anything else leaves it on
    # the host-only network. Single-player tests need no network at all, and a
    # guest with no cable cannot reach Battle.net even if some future change
    # puts it back on a routable network by accident.
    Network       = if ($entry.PSObject.Properties.Name -contains 'network') { $entry.network } else { 'hostonly' }
  }
}

<#
.SYNOPSIS
  Mean brightness (0-255) of a rectangle in a PNG. Used to read coarse UI state
  off a screenshot without OCR -- "is this list full or empty", not "what does
  it say".
.DESCRIPTION
  Samples every 8th pixel: GetPixel is slow, this runs between menu clicks, and
  a mean over several hundred samples is far more precision than a full/empty
  decision needs. Thresholds against it should be MEASURED from real
  screenshots of both states and left with a wide margin -- a guessed threshold
  here produced a false positive that cost hours.
#>
function Get-ImageRegionBrightness {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path, [int]$X, [int]$Y, [int]$W, [int]$H)
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $sum = 0.0; $n = 0
    for ($yy = $Y; $yy -lt [Math]::Min($Y + $H, $bmp.Height); $yy += 8) {
      for ($xx = $X; $xx -lt [Math]::Min($X + $W, $bmp.Width); $xx += 8) {
        $p = $bmp.GetPixel($xx, $yy); $sum += ($p.R + $p.G + $p.B) / 3.0; $n++
      }
    }
    if ($n -eq 0) { return 0 }
    return [math]::Round($sum / $n, 2)
  } finally { $bmp.Dispose() }
}

function Set-TestVmHostOnly {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Vmx)
  # Force host-only networking, every start, no exceptions.
  #
  # A guest that can reach the internet can reach Battle.net, and going online
  # churns the single-use session token shared across all the clones. Host-only
  # makes that impossible by construction rather than by convention.
  #
  # This has to run AFTER the revert and BEFORE the start: reverting restores
  # the snapshot's hardware config, so a clone minted while on NAT comes back as
  # NAT every single time and no one-off vmx edit survives. Brenner and Boof
  # were both found sitting on NAT this way.
  # VMware still holds the vmx for a moment after a revert, so reading or writing
  # it here can throw IOException. That is transient -- retry rather than kill
  # the run over it -- but do NOT swallow it: silently skipping this check is
  # exactly how brenner and boof sat on NAT unnoticed in the first place.
  if (-not (Test-Path $Vmx)) { return }
  $lastErr = $null
  foreach ($attempt in 1..8) {
    try {
      $txt = [IO.File]::ReadAllText($Vmx)
      $fixed = [regex]::Replace($txt, 'ethernet0\.connectionType\s*=\s*"[^"]*"', 'ethernet0.connectionType = "hostonly"')
      if ($fixed -eq $txt) { return }          # already host-only, nothing to write
      [IO.File]::WriteAllText($Vmx, $fixed)
      return
    } catch {
      $lastErr = $_
      Start-Sleep -Milliseconds 400
    }
  }
  throw ("Could not enforce host-only networking on $Vmx after 8 attempts -- refusing to " +
         "start a VM whose network mode is unverified, because a guest that reaches " +
         "Battle.net churns the session token shared by every clone. Last error: $lastErr")
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
  Set-TestVmHostOnly -Vmx $Vm.Vmx
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
  # Silence the guest on every start. The snapshot is minted with sound already
  # disconnected, but a revert re-attaches the device (sound.startConnected), so
  # without this the host hears WC3's menu music whenever a test runs.
  & $script:VmRun -T ws disconnectNamedDevice $Vm.Vmx sound 2>&1 | Out-Null
  Disconnect-TestVmNic $Vm
}

<#
.SYNOPSIS
  Unplug the virtual NIC on VMs configured with network = 'off'.
.DESCRIPTION
  Same reasoning as the sound device above, and the same reason it is done at
  RUNTIME rather than in the vmx: these are live snapshots, so the adapter's
  connected state is part of the saved memory state and comes back however it
  was when the snapshot was minted -- ethernet0.startConnected in the vmx does
  not decide it. Only disconnectNamedDevice reliably does.

  Single-player tests need no network at all, so the safest configuration is no
  cable. It also removes the last path to Battle.net, whose session token is
  shared across every clone and consumed by the first one that gets online.
#>
function Disconnect-TestVmNic {
  [CmdletBinding()]
  param([object]$Vm)
  if ($null -eq $Vm) { $Vm = Get-TestVm }
  if ($Vm.Network -ne 'off') { return }
  & $script:VmRun -T ws disconnectNamedDevice $Vm.Vmx ethernet0 2>&1 | Out-Null
}

# --- Pre-warming ----------------------------------------------------------
# After a test, a detached process reverts the VM to create-game and SUSPENDS
# it, so the NEXT test skips the ~15-20s reset (resume takes ~3s) AND the VM
# burns no CPU while idle (a running WC3 renders its menu at ~1.5 cores). The
# revert+suspend runs during the agent's build/edit time. A state file tracks
# it: 'warming' while in flight, 'warm' once suspended and ready. See prewarm.ps1.
function Get-PrewarmStateFile($Vm) { Join-Path $env:TEMP "trainvm-prewarm-$($Vm.Name).state" }
function Get-PrewarmPidFile($Vm) { Join-Path $env:TEMP "trainvm-prewarm-$($Vm.Name).pid" }

<#
.SYNOPSIS
  Block until no pre-warm process is touching this VM.
.DESCRIPTION
  The state file says what the pre-warm INTENDS; it does not say whether the
  process is still running. Those came apart badly: a run takes the VM and
  deletes the marker, but the detached prewarm.ps1 keeps going and reverts the
  snapshot underneath a live test -- the VNC connection dies with "connection
  aborted by the software in your host machine" and WC3 is left sitting on
  whatever stock map the reverted menu had selected.
  So gate on the PROCESS, not the marker. Nothing may touch a VM while its
  pre-warm is alive.
#>
function Wait-PrewarmExit {
  [CmdletBinding()]
  param([object]$Vm, [int]$TimeoutSec = 120, [scriptblock]$Log)
  $pidFile = Get-PrewarmPidFile $Vm
  if (-not (Test-Path $pidFile)) { return }
  $prewarmPid = 0
  [void][int]::TryParse((Get-Content $pidFile -Raw -ErrorAction SilentlyContinue).Trim(), [ref]$prewarmPid)
  if ($prewarmPid -gt 0) {
    $proc = Get-Process -Id $prewarmPid -ErrorAction SilentlyContinue
    if ($null -ne $proc) {
      if ($null -ne $Log) { & $Log 'waiting for the pre-warm process to finish with this VM' }
      try { $proc.WaitForExit($TimeoutSec * 1000) | Out-Null } catch {}
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
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
  $proc = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File', $script,
    '-Vmx', $Vm.Vmx, '-Snapshot', $Vm.Snapshot, '-StateFile', (Get-PrewarmStateFile $Vm),
    '-Network', $Vm.Network
  )
  # Record who is doing it, so the next run can wait for this exact process
  # rather than guessing from the state file. See Wait-PrewarmExit.
  Set-Content (Get-PrewarmPidFile $Vm) $proc.Id -Encoding ascii
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
  # Unchecked on purpose: this reports "The file already exists" when the delete
  # above was a no-op, which is benign and not worth failing a run over. The
  # upload itself is checked, and then read back, which is the proof that
  # matters -- a folder that exists is fine, a map that is not in it is not.
  Invoke-VmRun $Vm createDirectoryInGuest $Vm.Vmx $dl 2>$null | Out-Null
  $guestName = "ZZ$(Get-Random -Minimum 100000 -Maximum 999999).w3x"
  Invoke-VmRunChecked $Vm -What 'map upload' CopyFileFromHostToGuest $Vm.Vmx $Map "$dl\$guestName" | Out-Null
  # Read it back. An upload that quietly does nothing leaves the browser showing
  # whatever was there before, and the run then measures a map nobody built.
  $landed = Invoke-VmRun $Vm fileExistsInGuest $Vm.Vmx "$dl\$guestName"
  if ("$landed" -notmatch 'The file exists') {
    throw ("map upload to $($Vm.Name) reported success but $guestName is not in " +
           "the guest's Download folder ($("$landed".Trim())). The run would have " +
           'launched a stale map.')
  }
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
  if ("$out" -match 'The file exists') { return $true }
  if ("$out" -match 'does not exist')  { return $false }
  # Anything else means the guest link is down, which is NOT "the file is not
  # there yet". Returning false here is what let a broken VM masquerade as a map
  # that never finished initialising.
  throw ("cannot reach $($Vm.Name)'s filesystem: $("$out".Trim()) -- VMware guest " +
         'operations are down. The map and the test are not implicated.')
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
  # LOOK before navigating: row 1 of the map browser means different things in
  # the two states the VMs are parked in, and the clones are NOT consistent.
  #
  #   murph  -- parked at the TOP level: row 1 is the "Download" folder
  #   boof   -- parked INSIDE Download:  row 1 is "(up one level)"
  #
  # (downloadFolder and upOneLevel in vms.json are deliberately the same
  # coordinate: it is one row, named twice.)
  #
  # Blind-clicking row 1 therefore enters Download on one VM and ESCAPES INTO
  # THE STOCK BLIZZARD MAPS on another, where firstMapRow selects something like
  # "Justice" and the run dies 45s later having never touched the uploaded map.
  # It looked intermittent only because the click is sometimes swallowed by the
  # list refresh that follows the upload -- a coin flip, not a rare event.
  #
  # A fixed click count cannot fix this: the states are one level apart, so any
  # count that normalises one breaks the other. So decide from the screen. The
  # two states are trivially separable well below the first rows -- inside
  # Download the list has two entries and is empty beneath them, at the top
  # level it is full of maps. Measured on real screens: ~5.5-6.1 inside
  # Download, ~27.1-27.8 at the top level, hence the threshold of 15.
  # ...and CONFIRM it arrived, because the click is not reliably delivered.
  #
  # The map upload immediately before this makes WC3 rebuild the list, and a
  # double-click landing during that rebuild is silently swallowed. Checking the
  # state once and clicking blind therefore still fails: the browser stays at
  # the top level, firstMapRow picks a Blizzard map, and the run dies 45s later.
  #
  # This is not a retry papering over a flaky step -- it is a closed loop on an
  # observable, and it stops the moment the browser is where it must be. If it
  # never gets there, the run says so immediately instead of burning the ready
  # timeout on a map it was never going to load.
  $shot = Join-Path $env:TEMP "trainvm-$($Vm.Name)-browser.png"
  $inDownload = $false
  foreach ($attempt in 1..5) {
    $probe = Vnc-Connect $Connection.port   # fresh connection: a reused one is sent only CHANGED regions
    try { Vnc-Shot $probe $shot } finally { $probe.cli.Close() }
    if ((Get-ImageRegionBrightness $shot 590 430 390 560) -le 15) { $inDownload = $true; break }
    # Top level: row 1 is the "Download" folder, so enter it and look again.
    Vnc-DblClick $Connection $ui.downloadFolder[0] $ui.downloadFolder[1]
    Start-Sleep -Milliseconds 1200
  }
  if (-not $inDownload) {
    throw ("$($Vm.Name): the map browser would not enter the Download folder after 5 attempts " +
           "(it is still showing the full stock map list). Selecting a map now would run one of " +
           "Blizzard's, not the built map. Screenshot: $shot")
  }
  Start-Sleep -Milliseconds 300
  Vnc-Click    $Connection $ui.firstMapRow[0]     $ui.firstMapRow[1]
  Start-Sleep -Milliseconds 500
  Vnc-Click    $Connection $ui.createButton[0]    $ui.createButton[1]
  Start-Sleep -Milliseconds 1500

  # ENTER PLAYER NAME is the step that strands runs. The guest profile has no
  # saved name, so CREATE always raises this dialog, and CONFIRM on an EMPTY
  # field is a no-op -- the run then burns its whole timeout with the correct
  # map selected and an empty name box. The lost step is the typing: the field
  # needs a moment to take focus after the dialog animates in, and WC3 samples
  # the keyboard once per render frame. Hence the settle delay before typing.
  # Deliberately NOT retried -- a retry would just hide it coming back.
  Vnc-Click $Connection $ui.nameField[0] $ui.nameField[1]
  Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $Connection $PlayerName
  Start-Sleep -Milliseconds 300
  Vnc-Click $Connection $ui.confirmButton[0] $ui.confirmButton[1]

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
  # Hard interlock: never touch a VM whose pre-warm process is still alive.
  Wait-PrewarmExit $Vm -Log $Log
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
    # The resume path skips Reset-TestVm entirely, so it has to unplug the NIC
    # itself; a suspended VM comes back with whatever devices it was suspended
    # holding.
    Disconnect-TestVmNic $Vm
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
  Check that the test harness itself is sane before trusting a result.
.DESCRIPTION
  A green PASS is only meaningful if the harness actually exercised the code you
  think it did. This verifies the preconditions that otherwise fail silently or
  confusingly -- most importantly a STALE BUILD (editing src/ but forgetting
  `npm run build` means the VM runs the previous map and passes happily).
  Returns an object with Ok plus Checks (name -> Pass/Fail/Warn + detail), and
  prints a readable table unless -Quiet.
.PARAMETER Test
  Optional test name to additionally verify is registered in src/.
.EXAMPLE
  powershell -File scripts/vmtest/run-test.ps1 -SelfTest -Test damage
#>
function Test-TestHarness {
  [CmdletBinding()]
  param([string]$Vm, [string]$Test, [string]$Map, [switch]$Quiet)
  $checks = [ordered]@{}
  function Add-Check($name, $state, $detail) { $checks[$name] = [pscustomobject]@{ State = $state; Detail = $detail } }

  # 1. vmrun present -- everything else depends on it.
  if (Test-Path $script:VmRun) { Add-Check 'vmrun' 'Pass' $script:VmRun }
  else { Add-Check 'vmrun' 'Fail' "not found at $($script:VmRun) -- is VMware Workstation installed?" }

  # 2. VM resolves (registry, ready flag, base-image refusal, branch auto-detect).
  $vmInfo = $null
  try { $vmInfo = Get-TestVm $Vm; Add-Check 'vm resolved' 'Pass' "$($vmInfo.Name) (vnc $($vmInfo.VncPort), snapshot '$($vmInfo.Snapshot)')" }
  catch { Add-Check 'vm resolved' 'Fail' $_.Exception.Message }

  if ($null -ne $vmInfo) {
    # 3. vmx on disk.
    if (Test-Path $vmInfo.Vmx) { Add-Check 'vmx exists' 'Pass' $vmInfo.Vmx }
    else { Add-Check 'vmx exists' 'Fail' "missing: $($vmInfo.Vmx) -- clone it per VM-SETUP.md" }

    # 4. The snapshot we revert to must exist, or every run cold-boots into nothing.
    if (Test-Path $vmInfo.Vmx) {
      $snaps = & $script:VmRun listSnapshots $vmInfo.Vmx 2>&1
      if ("$snaps" -match [regex]::Escape($vmInfo.Snapshot)) { Add-Check 'snapshot exists' 'Pass' $vmInfo.Snapshot }
      else { Add-Check 'snapshot exists' 'Fail' "'$($vmInfo.Snapshot)' not found -- mint it (VM-SETUP.md step 8). Have: $("$snaps" -replace '\s+',' ')" }
    }

    # 5. UI coordinate set present for this VM (windowed vs fullscreen).
    if ($null -ne $vmInfo.Ui -and $null -ne $vmInfo.Ui.startGameButton) { Add-Check 'ui coords' 'Pass' "framebuffer $($vmInfo.Ui.framebuffer)" }
    else { Add-Check 'ui coords' 'Fail' "no uiSet for this VM in vms.json ('ui' field)" }
  }

  # 6. Built map exists, and is NEWER than the newest source file. A stale build
  #    is the classic false green: the test passes against the previous map.
  if (-not $Map) { $Map = Join-Path $script:RepoRoot 'dist\bin\TheTrainGame.w3x' }
  # Give a just-finished build a moment to become visible.
  #
  # build.ts writes the archive with writeFileSync BEFORE it logs "Finished!",
  # so the build is genuinely complete -- but on this Sync-hosted path the file
  # is not visible to the next process for a few seconds (antivirus or
  # filesystem lag). `npm run build` immediately followed by a test therefore
  # fails with "no map" against a map that exists. Waiting for it to appear AND
  # stop changing size fixes the race without hiding a real missing build: if
  # there is genuinely no map, this costs one wasted second and still fails.
  if (-not (Test-Path $Map)) {
    $settleDeadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $settleDeadline -and -not (Test-Path $Map)) { Start-Sleep -Milliseconds 500 }
  }
  if (Test-Path $Map) {
    # A file that is still growing is a build mid-flight, not a finished one.
    $lastLen = -1
    foreach ($i in 1..20) {
      $len = (Get-Item $Map).Length
      if ($len -eq $lastLen -and $len -gt 0) { break }
      $lastLen = $len
      Start-Sleep -Milliseconds 250
    }
    $mapTime = (Get-Item $Map).LastWriteTime
    $srcDir = Join-Path $script:RepoRoot 'src'
    $newestSrc = Get-ChildItem $srcDir -Recurse -File -Include *.ts -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -ne $newestSrc -and $newestSrc.LastWriteTime -gt $mapTime) {
      $mins = [math]::Round(($newestSrc.LastWriteTime - $mapTime).TotalMinutes,1)
      Add-Check 'build fresh' 'Fail' "STALE: $($newestSrc.Name) is ${mins} min newer than the built map. Run 'npm run build' or you are testing the previous map."
    } else {
      Add-Check 'build fresh' 'Pass' "built $($mapTime.ToString('HH:mm:ss'))"
    }
  } else {
    Add-Check 'build fresh' 'Fail' "no map at $Map -- run 'npm run build'"
  }

  # 7. initTestKit() wired into main.ts, else the ready marker never appears and
  #    every run dies with "map never became ready".
  $mainTs = Join-Path $script:RepoRoot 'src\main.ts'
  if (Test-Path $mainTs) {
    $main = Get-Content $mainTs -Raw
    if ($main -match 'initTestKit\s*\(') { Add-Check 'initTestKit wired' 'Pass' 'called in main.ts' }
    else { Add-Check 'initTestKit wired' 'Fail' 'main.ts never calls initTestKit() -- the ready marker will never be written' }
  }

  # 7b. autoRun, if set, must name the test being run. initTestKit('damage') plus
  #     a run of 'dash' fails in the most misleading way available: the runner
  #     sends -test dash, testkit's re-entrancy guard correctly ignores it
  #     because damage is already running, and the run times out waiting for a
  #     results file that was never going to appear. (Raised by dougie.)
  if (Test-Path $mainTs) {
    $main = Get-Content $mainTs -Raw
    if ($main -match "initTestKit\s*\(\s*'([^']+)'") {
      $auto = $matches[1]
      if (-not $Test) { Add-Check 'autoRun' 'Warn' "main.ts auto-runs '$auto' on start" }
      elseif ($auto -eq $Test) { Add-Check 'autoRun' 'Pass' "main.ts auto-runs '$auto' -- no chat command needed" }
      else {
        Add-Check 'autoRun' 'Fail' ("main.ts auto-runs '$auto' but this run wants '$Test'. The auto-run test " +
          "starts first, the guard then ignores the -test command, and the run times out waiting for " +
          "test_$Test.txt. Change initTestKit('$auto') to initTestKit('$Test') or initTestKit().")
      }
    }
  }

  # 8. If a test name was given, it must be registered and its module imported.
  if ($Test) {
    $srcDir = Join-Path $script:RepoRoot 'src'
    $hits = Select-String -Path (Join-Path $srcDir '*.ts') -Pattern ("registerTest\(\s*'" + [regex]::Escape($Test) + "'") -ErrorAction SilentlyContinue
    if ($hits) {
      $file = [IO.Path]::GetFileNameWithoutExtension($hits[0].Path)
      $main = if (Test-Path (Join-Path $srcDir 'main.ts')) { Get-Content (Join-Path $srcDir 'main.ts') -Raw } else { '' }
      if ($main -match ("import\s+'\./" + [regex]::Escape($file) + "'")) { Add-Check "test '$Test' registered" 'Pass' "$file.ts, imported by main.ts" }
      else { Add-Check "test '$Test' registered" 'Fail' "registered in $file.ts but main.ts does not import './$file' -- it will never load" }
    } else {
      Add-Check "test '$Test' registered" 'Fail' "no registerTest('$Test', ...) found in src/"
    }
  }

  $failed = @($checks.Values | Where-Object { $_.State -eq 'Fail' })
  $result = [pscustomobject]@{ Ok = ($failed.Count -eq 0); Checks = $checks; Vm = $(if ($vmInfo) { $vmInfo.Name } else { $null }) }
  if (-not $Quiet) {
    foreach ($k in $checks.Keys) {
      $c = $checks[$k]
      $colour = switch ($c.State) { 'Pass' { 'Green' } 'Warn' { 'Yellow' } default { 'Red' } }
      Write-Host ("  {0,-24} {1,-5} {2}" -f $k, $c.State, $c.Detail) -ForegroundColor $colour
    }
    if ($result.Ok) { Write-Host 'harness OK' -ForegroundColor Green }
    else { Write-Host "harness NOT ready ($($failed.Count) failing) -- fix the above before trusting a result" -ForegroundColor Red }
  }
  return $result
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
    [int]$ReadyTimeoutSec = 45,
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
        throw "Map never became ready within ${ReadyTimeoutSec}s. Check the screenshot. ENTER PLAYER NAME with an EMPTY box: the name keystrokes were dropped (harness bug, not your test). A map list of Blizzard maps (Justice, Korea, Road to Stratholme): the browser was already inside Download, so the first double-click escaped UPWARDS and the uploaded map was never selected -- revert the VM and re-run. Otherwise the map threw during init, or initTestKit() is not called in main.ts."
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
    [int]$ReadyTimeoutSec = 45,
    [int]$TestTimeoutSec = 120,
    [string]$OutDir,
    [switch]$Quiet,
    [switch]$NoPrewarm,
    [switch]$AllowNoResults
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
      $result.FailureReason = "Map never became ready within ${ReadyTimeoutSec}s. Check the screenshot. ENTER PLAYER NAME with an EMPTY box: the name keystrokes were dropped (harness bug, not your test). A map list of Blizzard maps (Justice, Korea, Road to Stratholme): the browser was already inside Download, so the first double-click escaped UPWARDS and the uploaded map was never selected -- revert the VM and re-run. Otherwise the map threw during init, or initTestKit() is not called in main.ts. See $($result.Screenshot)."
      Get-TestVmScreenshot $vmInfo -Path $result.Screenshot -Connection $conn | Out-Null
      $result.DurationSeconds = [math]::Round($sw.Elapsed.TotalSeconds,1)
      return [pscustomobject]$result
    }

    # Skip the chat command when the map starts the test itself.
    #
    # initTestKit('<name>') runs the test off the map's own readiness timer, and
    # publishes 'autorun=<name>' in the ready marker to say so. Typing over VNC
    # is the slowest and least reliable step in a run -- WC3 samples the
    # keyboard once per render frame, so fast input transposes characters -- and
    # when the map has already started the test the command buys nothing. The
    # re-entrancy guard in startTest would ignore it anyway; this just stops
    # paying for it.
    $readyRaw = Get-TestVmResultFile $vmInfo -Name 'test_ready.txt' -Destination (Join-Path $OutDir 'test_ready.txt')

    # Is this even the map we just uploaded?
    #
    # The ready marker lists the tests the RUNNING map registered, so if the
    # requested one is absent the guest is running a different build. That is
    # not hypothetical: parking a clone inside the Download folder made WC3
    # reload the map cached in its snapshot, and a full run passed against a
    # days-old binary whose marker still advertised tests deleted from the
    # source. A green result from the wrong map is the worst thing this harness
    # can produce, so it is checked rather than assumed.
    if ($readyRaw -and $readyRaw -notmatch ('"' + [regex]::Escape($Test) + '"')) {
        $registered = ([regex]::Matches($readyRaw, 'Preload\(\s*"([^"]+)"\s*\)') | ForEach-Object { $_.Groups[1].Value }) -join ', '
        throw ("The running map does not register '$Test' -- it is not the map you just built. " +
               "It registered: $registered. This usually means the guest loaded a stale map " +
               "(check the map browser navigation) rather than the uploaded one.")
    }

    $autoRun = $null
    if ($readyRaw -and $readyRaw -match 'autorun=([A-Za-z0-9_]+)') { $autoRun = $matches[1] }
    if ($autoRun -eq $Test) {
      & $Say "$Test started itself (autoRun) -- no chat command needed"
    } elseif ($null -ne $autoRun) {
      # Mismatch is worth saying out loud: the map is running a DIFFERENT test
      # from the one asked for, so the results below would be the wrong test's.
      throw ("The map auto-runs '$autoRun' but this run asked for '$Test'. Build with " +
             "initTestKit('$Test') or run with -Test $autoRun -- otherwise the results " +
             "would be from the wrong test.")
    } else {
      & $Say "running -test $Test"
      Send-TestVmChat $conn "-test $Test"
    }

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
      } elseif ($result.Results.Count -eq 0 -and -not $AllowNoResults) {
        # Finished but reported nothing -- almost always a test that returned
        # early or forgot t.report(). Passing this would be a false green.
        $result.FailureReason = "Test '$Test' completed but reported no measurements. Did it call t.report(...)? (Pass -AllowNoResults if a result-free test is intended.)"
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

Export-ModuleMember -Function Invoke-MapTest, Use-TestVm, Test-TestHarness, Get-TestVm, Reset-TestVm,
  Stop-TestVm, Copy-MapToTestVm, Get-TestVmResultFile, Test-TestVmFile,
  Get-TestVmScreenshot, Send-TestVmChat, Start-TestVmMatch, Start-ManualSession,
  Start-PrewarmVm, Get-PrewarmState, Reset-OrResumeTestVm, Wait-TestVmReady,
  Complete-TestVm, Set-TestVmHostOnly, Get-ImageRegionBrightness
