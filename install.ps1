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
    throw "Could not retrieve the latest GitHub Release. Details: $($_.Exception.Message)"
}

$Asset = $Release.assets |
    Where-Object { $_.name -match '^Hadex[ ._-]*Browser[ ._-]*Setup[ ._-].*\.exe$' } |
    Select-Object -First 1

if (-not $Asset) {
    throw "The latest Release does not contain a Hadex Browser Setup EXE asset. Release: $($Release.tag_name)"
}

$DownloadDirectory = Join-Path $env:TEMP "HadexSetup"
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
$InstallerPath = Join-Path $DownloadDirectory $Asset.name

Write-Host "Release: $($Release.tag_name)"
Write-Host "Downloading: $($Asset.name)"

try {
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $InstallerPath -UseBasicParsing
} catch {
    throw "Failed to download the Hadex installer. Details: $($_.Exception.Message)"
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "The installer download did not complete."
}

Write-Host "Starting the Hadex installer. Complete the sign-in steps in its window." -ForegroundColor Green
$Process = Start-Process -FilePath $InstallerPath -Wait -PassThru

if ($Process.ExitCode -ne 0) {
    throw "The installer exited with code $($Process.ExitCode)."
}

Write-Host "The installer process has finished." -ForegroundColor Green
Write-Host "The downloaded installer is intentionally retained at: $InstallerPath"
