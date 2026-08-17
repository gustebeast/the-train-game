# Bring the map up in a VM and hand it over for a human to watch and play,
# instead of running an automated -test measurement. See Start-ManualSession
# in TrainVMTest.psm1 for the details.
#
#   npm run build
#   powershell -File scripts/vmtest/manual-session.ps1 -Vm shared
#
# A VMware console window opens on the host with the map uploaded into the
# Download folder; open it and start the match yourself. Pass -AutoStart to try
# clicking into a match automatically (best effort), -Headless to skip the
# window and use a VNC client, or -NoMap to stop at the Create Game screen.
# Everything is discarded on the next VM revert.
param(
  [string]$Vm,
  [string]$Map,
  [string]$PlayerName = 'agent',
  [int]$ReadyTimeoutSec = 30,
  [switch]$Headless,
  [switch]$AutoStart,
  [switch]$NoMap
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TrainVMTest.psm1') -Force

$params = @{ PlayerName = $PlayerName; ReadyTimeoutSec = $ReadyTimeoutSec }
if ($Vm)        { $params.Vm        = $Vm }
if ($Map)       { $params.Map       = $Map }
if ($Headless)  { $params.Headless  = $true }
if ($AutoStart) { $params.AutoStart = $true }
if ($NoMap)     { $params.NoMap     = $true }

$s = Start-ManualSession @params
