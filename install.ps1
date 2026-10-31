# WebFlix Desktop - Windows installer (WFX-DIST-1, the zcode-distribution
# parity: a one-liner that resolves the latest release, verifies its checksum,
# and runs the NSIS installer).
#
# One-liner (PowerShell):
#   irm https://raw.githubusercontent.com/payswapdotorg/webflix-desktop/main/install.ps1 | iex
#
# As a file (params bind; env vars work in both modes):
#   .\install.ps1 [-Version 3.14.3] [-DownloadOnly] [-Repo owner/name]
#
#   -Version X       install release vX instead of the latest (env WEBFLIX_VERSION)
#   -DownloadOnly    download + verify the installer without running it
#   -Repo owner/name the GitHub repository (env WEBFLIX_REPO;
#                    default payswapdotorg/webflix-desktop)
param(
  [string]$Version = "",
  [string]$Repo = "",
  [switch]$DownloadOnly
)

$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = $env:WEBFLIX_VERSION }
if (-not $Version) { $Version = "" }
if (-not $Repo) { $Repo = $env:WEBFLIX_REPO }
if (-not $Repo) { $Repo = "payswapdotorg/webflix-desktop" }

# PowerShell 5.1 defaults to TLS 1.0/1.2 off for some configurations; GitHub requires TLS 1.2+.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$ProgressPreference = "SilentlyContinue"  # Invoke-WebRequest progress is very slow

function Get-WebFlixRelease {
  param([string]$ReleaseRef)
  $uri = "https://api.github.com/repos/$Repo/releases/$ReleaseRef"
  Invoke-RestMethod -Uri $uri -Headers @{ "User-Agent" = "webflix-install" }
}

if ($Version) {
  $tag = if ($Version -match "^v") { $Version } else { "v$Version" }
  $release = Get-WebFlixRelease -ReleaseRef "tags/$tag"
} else {
  $release = Get-WebFlixRelease -ReleaseRef "latest"
}
if (-not $release -or -not $release.assets) {
  throw "WebFlix install: no release assets found at $Repo ($($release.tag_name))."
}

$installerAsset = @($release.assets | Where-Object { $_.name -like "WebFlix-*-win-*.exe" -and $_.name -notlike "*.sha256" }) |
  Select-Object -First 1
if (-not $installerAsset) {
  throw "WebFlix install: release $($release.tag_name) carries no Windows installer (WebFlix-*-win-*.exe)."
}
$sidecarAsset = @($release.assets | Where-Object { $_.name -eq "$($installerAsset.name).sha256" }) | Select-Object -First 1
if (-not $sidecarAsset) {
  throw "WebFlix install: release $($release.tag_name) is missing the .sha256 sidecar for $($installerAsset.name)."
}

Write-Host "WebFlix: installing release $($release.tag_name)"
$dir = Join-Path $env:TEMP "webflix-install"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$installerPath = Join-Path $dir $installerAsset.name
$sidecarPath = Join-Path $dir $sidecarAsset.name

Invoke-WebRequest -Uri $installerAsset.browser_download_url -OutFile $installerPath
Invoke-WebRequest -Uri $sidecarAsset.browser_download_url -OutFile $sidecarPath

# Verify the SHA-256 against the sidecar (sidecar format: "<hash>  <name>").
$expected = ((Get-Content $sidecarPath -Raw) -split "\s+")[0].Trim().ToLower()
$actual = (Get-FileHash -Algorithm SHA256 $installerPath).Hash.ToLower()
if ($actual -ne $expected) {
  throw "WebFlix install: checksum verification FAILED for $($installerAsset.name).`nExpected: $expected`nActual:   $actual"
}
Write-Host "WebFlix: checksum verified ($($actual.Substring(0, 16))…)"

if ($DownloadOnly) {
  Write-Host "WebFlix: installer saved to $installerPath (-DownloadOnly: not launched)."
} else {
  Write-Host "WebFlix: launching the installer…"
  Start-Process -FilePath $installerPath -Wait
  Write-Host ""
  Write-Host "WebFlix $($release.tag_name) installed."
  Write-Host "Launch it from the Start menu (WebFlix), or run: webflix"
}
