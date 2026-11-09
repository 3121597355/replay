param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$port = if ($env:PORT) { [int]$env:PORT } else { 45211 }
$url = "http://127.0.0.1:$port"
function Get-Health {
    try { Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1 } catch { $null }
}
$health = Get-Health
if ($health -and !($health.features -contains 'srt-separation')) {
    throw 'This port is used by another service. Set PORT to an available port.'
}
if (!$health) {
    $bundledNode = Join-Path $PSScriptRoot 'tools\node.exe'
    $nodePath = if ($env:NODE_PATH_FOR_DOWNLOADER) { $env:NODE_PATH_FOR_DOWNLOADER } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
    foreach ($dependency in @(@('FFMPEG_PATH','ffmpeg.exe'), @('FFPROBE_PATH','ffprobe.exe'), @('YTDLP_PATH','yt-dlp.exe'))) {
        $bundledPath = Join-Path $PSScriptRoot ('tools\' + $dependency[1])
        if (!(Test-Path "Env:$($dependency[0])") -and (Test-Path -LiteralPath $bundledPath)) {
            [Environment]::SetEnvironmentVariable($dependency[0], $bundledPath, 'Process')
        }
    }
    $env:PORT = "$port"
    $logDirectory = Join-Path $PSScriptRoot 'data'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $service = Start-Process -FilePath $nodePath -WorkingDirectory $PSScriptRoot -ArgumentList @('server.mjs') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'service.log') -RedirectStandardError (Join-Path $logDirectory 'service-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 24 -and !$health; $attempt++) {
        Start-Sleep -Milliseconds 250
        $health = Get-Health
        if ($service.HasExited) { throw 'Downloader did not start. Check data/service-error.log.' }
    }
    if (!$health) { throw 'Downloader startup timed out.' }
}
if (!$NoOpen) {
    # The component runs in the background; its controls live on the website.
    Start-Process -FilePath 'https://www.replayen.com/download'
}
