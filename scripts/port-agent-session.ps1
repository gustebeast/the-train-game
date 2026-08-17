<#
.SYNOPSIS
  Port a Claude Code session from the VSCode extension into the desktop app.

.DESCRIPTION
  A desktop session is a thin manifest wrapping a CLI transcript: the manifest's
  `cliSessionId` points at ~/.claude/projects/<project>/<id>.jsonl, which both the
  VSCode extension and the desktop app write to. Creating a manifest therefore
  makes an existing VSCode session appear in the desktop app's picker with its
  full history.

  Refuses to run if a live process still holds the session -- two processes
  appending to one transcript corrupts it.

  Restart the desktop app fully (no background claude.exe under WindowsApps)
  before the new session shows up.

.EXAMPLE
  powershell -File scripts/port-agent-session.ps1 -Agent murph
  powershell -File scripts/port-agent-session.ps1 -Agent all
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('dougie', 'murph', 'brenner', 'boof', 'lead', 'all')]
  [string]$Agent
)

$ErrorActionPreference = 'Stop'

$AGENTS = [ordered]@{
  dougie       = '85f17082-81e3-4aa2-9648-558ccedc1e55'
  murph        = '8b73078f-55fc-444e-b5cf-b8669231c135'
  brenner      = 'db93b45d-233c-4962-beef-c0b95cfc3327'
  boof         = 'd44ed014-7b8d-4d7a-9268-3a780141fe63'
  lead = 'dd1c8de1-b984-4aa0-a535-c6604c3dbc94'
}

$PROJECT  = 'C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame'
$TXDIR    = "$env:USERPROFILE\.claude\projects\c--Users-gus-Sync-Documents-Games-Warcraft3-TheTrainGame"
$STOREdir = "$env:APPDATA\Claude\claude-code-sessions"

# The manifest dir is nested <orgId>\<userId>; discover it rather than hardcoding.
$store = Get-ChildItem $STOREdir -Recurse -Filter 'local_*.json' -ErrorAction SilentlyContinue |
         Select-Object -First 1 -ExpandProperty DirectoryName
if ($null -eq $store) { throw "Could not locate the desktop session store under $STOREdir" }

# Sessions currently held by a live process (procStart guards against PID reuse).
$live = @{}
Get-ChildItem "$env:USERPROFILE\.claude\sessions\*.json" -ErrorAction SilentlyContinue | ForEach-Object {
  $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
  $p = Get-Process -Id $j.pid -ErrorAction SilentlyContinue
  if ($null -ne $p -and $p.StartTime.ToFileTime().ToString() -eq $j.procStart) {
    $live[$j.sessionId] = "$($j.entrypoint) pid=$($j.pid)"
  }
}

$existing = Get-ChildItem $store -Filter 'local_*.json' | ForEach-Object {
  (Get-Content $_.FullName -Raw | ConvertFrom-Json).cliSessionId
}

$targets = if ($Agent -eq 'all') { $AGENTS.Keys } else { @($Agent) }

foreach ($name in $targets) {
  $cliId = $AGENTS[$name]
  $tx    = Join-Path $TXDIR "$cliId.jsonl"

  if (-not (Test-Path $tx))      { Write-Warning "$name : no transcript at $tx -- skipped";                       continue }
  if ($existing -contains $cliId) { Write-Host    "$name : already ported -- skipped";                             continue }
  if ($live.ContainsKey($cliId))  { Write-Warning "$name : still LIVE ($($live[$cliId])) -- close it first, skipped"; continue }

  $f  = Get-Item $tx
  $id = 'local_' + [guid]::NewGuid().ToString()
  $m  = [ordered]@{
    sessionId                = $id
    cliSessionId             = $cliId
    cwd                      = $PROJECT
    originCwd                = $PROJECT
    lastFocusedAt            = [DateTimeOffset]::new($f.LastWriteTime).ToUnixTimeMilliseconds()
    createdAt                = [DateTimeOffset]::new($f.CreationTime).ToUnixTimeMilliseconds()
    lastActivityAt           = [DateTimeOffset]::new($f.LastWriteTime).ToUnixTimeMilliseconds()
    model                    = 'claude-opus-5'
    effort                   = 'medium'
    isArchived               = $false
    title                    = $name
    titleSource              = 'auto'
    permissionMode           = 'default'
    enabledMcpTools          = @{}
    chromePermissionMode     = 'skip_all_permission_checks'
    completedTurns           = 1
    alwaysAllowedReasons     = @()
    sessionPermissionUpdates = @()
    classifierSummaryEnabled = $true
    reportFindingsCard       = $true
    spawnSeed                = @{}
  }

  # MUST be BOM-less UTF-8. PowerShell 5.1's Set-Content -Encoding utf8 writes a
  # BOM, which makes the app's JSON.parse throw and the manifest is silently ignored.
  $json = $m | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText((Join-Path $store "$id.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "$name : ported -> $id.json"
}

Write-Host ''
Write-Host 'Now quit the desktop app FULLY and reopen it:'
Write-Host '  Get-Process claude | Where-Object { $_.Path -like "*WindowsApps*" }'
Write-Host 'must return nothing before you relaunch.'
