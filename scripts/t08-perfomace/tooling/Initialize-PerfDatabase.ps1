[CmdletBinding()]
param(
    [string]$DatabaseName = "veiltalk_perf",
    [string]$RunId = (Get-Date -Format "yyyyMMdd_HHmmss"),
    [ValidateRange(2, 5000000)][int]$Users = 1000,
    [ValidateRange(0, 4999999)][int]$Conversations = 500,
    [ValidateRange(0, 10000)][int]$MessagesPerConversation = 20,
    [ValidateRange(0, 1000000)][int]$Videos = 100,
    [string]$LoadPassword = "PerfTest123!",
    [switch]$ResetDatabase
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$toolingRoot = $PSScriptRoot
$repositoryRoot = (Resolve-Path (Join-Path $toolingRoot "..\..\..")).Path

if ($DatabaseName -notmatch '^veiltalk_perf(?:_[a-z0-9_]+)?$') {
    throw "DatabaseName must start with 'veiltalk_perf'. Refusing to touch '$DatabaseName'."
}
if ($RunId -notmatch '^[A-Za-z0-9_-]{1,64}$') {
    throw "RunId may contain only letters, numbers, underscore and hyphen (max 64 characters)."
}
if ($Conversations -gt ($Users - 1)) {
    throw "Conversations ($Conversations) cannot exceed Users - 1 ($($Users - 1))."
}
$messageCount = [int64]$Conversations * [int64]$MessagesPerConversation
if ($messageCount -gt 100000000) {
    throw "This run would create $messageCount messages. The safety limit is 100,000,000."
}

function Get-DotEnvValue([string]$Name) {
    $line = Get-Content (Join-Path $repositoryRoot ".env") |
        Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
        Select-Object -First 1
    if (-not $line) { throw "Missing $Name in .env" }
    return ($line -split '=', 2)[1].Trim()
}

$dbUser = Get-DotEnvValue "POSTGRES_USER"
Push-Location $repositoryRoot
try {
    docker compose up -d postgres | Out-Host
    $postgresContainer = (docker compose ps -q postgres).Trim()
    if (-not $postgresContainer) { throw "PostgreSQL container is not running." }

    $readyDeadline = (Get-Date).AddSeconds(30)
    do {
        docker exec $postgresContainer pg_isready -U $dbUser -d postgres *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $readyDeadline)
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL did not become ready within 30 seconds." }

    $databaseLookup = docker exec $postgresContainer psql -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
    $databaseExists = $null -ne $databaseLookup -and $databaseLookup.Trim() -eq "1"
    if ($ResetDatabase -and $databaseExists) {
        Write-Host "Resetting isolated performance database '$DatabaseName'..."
        docker exec $postgresContainer dropdb -U $dbUser --force $DatabaseName
        if ($LASTEXITCODE -ne 0) { throw "Could not drop $DatabaseName." }
        $databaseExists = $false
    }

    if (-not $databaseExists) {
        Write-Host "Creating isolated performance database '$DatabaseName'..."
        docker exec $postgresContainer createdb -U $dbUser $DatabaseName
        if ($LASTEXITCODE -ne 0) { throw "Could not create $DatabaseName." }

        Write-Host "Cloning the current VeilTalk schema without application data..."
        docker exec $postgresContainer pg_dump -U $dbUser -d veiltalk --schema-only --no-owner --no-privileges |
            docker exec -i $postgresContainer psql -X -v ON_ERROR_STOP=1 -U $dbUser -d $DatabaseName
        if ($LASTEXITCODE -ne 0) { throw "Could not initialize schema in $DatabaseName." }

        Write-Host "Copying Flyway migration history..."
        docker exec $postgresContainer pg_dump -U $dbUser -d veiltalk --data-only --table=public.flyway_schema_history --no-owner --no-privileges |
            docker exec -i $postgresContainer psql -X -v ON_ERROR_STOP=1 -U $dbUser -d $DatabaseName
        if ($LASTEXITCODE -ne 0) { throw "Could not copy Flyway migration history into $DatabaseName." }
    }

    $estimatedMiB = [math]::Ceiling(($Users * 700 + $Conversations * 350 + $messageCount * 500 + $Videos * 500) / 1MB)
    Write-Host "Seeding run '$RunId': $Users users, $Conversations conversations, $messageCount messages, $Videos videos (rough estimate: $estimatedMiB MiB before index overhead)."

    Get-Content (Join-Path $toolingRoot "seed.sql") -Raw |
        docker exec -i $postgresContainer psql -X -v ON_ERROR_STOP=1 `
            -v "run_id=$RunId" `
            -v "user_count=$Users" `
            -v "conversation_count=$Conversations" `
            -v "messages_per_conversation=$MessagesPerConversation" `
            -v "video_count=$Videos" `
            -v "load_password=$LoadPassword" `
            -U $dbUser -d $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw "Seed failed. PostgreSQL rolled back the run transaction." }

    Write-Host "Seed complete. Primary API account: perf+$RunId+000000001@example.test"
    Write-Host "Password: $LoadPassword"
    Write-Host "Database: $DatabaseName"
}
finally {
    Pop-Location
}
