# Hadex one-command installer bootstrapper
# Downloads the latest public GitHub Release and starts its Windows installer.
# Temporary installer files are intentionally retained; no cleanup is performed.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repository = "hadilaptop/hadex-setup-bootstrapper2"
$ReleaseApi = "https://api.github.com/repos/$Repository/releases/latest"
$Headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "Hadex-Setup-Bootstrapper"
}

Write-Host "Downloading the latest Hadex installer..." -ForegroundColor Cyan

try {
    $Release = Invoke-RestMethod -Uri $ReleaseApi -Headers $Headers -Method Get
} catch {
    throw "No published GitHub Release is available yet. Publish a Release containing the Hadex installer EXE first. Details: $($_.Exception.Message)"
}

$Asset = $Release.assets |
    Where-Object { $_.name -match '^Hadex Browser Setup .*\.exe$' } |
    Select-Object -First 1

if (-not $Asset) {
    throw "The latest Release does not contain a Hadex Browser Setup EXE asset."
}

$DownloadDirectory = Join-Path $env:TEMP "HadexSetup"
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
$InstallerPath = Join-Path $DownloadDirectory $Asset.name

Write-Host "Release: $($Release.tag_name)"
Write-Host "Downloading: $($Asset.name)"

Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $InstallerPath -UseBasicParsing

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "The installer download did not complete."
}

if ($Asset.digest -and $Asset.digest -match '^sha256:(.+)$') {
    $ExpectedHash = $Matches[1].ToLowerInvariant()
    $ActualHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) {
        throw "SHA256 verification failed. The installer will not be started."
    }
    Write-Host "SHA256 verification succeeded." -ForegroundColor Green
} else {
    Write-Warning "The Release did not provide a SHA256 digest. The installer was downloaded from the official GitHub Release asset URL."
}

Write-Host "Starting the Hadex installer. Complete the sign-in steps in its window." -ForegroundColor Green
$Process = Start-Process -FilePath $InstallerPath -Wait -PassThru

if ($Process.ExitCode -ne 0) {
    throw "The installer exited with code $($Process.ExitCode)."
}

Write-Host "The installer process has finished." -ForegroundColor Green
Write-Host "The downloaded installer is intentionally retained at: $InstallerPath"
