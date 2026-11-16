# T06 security tests

Run from the repository root:

```powershell
node scripts/t06-seciurity/run.cjs
```

Run the complete automated pack (main, abuse, quota, multipart, expiry,
remaining deployment gates, supply-chain checks and combined report) with one command:

```powershell
node scripts/t06-seciurity/run-all.cjs
```

`SUPPLY-001` requires an NVD API key. Set `NVD_API_KEY` in the current shell
before `run-all.cjs` to execute that Java SCA gate; without it the case is
reported as skipped/NOT RUN rather than PASS. Do not paste the key into source,
logs or command arguments.

Run the auth abuse policy cases on a separate disposable stack with the production thresholds:

```powershell
$env:T06_ABUSE_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_ABUSE_MODE
```

Run the actual-byte quota boundary on its own disposable stack (quota 10 MiB + 30 bytes):

```powershell
$env:T06_QUOTA_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_QUOTA_MODE
```

Run the three-session multipart admission and expiry cleanup case on a disposable stack with an accelerated 8-second TTL:

```powershell
$env:T06_MULTIPART_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_MULTIPART_MODE
```

Run the presigned PUT and GET expiry case with three-second URLs:

```powershell
$env:T06_EXPIRY_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_EXPIRY_MODE
```

Run the remaining local assertions and production-dependent probes. Missing
production inputs are reported as skipped/NOT RUN; known security gaps are
reported as REVIEW_REQUIRED:

```powershell
$env:T06_REMAINING_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_REMAINING_MODE
```

Optional production inputs for that mode are `T06_PUBLIC_BASE_URL`,
`T06_PUBLIC_FRONTEND_URL`, `T06_RELEASE_IMAGES`, `T06_SECRET_SENTINELS`,
`T06_LOG_RETENTION_DAYS`, and `T06_LOG_RETENTION_ROOT`. `SUPPLY-004` also
requires `T06_TRIVY_IMAGE` pinned by sha256 after all release images have been
pinned. Never use production secrets as sentinels.

This writes `results/abuse` and leaves `results/latest` for the main security pack. The E2E profile raises the auth limits for T04/T05 fixtures that register many accounts on loopback; abuse mode overrides them to 5/30. Production defaults remain 5/30.

To run the current T05 scenarios as a regression gate without modifying T05 reports:

```powershell
$env:T06_REGRESSION_MODE='1'; node scripts/t06-seciurity/run.cjs; Remove-Item Env:T06_REGRESSION_MODE
```

Run the independent signaling production dependency audit (requires npm registry access):

```powershell
node scripts/t06-seciurity/run-supply.cjs
node scripts/t06-seciurity/write-combined.cjs
```

Output goes to `results/regression` and is not counted as T06 PASS. The regression XML records the executed tests; it does not establish the separate T05 environment cases.

The runner builds the current backend and starts disposable PostgreSQL, Redis and MinIO containers plus the current backend and signaling processes. It writes JUnit XML, sanitized service logs, a run manifest and a 206-case status table under `results/latest`. Docker, Java 21, Maven, Node.js, `ffprobe` in PATH and installed signaling dependencies are required. The media fixture is a decodable VP8/WebM stream in `scripts/t04-api/fixtures/valid.webm` padded to satisfy S3 multipart's 5 MiB nonfinal part minimum.

The main pack executes the case IDs named in the test files. `write-combined.cjs` merges its report with all separate modes. Each of the 206 specification IDs receives one status: `PASS` only after its assertions run successfully, `REVIEW_REQUIRED` for a failed assertion, `NEEDS_CONTRACT` for an open policy decision, or `NOT RUN` otherwise. A passing count is not a system-wide security coverage claim. Production-dependent probes remain NOT RUN until their explicit inputs are supplied.

BOLA-009 follows the owner's 2026-10-19 decision: a nonowner must be denied entirely by `GET /videos/{id}`.
