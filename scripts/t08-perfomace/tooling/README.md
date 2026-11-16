# VeilTalk performance data and load tooling

This tooling uses an isolated PostgreSQL database whose name must start with
`veiltalk_perf`. It refuses to seed, clean, or benchmark the normal `veiltalk`
database.

Run all commands from the repository root in PowerShell. This machine blocks
local PowerShell scripts by default, so the examples use an execution-policy
bypass for the current process only.

## 1. Create and seed an isolated database

Small local dataset:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Initialize-PerfDatabase.ps1 `
  -ResetDatabase -RunId local_01 -Users 10000 -Conversations 5000 `
  -MessagesPerConversation 20 -Videos 500
```

One million message dataset:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Initialize-PerfDatabase.ps1 `
  -ResetDatabase -RunId million_messages -Users 100001 -Conversations 100000 `
  -MessagesPerConversation 10 -Videos 500
```

The default password for generated accounts is `PerfTest123!`. The main API
account is printed after seeding and follows this pattern:

```text
perf+<run_id>+000000001@example.test
```

Do not use a million-user seed as the first run. Start with the small profile,
observe disk/RAM, then increase cardinality. A run is inserted transactionally;
if SQL fails, that run is rolled back.

## 2. Inspect PostgreSQL query plans

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Measure-Database.ps1 `
  -RunId local_01
```

The command prints database cardinality and `EXPLAIN (ANALYZE, BUFFERS)` for
conversation list and message history queries.

## 3. Start the isolated backend

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Start-PerfBackend.ps1
```

This starts `veiltalk-perf-backend` on `http://127.0.0.1:8081`. It shares the
local Redis and MinIO services but reads PostgreSQL data only from
`veiltalk_perf`.

Stop it with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Stop-PerfBackend.ps1
```

## 4. Run an API load test

The runner uses local k6 when installed and otherwise runs `grafana/k6` through
Docker. Thresholds come from `docs/10_PERFORMANCE.md`.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Run-ApiLoad.ps1 `
  -RunId local_01 -VirtualUsers 50 -Duration 2m
```

The workload reads conversations, message history, the avatar catalog, and
sends a message every ten iterations. Begin with 2 to 10 virtual users before
raising concurrency.

## 5. Verify the messaging WebSocket

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Run-WsSmoke.ps1 `
  -RunId local_01 -VirtualUsers 1
```

The server intentionally limits concurrent WebSockets per account, so this
smoke runner permits at most three VUs. A large WebSocket test needs independent
accounts and tokens rather than reusing one identity.

## 6. Remove one seed run

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/t08-perfomace/tooling/Remove-PerfSeed.ps1 `
  -RunId local_01
```

Cleanup deletes only rows associated with the exact performance run in a
database named `veiltalk_perf*`. `-ResetDatabase` is faster when replacing an
entire large dataset.
