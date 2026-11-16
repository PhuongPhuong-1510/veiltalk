[CmdletBinding()]
param(
    [string]$DatabaseName = "veiltalk_perf",
    [Parameter(Mandatory = $true)][string]$RunId
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

if ($DatabaseName -notmatch '^veiltalk_perf(?:_[a-z0-9_]+)?$') {
    throw "Refusing cleanup outside a database named veiltalk_perf*."
}
if ($RunId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid RunId." }

$dbUserLine = Get-Content (Join-Path $repositoryRoot ".env") |
    Where-Object { $_ -match '^POSTGRES_USER=' } | Select-Object -First 1
$dbUser = ($dbUserLine -split '=', 2)[1].Trim()

Push-Location $repositoryRoot
try {
    $postgresContainer = (docker compose ps -q postgres).Trim()
    if (-not $postgresContainer) { throw "PostgreSQL container is not running." }
    Get-Content (Join-Path $PSScriptRoot "cleanup.sql") -Raw |
        docker exec -i $postgresContainer psql -X -v ON_ERROR_STOP=1 -v "run_id=$RunId" -U $dbUser -d $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw "Cleanup failed and was rolled back." }
}
finally { Pop-Location }
