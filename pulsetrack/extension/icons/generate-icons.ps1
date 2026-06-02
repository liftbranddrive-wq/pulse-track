# Generates crisp brown/cream clock icons for Chrome (16, 48, 128)
Add-Type -AssemblyName System.Drawing

function Draw-ClockIcon([int]$size, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

  $pad = [math]::Max(1, [int]($size * 0.06))
  $r = [int](($size - $pad * 2) / 2)
  $cx = [int]($size / 2)
  $cy = [int]($size / 2)

  $brown = [System.Drawing.Color]::FromArgb(255, 61, 43, 31)
  $cream = [System.Drawing.Color]::FromArgb(255, 250, 247, 242)
  $gold = [System.Drawing.Color]::FromArgb(255, 201, 162, 39)

  # Rounded square background
  $bgRect = New-Object System.Drawing.Rectangle $pad, $pad, ($size - $pad * 2), ($size - $pad * 2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $radius = [int]($size * 0.22)
  $path.AddArc($bgRect.X, $bgRect.Y, $radius, $radius, 180, 90)
  $path.AddArc($bgRect.Right - $radius, $bgRect.Y, $radius, $radius, 270, 90)
  $path.AddArc($bgRect.Right - $radius, $bgRect.Bottom - $radius, $radius, $radius, 0, 90)
  $path.AddArc($bgRect.X, $bgRect.Bottom - $radius, $radius, $radius, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $brown), $path)

  # Clock face
  $faceR = [int]($r * 0.78)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $cream), ($cx - $faceR), ($cy - $faceR), ($faceR * 2), ($faceR * 2))
  $pen = New-Object System.Drawing.Pen $brown, ([math]::Max(1, $size / 32))
  $g.DrawEllipse($pen, ($cx - $faceR), ($cy - $faceR), ($faceR * 2), ($faceR * 2))

  # Hour hand ~10 o'clock
  $hourLen = $faceR * 0.42
  $hourAngle = -60 * [Math]::PI / 180
  $hx = $cx + $hourLen * [Math]::Cos($hourAngle)
  $hy = $cy + $hourLen * [Math]::Sin($hourAngle)
  $g.DrawLine((New-Object System.Drawing.Pen $brown, ([math]::Max(2, $size / 18))), $cx, $cy, $hx, $hy)

  # Minute hand ~2 o'clock
  $minLen = $faceR * 0.58
  $minAngle = 30 * [Math]::PI / 180
  $mx = $cx + $minLen * [Math]::Cos($minAngle)
  $my = $cy + $minLen * [Math]::Sin($minAngle)
  $g.DrawLine((New-Object System.Drawing.Pen $brown, ([math]::Max(1.5, $size / 24))), $cx, $cy, $mx, $my)

  # Center dot
  $dot = [math]::Max(2, [int]($size / 14))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $gold), ($cx - $dot / 2), ($cy - $dot / 2), $dot, $dot)

  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $pen.Dispose()
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Draw-ClockIcon 128 (Join-Path $dir 'icon128.png')
Draw-ClockIcon 48 (Join-Path $dir 'icon48.png')
Draw-ClockIcon 16 (Join-Path $dir 'icon16.png')
Write-Host 'Icons written to' $dir
