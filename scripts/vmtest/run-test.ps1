# Fast VM test loop for TheTrainGame.
#
# Key insight (found 2026-07-18): a WC3 restored from a live snapshot will NOT
# load a map file that OVERWRITES a filename it already knew about -- it reports
# "map is unavailable or corrupted". It WILL happily load a map that arrives
# under a filename that did not exist at snapshot time. So every run uploads the
# freshly built map under a unique generated name and deletes the previous one.
#
# Usage: run-test.ps1 [-Map <path>] [-Vmx <path>] [-VncPort 5900] [-Chat '-damagetest']
param(
  [string]$Map     = 'C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame\.worktrees\dougie\dist\bin\TheTrainGame.w3x',
  [string]$Vmx     = 'C:\VMs\TrainGameTest\TrainGameTest.vmx',
  [string]$Snapshot= 'create-game-v2',
  [int]   $VncPort = 5900,
  [string]$GuestUser = 'wc3',
  [string]$GuestPass = 'traintest',
  [string]$Chat    = '-damagetest',
  [int]   $ResultWaitSec = 25,
  # Preload writes under CustomMapData\<map name>\, not CustomMapData\ directly.
  [string]$ResultFile = 'TheTrainGame\damage_test.txt',
  [string]$OutDir  = 'C:\VMs\testout'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'vnc-fast.ps1')
$vmrun = 'C:\Program Files\VMware\VMware Workstation\vmrun.exe'
$g = @('-T','ws','-gu',$GuestUser,'-gp',$GuestPass)
$dl = "C:\Users\$GuestUser\Documents\Warcraft III\Maps\Download"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$total = [Diagnostics.Stopwatch]::StartNew()
function Step($n){ Write-Host ("[{0,6:N1}s] {1}" -f $total.Elapsed.TotalSeconds, $n) }

if (-not (Test-Path $Map)) { throw "map not found: $Map" }

# --- 1. revert to the Create Game snapshot -------------------------------
Step 'revert + start'
& $vmrun revertToSnapshot $Vmx $Snapshot | Out-Null
& $vmrun start $Vmx nogui | Out-Null

# --- 2. upload the map under a fresh unique name -------------------------
# Unique per run so WC3 never sees an overwritten filename. The stamp comes
# from the elapsed ticks of this run, which is enough to never collide.
$stamp = ([string](Get-Random -Minimum 100000 -Maximum 999999))
$guestName = "ZZ$stamp.w3x"
Step "upload as $guestName"
# Clear prior maps so the Download listing has exactly one entry at a known row.
$clr = Join-Path $OutDir 'clear.ps1'
Set-Content $clr "Remove-Item '$dl\*.w3x' -Force -ErrorAction SilentlyContinue" -Encoding utf8
& $vmrun @g CopyFileFromHostToGuest $Vmx $clr "C:\Users\$GuestUser\clear.ps1" | Out-Null
& $vmrun @g runProgramInGuest $Vmx -interactive 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' '-ExecutionPolicy' 'Bypass' '-File' "C:\Users\$GuestUser\clear.ps1" | Out-Null
& $vmrun @g CopyFileFromHostToGuest $Vmx $Map "$dl\$guestName" | Out-Null

# --- 3. drive the UI: Download -> map -> Create -> name -> Start ----------
Step 'navigate UI'
$c = Vnc-Connect $VncPort
Vnc-DblClick $c 810 339           # enter Download folder
Start-Sleep -Milliseconds 800
Vnc-Click    $c 810 378           # the only map row
Start-Sleep -Milliseconds 500
Vnc-Click    $c 1222 852          # CREATE
Start-Sleep -Milliseconds 1500
Vnc-Click    $c 827 504           # player-name field
Vnc-TypeSmart $c 'dougie'
Vnc-Click    $c 930 611           # CONFIRM
Start-Sleep -Seconds 3
Vnc-Shot $c (Join-Path $OutDir 'lobby.png')
Vnc-Click    $c 1222 853          # START GAME

# --- 4. wait for the loading screen, dismiss it --------------------------
Step 'loading'
Start-Sleep -Seconds 10
Vnc-Tap $c 0x20                   # "press any key to continue"
Start-Sleep -Seconds 8
Vnc-Shot $c (Join-Path $OutDir 'ingame.png')

# --- 5. issue the chat command that runs the test ------------------------
if ($Chat) {
  Step "chat: $Chat"
  Vnc-Tap $c 0xFF0D               # Enter opens chat
  Start-Sleep -Milliseconds 400
  Vnc-TypeSmart $c $Chat
  Start-Sleep -Milliseconds 200
  Vnc-Tap $c 0xFF0D
}

# --- 6. poll for the result file the map writes via Preload --------------
Step "waiting up to ${ResultWaitSec}s for $ResultFile"
$guestResult = "C:\Users\$GuestUser\Documents\Warcraft III\CustomMapData\$ResultFile"
$hostResult  = Join-Path $OutDir (Split-Path $ResultFile -Leaf)
Remove-Item $hostResult -Force -ErrorAction SilentlyContinue
$deadline = (Get-Date).AddSeconds($ResultWaitSec)
$got = $false
# The map writes the file incrementally, so existence alone is not enough --
# poll until the trailing "done" marker shows up or we run out of time.
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  & $vmrun @g CopyFileFromGuestToHost $Vmx $guestResult $hostResult 2>$null | Out-Null
  if (Test-Path $hostResult) {
    if ((Get-Content $hostResult -Raw) -match '"done"') { $got = $true; break }
  }
}
Vnc-Shot $c (Join-Path $OutDir 'final.png')
$c.cli.Close()

Step ('done -- result ' + $(if($got){'FOUND'}else{'MISSING'}))
if ($got) { Write-Host '--- result ---'; Get-Content $hostResult }
else { Write-Host "No $ResultFile. See $OutDir\ingame.png and final.png." }
