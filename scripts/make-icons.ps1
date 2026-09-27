# Redraws Axon's app icon (build/icon.png + build/icon.ico) from the same node-graph mark used by
# the tray and notification icons (src/main/shell/icon.ts), instead of a mismatched stock image.
# Also emits a base64 PNG for embedding as the BrowserWindow icon (packaged builds ship only `out/`,
# so a filesystem path to build/icon.png would not resolve at runtime).
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot

# Sample the tile's background and mark colours from the tray icon already embedded in the app,
# so every rendering of the Axon mark (tray, notifications, window, installer) matches exactly.
$iconTs = Get-Content (Join-Path $repoRoot 'src\main\shell\icon.ts') -Raw
$b64 = [regex]::Match($iconTs, "NOTICE_ICON =\s*\r?\n\s*'data:image/png;base64,([^']+)'").Groups[1].Value
$refBytes = [Convert]::FromBase64String($b64)
$refStream = New-Object System.IO.MemoryStream(,$refBytes)
$refImg = [System.Drawing.Bitmap]::FromStream($refStream)
$bg = $refImg.GetPixel(2, [int]($refImg.Height / 2))
$fg = $refImg.GetPixel([int]($refImg.Width / 2), [int]($refImg.Height / 2))
$refImg.Dispose()
$refStream.Dispose()

function New-AxonTile([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded-square tile, same corner radius as the existing tray/notification icon.
    $radius = $size * 0.22
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillPath($bgBrush, $path)

    # The Axon node-graph mark, at the same relative geometry as the renderer's <AxonLogo> (viewBox
    # 0 0 32 32): a centre node joined to four corner nodes.
    $scale = ($size * 0.72) / 32.0
    $offset = ($size - 32 * $scale) / 2.0
    $pt = { param($x, $y) [System.Drawing.PointF]::new($offset + $x * $scale, $offset + $y * $scale) }
    $nodes = @(@(8, 8), @(24, 10), @(8, 24), @(24, 22))
    $center = & $pt 16 16

    $penWidth = [single](3.5 * $scale)
    $fgPen = New-Object -TypeName System.Drawing.Pen -ArgumentList @($fg, $penWidth)
    $fgPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $fgPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    foreach ($n in $nodes) {
        $p = & $pt $n[0] $n[1]
        $g.DrawLine($fgPen, $center, $p)
    }
    $fgBrush = New-Object System.Drawing.SolidBrush($fg)
    foreach ($n in $nodes) {
        $p = & $pt $n[0] $n[1]
        $r = 3.5 * $scale
        $g.FillEllipse($fgBrush, $p.X - $r, $p.Y - $r, 2 * $r, 2 * $r)
    }
    $r = 3.0 * $scale
    $g.FillEllipse($fgBrush, $center.X - $r, $center.Y - $r, 2 * $r, 2 * $r)

    $g.Dispose()
    return $bmp
}

$buildDir = Join-Path $repoRoot 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$tile256 = New-AxonTile 256
$tile256.Save((Join-Path $buildDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$tile256.Dispose()

# .ico for the Windows exe/installer, built by electron-builder from build/icon.ico.
$sizes = @(256, 128, 64, 48, 32, 16)
$pngStreams = [System.Collections.Generic.List[byte[]]]::new()
foreach ($s in $sizes) {
    $tile = New-AxonTile $s
    $ms = New-Object System.IO.MemoryStream
    $tile.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams.Add($ms.ToArray())
    $tile.Dispose()
    $ms.Dispose()
}

$icoFile = Join-Path $buildDir 'icon.ico'
$fs = [System.IO.File]::Create($icoFile)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $w = if ($s -eq 256) { [byte]0 } else { [byte]$s }
    $h = if ($s -eq 256) { [byte]0 } else { [byte]$s }
    $bytes = $pngStreams[$i]
    $bw.Write($w)
    $bw.Write($h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $bytes.Length
}
for ($i = 0; $i -lt $sizes.Count; $i++) {
    [byte[]]$bytes = $pngStreams[$i]
    $bw.Write($bytes, 0, $bytes.Length)
}
$bw.Close()
$fs.Close()
Write-Output "Generated build\icon.ico ($((Get-Item $icoFile).Length) bytes)"

# 128px base64 PNG for the BrowserWindow's own `icon:` option, embedded the same way as the tray
# icon since the packaged app does not ship the build/ directory.
$tile128 = New-AxonTile 128
$ms128 = New-Object System.IO.MemoryStream
$tile128.Save($ms128, [System.Drawing.Imaging.ImageFormat]::Png)
$tile128.Dispose()
$windowIconBase64 = [Convert]::ToBase64String($ms128.ToArray())
$ms128.Dispose()
$outFile = Join-Path $repoRoot 'scripts\_window-icon-base64.txt'
Set-Content -Path $outFile -Value $windowIconBase64 -NoNewline
Write-Output "Wrote $outFile ($($windowIconBase64.Length) chars) - paste into src/main/shell/icon.ts as WINDOW_ICON"
