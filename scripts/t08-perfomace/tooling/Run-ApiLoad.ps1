[CmdletBinding()]
param(
    [string]$BaseUrl = "http://host.docker.internal:8081",
    [Parameter(Mandatory = $true)][string]$RunId,
    [string]$Password = "PerfTest123!",
    [ValidateRange(1, 10000)][int]$VirtualUsers = 10,
    [string]$Duration = "30s"
)

$ErrorActionPreference = "Stop"
if ($RunId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid RunId." }
$email = "perf+$RunId+000000001@example.test"
$scriptPath = Join-Path $PSScriptRoot "api-load.js"

if (Get-Command k6 -ErrorAction SilentlyContinue) {
    & k6 run -e "BASE_URL=$($BaseUrl.Replace('host.docker.internal', '127.0.0.1'))" -e "TEST_EMAIL=$email" -e "TEST_PASSWORD=$Password" -e "VUS=$VirtualUsers" -e "DURATION=$Duration" $scriptPath
} else {
    $mountPath = $PSScriptRoot.Replace('\', '/')
    docker run --rm -i -v "${mountPath}:/scripts:ro" `
        -e "BASE_URL=$BaseUrl" -e "TEST_EMAIL=$email" -e "TEST_PASSWORD=$Password" `
        -e "VUS=$VirtualUsers" -e "DURATION=$Duration" `
        grafana/k6:latest run /scripts/api-load.js
}
if ($LASTEXITCODE -ne 0) { throw "k6 load test failed or a configured threshold was exceeded." }
