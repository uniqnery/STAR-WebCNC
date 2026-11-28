$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'packages\web\public\star.png'
$outputPath = Join-Path $root 'packages\web\public\icons'
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$source = [Drawing.Bitmap]::FromFile($sourcePath)
try {
    if ($source.GetPixel(0, 0).A -ne 0) { throw 'Expected transparent source logo background' }
    foreach ($size in @(32, 180, 192, 512)) {
        $bitmap = New-Object Drawing.Bitmap($size, $size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $attributes = New-Object Drawing.Imaging.ImageAttributes
        try {
            $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#1f2937'))
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            # Same white silhouette as the sidebar's brightness(0) invert(1).
            $matrix = New-Object Drawing.Imaging.ColorMatrix
            $matrix.Matrix00 = 0; $matrix.Matrix11 = 0; $matrix.Matrix22 = 0
            $matrix.Matrix40 = 1; $matrix.Matrix41 = 1; $matrix.Matrix42 = 1
            $attributes.SetColorMatrix($matrix)
            # Keep the complete wordmark inside the circular maskable safe area.
            $width = [int][Math]::Round($size * 0.72)
            $height = [int][Math]::Round($width * $source.Height / $source.Width)
            $rect = New-Object Drawing.Rectangle([int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
            $graphics.DrawImage($source, $rect, 0, 0, $source.Width, $source.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
            $target = Join-Path $outputPath "star-$size.png"
            $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png)
            Write-Output "Built star-$size.png ($size x $size)"
        } finally { $attributes.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $source.Dispose() }
