# Fast VNC helpers. Same protocol as vnc-lib.ps1 but framebuffer -> Bitmap via
# LockBits/Marshal.Copy instead of per-pixel SetPixel (which took minutes at 1080p).
$script:pw = 'trainvm1'
function BE32([byte[]]$b){ $r=$b.Clone(); [array]::Reverse($r); return [BitConverter]::ToUInt32($r,0) }
function BE16([byte[]]$b){ $r=$b.Clone(); [array]::Reverse($r); return [BitConverter]::ToUInt16($r,0) }
function RevBits([byte]$b){ $r=0; for($i=0;$i -lt 8;$i++){ $r=($r -shl 1) -bor ($b -band 1); $b=$b -shr 1 }; return [byte]$r }
function ReadN($st,$n){ $buf=New-Object byte[] $n; $off=0; while($off -lt $n){ $r=$st.Read($buf,$off,$n-$off); if($r -le 0){ throw 'eof' }; $off+=$r }; return ,$buf }
function VncResp([byte[]]$ch,[string]$p){ $k=New-Object byte[] 8; for($i=0;$i -lt 8;$i++){ if($i -lt $p.Length){ $c=[byte][char]$p[$i] } else { $c=0 }; $k[$i]=RevBits $c }; $des=[System.Security.Cryptography.DES]::Create(); $des.Mode='ECB'; $des.Padding='None'; $des.Key=$k; return $des.CreateEncryptor().TransformFinalBlock($ch,0,16) }

function Vnc-Connect([int]$port = 5900){
  $cli=New-Object System.Net.Sockets.TcpClient
  # Send each key event in its own packet instead of letting Nagle coalesce a
  # burst of them -- coalesced bursts arrive at the guest back-to-back and WC3
  # can sample several within one render frame, which scrambles their order.
  $cli.NoDelay = $true
  $cli.Connect('127.0.0.1',$port)
  $s=$cli.GetStream()
  $ver=ReadN $s 12; $s.Write($ver,0,12)
  $nsec=(ReadN $s 1)[0]; $types=ReadN $s $nsec
  if($types -contains 2){ $s.Write([byte[]]@(2),0,1); $ch=ReadN $s 16; $s.Write((VncResp $ch $script:pw),0,16); $null=ReadN $s 4 }
  else { $s.Write([byte[]]@(1),0,1); $null=ReadN $s 4 }
  $s.Write([byte[]]@(1),0,1)
  $si=ReadN $s 24; $nl=BE32 $si[20..23]; $null=ReadN $s $nl
  $w=BE16 $si[0..1]; $h=BE16 $si[2..3]
  $pf=[byte[]]@(0,0,0,0, 32,24,0,1, 0,255,0,255,0,255, 16,8,0, 0,0,0); $s.Write($pf,0,20)
  $se=[byte[]]@(2,0,0,1, 0,0,0,0); $s.Write($se,0,8)
  # port is carried so callers can reconnect: a second capture on an existing
  # connection only receives CHANGED rectangles and comes back nearly black.
  return [pscustomobject]@{ cli=$cli; s=$s; w=$w; h=$h; port=$port }
}

function Vnc-Shot($conn, $path){
  Add-Type -AssemblyName System.Drawing
  $s=$conn.s; $w=$conn.w; $h=$conn.h
  $req=New-Object byte[] 10; $req[0]=3; $req[1]=0
  $wb=[BitConverter]::GetBytes([uint16]$w); [array]::Reverse($wb); [array]::Copy($wb,0,$req,6,2)
  $hb=[BitConverter]::GetBytes([uint16]$h); [array]::Reverse($hb); [array]::Copy($hb,0,$req,8,2)
  $s.Write($req,0,10); $s.Flush()
  $hdr=ReadN $s 4
  $nr=BE16 $hdr[2..3]
  $bmp=New-Object System.Drawing.Bitmap $w,$h,([System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
  for($r=0;$r -lt $nr;$r++){
    $rh=ReadN $s 12
    $rx=BE16 $rh[0..1]; $ry=BE16 $rh[2..3]; $rw=BE16 $rh[4..5]; $rhh=BE16 $rh[6..7]
    if($rw -eq 0 -or $rhh -eq 0){ continue }
    $data=ReadN $s ($rw*$rhh*4)
    $rect=New-Object System.Drawing.Rectangle $rx,$ry,$rw,$rhh
    $bd=$bmp.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::WriteOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
    for($y=0;$y -lt $rhh;$y++){
      [System.Runtime.InteropServices.Marshal]::Copy($data, $y*$rw*4, [IntPtr]($bd.Scan0.ToInt64() + $y*$bd.Stride), $rw*4)
    }
    $bmp.UnlockBits($bd)
  }
  $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

function Vnc-Key($conn,[uint32]$ks,[byte]$down){ $m=New-Object byte[] 8; $m[0]=4; $m[1]=$down; $kb=[BitConverter]::GetBytes($ks); [array]::Reverse($kb); [array]::Copy($kb,0,$m,4,4); $conn.s.Write($m,0,8); $conn.s.Flush() }
function Vnc-Tap($conn,[uint32]$ks){ Vnc-Key $conn $ks 1; Start-Sleep -Milliseconds 50; Vnc-Key $conn $ks 0 }
$script:ShiftMap = @{ '!'='1';'@'='2';'#'='3';'$'='4';'%'='5';'^'='6';'&'='7';'*'='8';'('='9';')'='0';'_'='-';'+'='=';'{'='[';'}'=']';'|'='\';':'=';';'"'="'";'<'=',';'>'='.';'?'='/';'~'='`' }
# Type a string over VNC one key at a time. WC3 samples keyboard input once per
# render frame (~16-33ms), so if two characters are pressed within one frame the
# game can register them out of order -- the classic "-cheatmode" -> "-cehatmdoe"
# garble. Every press is therefore fully released and separated by more than a
# frame before the next begins, and a shifted key holds Shift around only that
# one press. $CharDelayMs raises the whole cadence further for a slow/busy guest.
function Vnc-TypeSmart($conn, [string]$text, [int]$CharDelayMs = 0){
  $hold = 45 + $CharDelayMs   # key held down long enough to span a frame
  $gap  = 55 + $CharDelayMs   # quiet gap before the next key -- keeps presses in separate frames
  foreach($ch in $text.ToCharArray()){
    $needShift = $false; $base = $ch
    if($ch -cmatch '[A-Z]'){ $needShift = $true; $base = [char]([int][char]$ch + 32) }
    elseif($script:ShiftMap.ContainsKey([string]$ch)){ $needShift = $true; $base = [char]$script:ShiftMap[[string]$ch] }
    $ks = [uint32][int][char]$base
    if($needShift){ Vnc-Key $conn 0xFFE1 1; Start-Sleep -Milliseconds 30 }
    Vnc-Key $conn $ks 1
    Start-Sleep -Milliseconds $hold
    Vnc-Key $conn $ks 0
    if($needShift){ Start-Sleep -Milliseconds 30; Vnc-Key $conn 0xFFE1 0 }
    Start-Sleep -Milliseconds $gap
  }
}
function Vnc-Pointer($conn, [int]$x, [int]$y, [byte]$mask){
  $m = New-Object byte[] 6
  $m[0] = 5; $m[1] = $mask
  $xb=[BitConverter]::GetBytes([uint16]$x); [array]::Reverse($xb); [array]::Copy($xb,0,$m,2,2)
  $yb=[BitConverter]::GetBytes([uint16]$y); [array]::Reverse($yb); [array]::Copy($yb,0,$m,4,2)
  $conn.s.Write($m,0,6); $conn.s.Flush()
}
function Vnc-Click($conn, [int]$x, [int]$y){
  Vnc-Pointer $conn $x $y 0; Start-Sleep -Milliseconds 80
  Vnc-Pointer $conn $x $y 1; Start-Sleep -Milliseconds 70
  Vnc-Pointer $conn $x $y 0; Start-Sleep -Milliseconds 80
}
function Vnc-DblClick($conn, [int]$x, [int]$y){
  # The two clicks must land on DIFFERENT rendered frames.
  #
  # WC3 samples the mouse once per frame and the guests are capped at 15 fps
  # (guestMaxFps in vms.json), so a frame is ~66ms. The gap here used to be
  # ~100ms press-to-press, which is only 1.5 frames: depending on where the
  # clicks fell relative to a frame boundary both could be consumed by the SAME
  # frame and register as a single click. The symptom was a double-click that
  # highlighted a folder without opening it -- intermittently, which is what
  # made it look like a swallowed click rather than a timing bug.
  #
  # ~220ms press-to-press is a comfortable 3+ frames apart while staying far
  # under Windows' 500ms double-click threshold.
  #
  # The MOVE needs its own frame too, for the same reason. With only 80ms of
  # settle the move and the first press could share a frame, so WC3 delivered
  # that press at the PREVIOUS cursor position and only the second one landed on
  # the target — a double-click arriving as a single click. The tell is a folder
  # row that ends up highlighted but never opens.
  Vnc-Pointer $conn $x $y 0; Start-Sleep -Milliseconds 200
  Vnc-Pointer $conn $x $y 1; Start-Sleep -Milliseconds 40; Vnc-Pointer $conn $x $y 0
  Start-Sleep -Milliseconds 180
  Vnc-Pointer $conn $x $y 1; Start-Sleep -Milliseconds 40; Vnc-Pointer $conn $x $y 0
  Start-Sleep -Milliseconds 80
}
