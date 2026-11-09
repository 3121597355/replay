param(
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][string]$BuildRoot
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $sourceRoot)
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'component-dependencies.json') | ConvertFrom-Json
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$buildDirectory = [IO.Path]::GetFullPath($BuildRoot)
$packageName = "Replay-Download-Component-v$($manifest.componentVersion)-windows-x64"
$stage = Join-Path $buildDirectory $packageName
$archive = Join-Path $outputRoot ($packageName + '.zip')
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $archive)) { throw 'Choose fresh build/output paths; existing artifacts will not be overwritten.' }
New-Item -ItemType Directory -Path $buildDirectory,$outputRoot,$stage -Force | Out-Null
$cache = Join-Path $buildDirectory 'cache'
$tools = Join-Path $stage 'tools'
$licenses = Join-Path $stage 'licenses'
New-Item -ItemType Directory -Path $cache,$tools,$licenses -Force | Out-Null

function Get-VerifiedFile($entry, [string]$name) {
    if ($entry.sha256 -notmatch '^[a-f0-9]{64}$' -or !([uri]$entry.url).IsAbsoluteUri -or ([uri]$entry.url).Scheme -ne 'https') { throw 'Dependency must have an HTTPS source and SHA-256.' }
    $target = Join-Path $cache $name
    if (!(Test-Path -LiteralPath $target)) {
        Write-Output "Downloading $name from its pinned source"
        Invoke-WebRequest -Uri $entry.url -OutFile $target -TimeoutSec 300
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Checksum failed for $name. No unverified dependency will be packaged." }
    Write-Output "Verified $name"
    return $target
}

# Only known source files are included. Never enumerate personal data folders.
foreach ($directory in @('lib','public')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $directory) -Destination $stage -Recurse
}
foreach ($name in @('server.mjs','package.json','README.md','launch.ps1','start.bat','启动 Replay 下载组件.bat')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $stage 'LICENSE-Replay.txt')
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'separate-subtitles.mjs') -Destination (Join-Path $stage 'scripts')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'component-dependencies.json') -Destination (Join-Path $stage 'scripts')

$nodeZip = @(Get-VerifiedFile $manifest.node 'node.zip')[-1]
$ffmpegZip = @(Get-VerifiedFile $manifest.ffmpeg 'ffmpeg.zip')[-1]
$ytExe = @(Get-VerifiedFile $manifest.ytDlp 'yt-dlp.exe')[-1]
$ytLicense = @(Get-VerifiedFile $manifest.ytDlpLicense 'yt-dlp-LICENSE.txt')[-1]
$nodeUnpacked = Join-Path $buildDirectory 'node-unpacked'
$ffmpegUnpacked = Join-Path $buildDirectory 'ffmpeg-unpacked'
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeUnpacked
Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $ffmpegUnpacked
$nodeHome = Join-Path $nodeUnpacked "node-v$($manifest.node.version)-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeHome 'node.exe') -Destination $tools
Copy-Item -LiteralPath (Join-Path $nodeHome 'LICENSE') -Destination (Join-Path $licenses 'Node-LICENSE.txt')
$ffmpegHomes = @(Get-ChildItem -LiteralPath $ffmpegUnpacked -Directory)
if ($ffmpegHomes.Count -ne 1) { throw 'Unexpected FFmpeg archive layout.' }
$ffmpegHome = $ffmpegHomes[0].FullName
foreach ($binary in @('ffmpeg.exe','ffprobe.exe')) {
    Copy-Item -LiteralPath (Join-Path $ffmpegHome ('bin\' + $binary)) -Destination $tools
}
foreach ($notice in @(Get-ChildItem -LiteralPath $ffmpegHome -File | Where-Object { $_.Name -match '^(LICENSE|README)' })) {
    Copy-Item -LiteralPath $notice.FullName -Destination (Join-Path $licenses ('FFmpeg-' + $notice.Name))
}
Copy-Item -LiteralPath $ytExe -Destination $tools
Copy-Item -LiteralPath $ytLicense -Destination (Join-Path $licenses 'yt-dlp-LICENSE.txt')

# Running these CLI checks is part of verifying the downloaded component.
$nodeVersion = (& (Join-Path $tools 'node.exe') --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne "v$($manifest.node.version)") { throw 'Bundled Node version check failed.' }
$ffmpegVersion = (& (Join-Path $tools 'ffmpeg.exe') -version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or $ffmpegVersion -notmatch ([regex]::Escape($manifest.ffmpeg.version))) { throw 'Bundled FFmpeg version check failed.' }
& (Join-Path $tools 'ffprobe.exe') -version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Bundled FFprobe check failed.' }
$ytVersion = (& (Join-Path $tools 'yt-dlp.exe') --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $ytVersion -ne $manifest.ytDlp.version) { throw 'Bundled yt-dlp version check failed.' }
& (Join-Path $tools 'yt-dlp.exe') --print-licenses | Set-Content -LiteralPath (Join-Path $licenses 'yt-dlp-THIRD-PARTY-LICENSES.txt') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Cannot collect bundled yt-dlp dependency licenses.' }
$sourceCommit = (git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify component source commit.' }
[ordered]@{
    version=$manifest.componentVersion;sourceCommit=$sourceCommit
    source="https://github.com/3121597355/replay/tree/$sourceCommit/services/video-downloader"
    dependencies=$manifest
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'component-manifest.json') -Encoding utf8
@'
Replay 下载组件（Windows 10 / 11，64 位）

1. 解压全部文件，不能只打开 ZIP 里的启动脚本。
2. 双击「启动 Replay 下载组件.bat」。组件在后台运行，并打开 Replay 网站。
3. 在 https://www.replayen.com/download 粘贴链接，下载视频、分离字幕、导入学习。

只需下载一次。电脑重启后，再双击启动组件；不要移动已运行组件的文件夹。
Node.js、FFmpeg 和 yt-dlp 已随包提供，无需另装开发环境。
推荐最新版 Chrome / Edge。已有视频与字幕可直接导入网站，无需组件。
视频、字幕与下载记录留在当前文件夹内，不上传到 Replay 服务器。

开源代码与版本：见 component-manifest.json。
第三方工具的许可证和来源：见 licenses/ 与 scripts/component-dependencies.json。
'@ | Set-Content -LiteralPath (Join-Path $stage '先读我.txt') -Encoding utf8
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
$checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$checksum  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ascii
[pscustomobject]@{archive=$archive;stage=$stage;sha256=$checksum;bytes=(Get-Item -LiteralPath $archive).Length;sourceCommit=$sourceCommit} | ConvertTo-Json -Compress
