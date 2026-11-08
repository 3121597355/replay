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
    $nodePath = if ($env:NODE_PATH_FOR_DOWNLOADER) { $env:NODE_PATH_FOR_DOWNLOADER } else { (Get-Command node -ErrorAction Stop).Source }
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
# The person invoking this launcher explicitly opens the interactive tool.
Start-Process -FilePath $url
