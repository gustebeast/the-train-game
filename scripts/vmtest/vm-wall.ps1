# VM wall -- all four test VMs tiled 2x2, like a bank of security monitors.
#
#   powershell -File scripts/vmtest/vm-wall.ps1
#   powershell -File scripts/vmtest/vm-wall.ps1 -Topmost
#
# Each tile is an independent VNC viewer on that VM's own port (5901-5904), so
# it is completely decoupled from VMware's GUI: tiles keep their place when a VM
# powers off (the runner stops VMs between tests) and light up again by
# themselves when the next test boots one. Watching does not disturb a run --
# VMware's VNC server accepts concurrent clients, and this only ever reads the
# framebuffer; it never sends input.
#
# Frames arrive as INCREMENTAL updates: after one full frame the server sends
# only the rectangles that changed, which is what makes this watchable. Asking
# for a full 1656x1249 frame every time costs ~1s to transfer and decode in
# PowerShell -- that is the ~1 fps you get if you do the obvious thing.
param(
  [switch]$Topmost,
  [int]$Fps       = 0,    # capture rate; 0 = match the guests (vms.json guestMaxFps)
  [int]$TileWidth = 640   # frames are scaled to this before display
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cfg = Get-Content (Join-Path $PSScriptRoot 'vms.json') -Raw | ConvertFrom-Json

# The guests render at WC3's maxfps, so capturing faster than that just resends
# identical frames. One source of truth in vms.json rather than a second 15 here.
if ($Fps -le 0) {
  $Fps = if ($cfg.PSObject.Properties.Name -contains 'guestMaxFps') { [int]$cfg.guestMaxFps } else { 15 }
}
$vms = @($cfg.vms.PSObject.Properties.Name | ForEach-Object {
  [pscustomobject]@{ Name = $_; Port = $cfg.vms.$_.vncPort }
} | Sort-Object Port)

# Workers publish frames here; the UI timer picks them up. Synchronized because
# each VM polls on its own thread -- one unreachable VM must not stall the rest.
$sync = [hashtable]::Synchronized(@{})
foreach ($v in $vms) {
  $sync[$v.Name] = [hashtable]::Synchronized(@{ Frame = $null; Status = 'connecting'; Seq = 0; Fps = 0.0 })
}

$worker = {
  param($Name, $Port, $Slot, $VncLib, $Fps, $TileWidth)
  . $VncLib
  Add-Type -AssemblyName System.Drawing
  $minGap = [int](1000 / [Math]::Max(1, $Fps))

  # Pull one framebuffer update and blit its rectangles into $full.
  # $incremental = 0 forces a whole frame, needed once to seed the tile.
  function Read-Update($conn, $full, [byte]$incremental) {
    $s = $conn.s; $w = $conn.w; $h = $conn.h
    $req = New-Object byte[] 10
    $req[0] = 3; $req[1] = $incremental
    $wb = [BitConverter]::GetBytes([uint16]$w); [array]::Reverse($wb); [array]::Copy($wb, 0, $req, 6, 2)
    $hb = [BitConverter]::GetBytes([uint16]$h); [array]::Reverse($hb); [array]::Copy($hb, 0, $req, 8, 2)
    $s.Write($req, 0, 10); $s.Flush()
    $hdr = ReadN $s 4
    $nr = BE16 $hdr[2..3]
    $changed = $false
    for ($r = 0; $r -lt $nr; $r++) {
      $rh = ReadN $s 12
      $rx = BE16 $rh[0..1]; $ry = BE16 $rh[2..3]; $rw = BE16 $rh[4..5]; $rhh = BE16 $rh[6..7]
      if ($rw -eq 0 -or $rhh -eq 0) { continue }
      $data = ReadN $s ($rw * $rhh * 4)
      $rect = New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rhh
      $bd = $full.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
      for ($y = 0; $y -lt $rhh; $y++) {
        [System.Runtime.InteropServices.Marshal]::Copy($data, $y * $rw * 4, [IntPtr]($bd.Scan0.ToInt64() + $y * $bd.Stride), $rw * 4)
      }
      $full.UnlockBits($bd)
      $changed = $true
    }
    return $changed
  }

  while ($true) {
    $conn = $null; $full = $null
    try {
      $conn = Vnc-Connect $Port
      $full = New-Object System.Drawing.Bitmap $conn.w, $conn.h, ([System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
      [void](Read-Update $conn $full 0)
      $Slot.Status = 'live'
      $th = [int]($TileWidth * $conn.h / $conn.w)
      $ticks = 0
      $t0 = [Diagnostics.Stopwatch]::StartNew()
      while ($true) {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        # Blocks until the guest actually changes something, so an idle VM costs
        # nothing instead of spinning on identical frames.
        $changed = Read-Update $conn $full 1
        if ($changed) {
          $small = New-Object System.Drawing.Bitmap $TileWidth, $th
          $g = [System.Drawing.Graphics]::FromImage($small)
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
          $g.DrawImage($full, 0, 0, $TileWidth, $th)
          $g.Dispose()
          $old = $Slot.Frame
          $Slot.Frame = $small
          $Slot.Seq = $Slot.Seq + 1
          if ($old) { $old.Dispose() }
          $ticks++
          if ($t0.ElapsedMilliseconds -ge 1000) {
            $Slot.Fps = [math]::Round($ticks * 1000.0 / $t0.ElapsedMilliseconds, 1)
            $ticks = 0; $t0.Restart()
          }
        }
        $rest = $minGap - $sw.ElapsedMilliseconds
        if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }
      }
    } catch {
      # Powered off, mid-revert, or refusing connections -- all expected between
      # tests. Park the tile and keep retrying so it relights by itself.
      $Slot.Status = 'off'; $Slot.Fps = 0
      if ($full) { try { $full.Dispose() } catch {} }
      if ($conn -and $conn.cli) { try { $conn.cli.Close() } catch {} }
      Start-Sleep -Seconds 2
    }
  }
}

$vncLib = Join-Path $PSScriptRoot 'vnc-fast.ps1'
$pool = [runspacefactory]::CreateRunspacePool(1, [Math]::Max(4, $vms.Count))
$pool.Open()
$handles = @()
foreach ($v in $vms) {
  $ps = [powershell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript($worker).AddArgument($v.Name).AddArgument($v.Port).AddArgument($sync[$v.Name]).AddArgument($vncLib).AddArgument($Fps).AddArgument($TileWidth)
  $handles += [pscustomobject]@{ Ps = $ps; Async = $ps.BeginInvoke() }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'TheTrainGame - test VM wall'
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 28)
$form.Size = New-Object System.Drawing.Size(1320, 1040)
$form.TopMost = [bool]$Topmost

$grid = New-Object System.Windows.Forms.TableLayoutPanel
$grid.Dock = 'Fill'; $grid.ColumnCount = 2; $grid.RowCount = 2
$grid.BackColor = $form.BackColor
foreach ($i in 1..2) {
  [void]$grid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 50)))
  [void]$grid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 50)))
}
$form.Controls.Add($grid)

$tiles = @{}
foreach ($v in $vms) {
  $panel = New-Object System.Windows.Forms.Panel
  $panel.Dock = 'Fill'
  $panel.BackColor = [System.Drawing.Color]::FromArgb(16, 16, 18)
  $panel.Margin = '3,3,3,3'
  $pic = New-Object System.Windows.Forms.PictureBox
  $pic.Dock = 'Fill'; $pic.SizeMode = 'Zoom'; $pic.BackColor = $panel.BackColor
  $label = New-Object System.Windows.Forms.Label
  $label.Dock = 'Bottom'; $label.Height = 22
  $label.ForeColor = [System.Drawing.Color]::Gainsboro
  $label.Font = New-Object System.Drawing.Font('Consolas', 9)
  $label.TextAlign = 'MiddleLeft'
  $label.Text = "  $($v.Name)  :$($v.Port)"
  $panel.Controls.Add($pic)
  $panel.Controls.Add($label)
  $grid.Controls.Add($panel)
  $tiles[$v.Name] = @{ Pic = $pic; Label = $label; Seq = -1 }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 66
$timer.Add_Tick({
  foreach ($v in $vms) {
    $slot = $sync[$v.Name]
    $tile = $tiles[$v.Name]
    if ($slot.Status -eq 'live') {
      if ($slot.Seq -ne $tile.Seq -and $slot.Frame) {
        $tile.Seq = $slot.Seq
        $old = $tile.Pic.Image
        $tile.Pic.Image = $slot.Frame.Clone()
        if ($old) { $old.Dispose() }
      }
      $tile.Label.ForeColor = [System.Drawing.Color]::FromArgb(120, 220, 120)
      $tile.Label.Text = "  $($v.Name)  :$($v.Port)   live   $($slot.Fps) fps"
    } else {
      if ($tile.Pic.Image) { $tile.Pic.Image.Dispose(); $tile.Pic.Image = $null }
      $tile.Seq = -1
      $tile.Label.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 155)
      $tile.Label.Text = "  $($v.Name)  :$($v.Port)   powered off"
    }
  }
})
$timer.Start()

$form.Add_FormClosed({
  $timer.Stop()
  foreach ($h in $handles) { try { $h.Ps.Stop(); $h.Ps.Dispose() } catch {} }
  try { $pool.Close(); $pool.Dispose() } catch {}
})

Write-Host "Watching $($vms.Count) VMs: $(($vms | ForEach-Object { "$($_.Name):$($_.Port)" }) -join ', ')"
Write-Host 'Close the window to stop. Tiles relight on their own when a test boots a VM.'
[void]$form.ShowDialog()
