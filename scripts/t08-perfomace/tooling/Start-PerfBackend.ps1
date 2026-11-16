[CmdletBinding()]
param(
    [string]$DatabaseName = "veiltalk_perf",
    [ValidateRange(1024, 65535)][int]$Port = 8081,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$containerName = "veiltalk-perf-backend"

if ($DatabaseName -notmatch '^veiltalk_perf(?:_[a-z0-9_]+)?$') {
    throw "The performance backend may only use a database named veiltalk_perf*."
}

Push-Location $repositoryRoot
try {
    docker compose up -d postgres redis minio | Out-Host
    if ($Rebuild) { docker compose build backend | Out-Host }

    $existingLookup = docker ps -aq --filter "name=^/$containerName$"
    $existing = if ($null -eq $existingLookup) { "" } else { $existingLookup.Trim() }
    if ($existing) {
        Write-Host "Replacing the previous isolated performance backend container..."
        docker rm -f $containerName | Out-Host
    }

    $containerId = (docker compose run -d --name $containerName --no-deps `
        -p "127.0.0.1:${Port}:8080" `
        -e "DB_NAME=$DatabaseName" `
        backend).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Could not start the performance backend." }

    $healthUrl = "http://127.0.0.1:$Port/actuator/health"
    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 750
        $running = (docker inspect -f '{{.State.Running}}' $containerName 2>$null) -eq "true"
        if (-not $running) {
            docker logs --tail 80 $containerName | Out-Host
            throw "Performance backend exited before becoming healthy."
        }
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
            if ($health.status -eq "UP") {
                Write-Host "Performance backend is ready: http://127.0.0.1:$Port"
                Write-Host "Container: $containerName"
                return
            }
        } catch { }
    } while ((Get-Date) -lt $deadline)

    docker logs --tail 80 $containerName | Out-Host
    throw "Performance backend did not become healthy within 90 seconds."
}
finally { Pop-Location }
