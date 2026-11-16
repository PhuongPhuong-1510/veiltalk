$ErrorActionPreference = "Stop"
$containerName = "veiltalk-perf-backend"
$existingLookup = docker ps -aq --filter "name=^/$containerName$"
$existing = if ($null -eq $existingLookup) { "" } else { $existingLookup.Trim() }
if ($existing) {
    docker rm -f $containerName | Out-Host
    Write-Host "Stopped isolated performance backend."
} else {
    Write-Host "Performance backend is not running."
}
