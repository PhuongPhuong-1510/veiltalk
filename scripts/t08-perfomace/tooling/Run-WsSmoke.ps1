[CmdletBinding()]
param(
    [string]$HttpBaseUrl = "http://127.0.0.1:8081",
    [string]$DockerWsUrl = "ws://host.docker.internal:8081/ws/messaging",
    [Parameter(Mandatory = $true)][string]$RunId,
    [string]$Password = "PerfTest123!",
    [ValidateRange(1, 3)][int]$VirtualUsers = 1,
    [ValidateRange(1000, 60000)][int]$HoldMilliseconds = 5000
)

$ErrorActionPreference = "Stop"
if ($RunId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid RunId." }
$email = "perf+$RunId+000000001@example.test"
$loginBody = @{ email = $email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$HttpBaseUrl/auth/login" -ContentType "application/json" -Body $loginBody
$accessToken = $login.tokens.access_token
if (-not $accessToken) { throw "Login did not return an access token." }

$mountPath = $PSScriptRoot.Replace('\', '/')
docker run --rm -i -v "${mountPath}:/scripts:ro" `
    -e "WS_URL=$DockerWsUrl" -e "ACCESS_TOKEN=$accessToken" `
    -e "VUS=$VirtualUsers" -e "ITERATIONS=$VirtualUsers" -e "HOLD_MS=$HoldMilliseconds" `
    grafana/k6:latest run /scripts/ws-smoke.js
if ($LASTEXITCODE -ne 0) { throw "WebSocket smoke test failed." }
