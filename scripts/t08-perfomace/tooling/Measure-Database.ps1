[CmdletBinding()]
param(
    [string]$DatabaseName = "veiltalk_perf",
    [Parameter(Mandatory = $true)][string]$RunId
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
if ($DatabaseName -notmatch '^veiltalk_perf(?:_[a-z0-9_]+)?$') { throw "Refusing to benchmark a non-performance database." }
if ($RunId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid RunId." }
$dbUser = ((Get-Content (Join-Path $repositoryRoot ".env") | Where-Object { $_ -match '^POSTGRES_USER=' } | Select-Object -First 1) -split '=', 2)[1].Trim()
$hubEmail = "perf+$RunId+000000001@example.test"

Push-Location $repositoryRoot
try {
    $postgresContainer = (docker compose ps -q postgres).Trim()
    if (-not $postgresContainer) { throw "PostgreSQL container is not running." }
    Get-Content (Join-Path $PSScriptRoot "benchmark.sql") -Raw |
        docker exec -i $postgresContainer psql -X -v ON_ERROR_STOP=1 -v "run_id=$RunId" -v "hub_email=$hubEmail" -U $dbUser -d $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw "Database benchmark failed." }
}
finally { Pop-Location }
