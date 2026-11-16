// Real-process functional tests. Own disposable containers only; never use .env.
const { spawn, execFileSync } = require('node:child_process');
const { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, existsSync, unlinkSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const net = require('node:net');
const { snapshotDev } = require('../t05-e2e/dev-snapshot.cjs');

const root = resolve(__dirname, '../..');
const abuseMode = process.env.T06_ABUSE_MODE === '1';
const regressionMode = process.env.T06_REGRESSION_MODE === '1';
const quotaMode = process.env.T06_QUOTA_MODE === '1';
const multipartMode = process.env.T06_MULTIPART_MODE === '1';
const expiryMode = process.env.T06_EXPIRY_MODE === '1';
const remainingMode = process.env.T06_REMAINING_MODE === '1';
if ([abuseMode, regressionMode, quotaMode, multipartMode, expiryMode, remainingMode].filter(Boolean).length > 1) throw new Error('Choose one T06 runner mode');
const runName = process.env.T06_RUN_NAME || (abuseMode ? 'abuse' : regressionMode ? 'regression' : quotaMode ? 'quota' : multipartMode ? 'multipart' : expiryMode ? 'expiry' : remainingMode ? 'remaining' : 'latest');
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runName)) throw new Error('Invalid T06_RUN_NAME');
const report = resolve(root, 'scripts/t06-seciurity/results', runName);
mkdirSync(report, { recursive: true });
for (const generated of ['build.log', 'backend.log', 'signaling.log', 'results.xml', 'run.json', 'RESULTS.md']) {
  const path = resolve(report, generated);
  if (existsSync(path)) unlinkSync(path);
}
const runId = `veiltalk-e2e-${Date.now()}-${randomBytes(3).toString('hex')}`;
const containers = [];
const children = [];
const runtimeSecrets = new Set();
let preexistingContainers = [];
let devBaseline;
const delay = ms => new Promise(r => setTimeout(r, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim();
async function until(label, check, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* retry readiness only */ }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${label}; inspect scripts/t06-seciurity/results/latest logs`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}
function start(command, args, env, filename) {
  const fd = openSync(resolve(report, filename), 'w');
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], windowsHide: true });
  closeSync(fd);
  child.on('error', error => { child.launchError = error; });
  children.push(child);
  return child;
}
async function finish(child) {
  if (child.launchError) throw child.launchError;
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((ok, no) => { child.once('error', no); child.once('exit', code => ok(code ?? 1)); });
}
function container(name, image, port, env = {}, command = [], extra = []) {
  const fullName = `${runId}-${name}`;
  containers.push(fullName);
  docker('run', '-d', '--rm', '--name', fullName, '--label', `veiltalk.e2e=${runId}`,
    '-p', `127.0.0.1:${port.host ?? ''}:${port.internal}`, ...extra,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image, ...command);
  const address = docker('port', fullName, `${port.internal}/tcp`);
  return { name: fullName, port: Number(address.split(':').at(-1)) };
}
const hash = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const xmlEscape = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function appendJUnitCase(name, failure) {
  const path = resolve(report, 'results.xml');
  if (!existsSync(path)) return;
  const xml = readFileSync(path, 'utf8');
  const testcase = failure
    ? `\n\t<testcase name="${xmlEscape(name)}" classname="post-run-security">\n`
      + `\t\t<failure type="artifactLeak" message="${xmlEscape(failure)}"/>\n\t</testcase>\n`
    : `\n\t<testcase name="${xmlEscape(name)}" classname="post-run-security"/>\n`;
  if (!xml.includes('</testsuites>')) throw new Error('JUnit XML is incomplete; cannot append post-run security checks');
  writeFileSync(path, xml.replace('</testsuites>', `${testcase}</testsuites>`));
}
async function s3Put(endpoint, path, query, body, key, secret) {
  const url = new URL(endpoint);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8), scope = `${day}/us-east-1/s3/aws4_request`;
  const digest = hash(body), signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = `PUT\n${path}\n${query}\nhost:${url.host}\nx-amz-content-sha256:${digest}\nx-amz-date:${date}\n\n${signed}\n${digest}`;
  const signing = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'us-east-1'), 's3'), 'aws4_request');
  const signature = hmac(signing, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex');
  const response = await fetch(`${endpoint}${path}${query ? '?' + query : ''}`, {
    method: 'PUT', body, signal: AbortSignal.timeout(10000), headers: {
      'x-amz-date': date, 'x-amz-content-sha256': digest,
      Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  });
  if (!response.ok) throw new Error(`MinIO setup failed: ${response.status} ${await response.text()}`);
  await response.arrayBuffer();
}
let cleaning;
function cleanup() {
  return cleaning ??= (async () => {
    for (const child of children.reverse()) {
      if (child.exitCode === null && !child.killed) {
        const exited = new Promise(ok => child.once('exit', ok));
        child.kill();
        await Promise.race([exited, delay(5000)]);
      }
    }
    for (const name of containers.reverse()) {
      try {
        // Verify ownership before removing anything, including after setup failure.
        const label = docker('inspect', '-f', '{{index .Config.Labels "veiltalk.e2e"}}', name);
        if (label === runId) docker('rm', '-f', '-v', name);
      } catch (error) { console.error(`Cleanup ${name}: ${error.message}`); }
    }
  })();
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });

async function main() {
  console.log(`E2E run: ${runId}`);
  docker('info', '--format', '{{.ServerVersion}}');
  preexistingContainers = docker('ps', '-aq').split(/\s+/).filter(Boolean);
  try { devBaseline = snapshotDev(); } catch { devBaseline = null; }
  const password = randomBytes(24).toString('hex');
  const jwt = randomBytes(48).toString('hex');
  const internalSecret = randomBytes(32).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');
  for (const secret of [password, jwt, internalSecret, webhookSecret]) runtimeSecrets.add(secret);
  console.log('Starting disposable PostgreSQL and Redis...');
  const pg = container('postgres', 'postgres:16-alpine', { internal: 5432 }, {
    POSTGRES_DB: 'veiltalk_e2e', POSTGRES_USER: 'e2e', POSTGRES_PASSWORD: password,
  });
  const redis = container('redis', 'redis:7-alpine', { internal: 6379 });
  await until('PostgreSQL', () => docker('exec', pg.name, 'pg_isready', '-U', 'e2e', '-d', 'veiltalk_e2e').includes('accepting connections'));
  const backendPort = await freePort(), signalingPort = await freePort(), minioPort = await freePort();
  const base = `http://127.0.0.1:${backendPort}`;
  const minio = `http://127.0.0.1:${minioPort}`;
  const env = {
    SPRING_CONFIG_IMPORT: 'optional:classpath:/e2e-unused.properties', SPRING_PROFILES_ACTIVE: 'e2e',
    DB_HOST: '127.0.0.1', DB_PORT: String(pg.port), DB_NAME: 'veiltalk_e2e', DB_USER: 'e2e',
    VEILTALK_DB_PASSWORD: password, DB_PASSWORD: password,
    REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redis.port), SPRING_DATA_REDIS_DATABASE: '0',
    SPRING_DATA_REDIS_TIMEOUT: '2s', SPRING_DATA_REDIS_CONNECT_TIMEOUT: '2s',
    JWT_SECRET: jwt, JWT_ACCESS_EXPIRY: '900', JWT_REFRESH_EXPIRY: '604800',
    // Each signaling test socket uses a synthetic X-Forwarded-For address so the
    // production per-IP connection limiter does not couple unrelated fixtures.
    TRUSTED_PROXY_IPS: '127.0.0.1,::ffff:127.0.0.1',
    AUTH_TRUSTED_PROXY_IPS: '127.0.0.1,::ffff:127.0.0.1',
    INTERNAL_CALL_NOTIFY_SECRET: internalSecret, SIGNALING_JWT_SECRET: jwt,
    MESSAGING_WEBSOCKET_HEARTBEAT_INTERVAL_MS: '1000',
    MESSAGING_WS_CONTRACT_VIOLATION_WINDOW_SECONDS: '2',
    MINIO_ENDPOINT: minio, MINIO_ACCESS_KEY: 'e2eadmin', MINIO_SECRET_KEY: password,
    MINIO_BUCKET: 'veiltalk-e2e', MINIO_WEBHOOK_SECRET: webhookSecret,
    SERVER_PORT: String(backendPort), SERVER_ADDRESS: '0.0.0.0',
    LOGGING_LEVEL_ROOT: 'INFO', LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB: 'WARN',
    DEBUG: 'false',
  };
  if (abuseMode) Object.assign(env, {
    AUTH_LOGIN_PAIR_LIMIT: '5', AUTH_LOGIN_IP_LIMIT: '30', AUTH_LOGIN_WINDOW_SECONDS: '900',
    AUTH_REGISTER_SUCCESS_LIMIT: '5', AUTH_REGISTER_FAILURE_LIMIT: '30', AUTH_REGISTER_WINDOW_SECONDS: '3600',
    AUTH_TRUSTED_PROXY_IPS: '127.0.0.1,::ffff:127.0.0.1',
  });
  if (quotaMode) env.VIDEO_STORAGE_LIMIT_BYTES = String(10 * 1024 * 1024 + 30);
  if (multipartMode) Object.assign(env, {
    VIDEO_ACTIVE_UPLOAD_LIMIT: '3', VIDEO_UPLOAD_SESSION_TTL_SECONDS: '8',
    VIDEO_RECORDING_CLEANUP_INTERVAL_SECONDS: '1',
  });
  if (expiryMode) Object.assign(env, {
    VIDEO_PRESIGNED_URL_EXPIRY_SECONDS: '3', VIDEO_VIEW_URL_EXPIRY_SECONDS: '3',
  });
  console.log('Building backend (existing unit tests are a separate suite)...');
  const build = process.platform === 'win32'
    ? start('cmd.exe', ['/d', '/s', '/c', 'mvn.cmd -q -f backend/pom.xml -DskipTests package'], env, 'build.log')
    : start('mvn', ['-q', '-f', 'backend/pom.xml', '-DskipTests', 'package'], env, 'build.log');
  if (await finish(build) !== 0) throw new Error('Backend build failed; see build.log');
  console.log('Starting backend and waiting for HTTP health...');
  const backend = start('java', ['-jar', 'backend/target/backend-0.0.1-SNAPSHOT.jar'], env, 'backend.log');
  await until('backend', async () => {
    if (backend.exitCode !== null) throw new Error('backend stopped');
    const r = await fetch(`${base}/actuator/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).status === 'UP';
  });
  docker('exec', pg.name, 'psql', '-U', 'e2e', '-d', 'veiltalk_e2e', '-v', 'ON_ERROR_STOP=1', '-c',
    `CREATE TABLE e2e_run_markers (marker text PRIMARY KEY); INSERT INTO e2e_run_markers(marker) VALUES ('${runId}');`);
  console.log('Starting MinIO with a real webhook to the backend...');
  container('minio', 'minio/minio:latest', { internal: 9000, host: minioPort }, {
    MINIO_ROOT_USER: 'e2eadmin', MINIO_ROOT_PASSWORD: password,
    MINIO_NOTIFY_WEBHOOK_ENABLE_E2E: 'on',
    MINIO_NOTIFY_WEBHOOK_ENDPOINT_E2E: `http://host.docker.internal:${backendPort}/internal/videos/webhook`,
    MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_E2E: webhookSecret,
    MINIO_NOTIFY_WEBHOOK_BATCH_SIZE_E2E: '1',
  }, ['server', '/data'], ['--add-host', 'host.docker.internal:host-gateway']);
  await until('MinIO', async () => (await fetch(`${minio}/minio/health/ready`, { signal: AbortSignal.timeout(2000) })).ok);
  let bucketCreated = false;
  for (let attempt = 0; attempt < 20 && !bucketCreated; attempt++) {
    try {
      await s3Put(minio, '/veiltalk-e2e', '', '', 'e2eadmin', password);
      bucketCreated = true;
    } catch (error) {
      if (!error.message.includes('XMinioServerNotInitialized') || attempt === 19) throw error;
      await delay(500);
    }
  }
  const notification = '<NotificationConfiguration><QueueConfiguration><Id>e2e</Id><Queue>arn:minio:sqs::E2E:webhook</Queue><Event>s3:ObjectCreated:CompleteMultipartUpload</Event></QueueConfiguration></NotificationConfiguration>';
  let configured = false;
  for (let attempt = 0; attempt < 20 && !configured; attempt++) {
    try {
      await s3Put(minio, '/veiltalk-e2e', 'notification=', notification, 'e2eadmin', password);
      configured = true;
    } catch (error) {
      if ((!error.message.includes('<Code>InvalidArgument</Code>')
          && !error.message.includes('XMinioServerNotInitialized')) || attempt === 19) throw error;
      await delay(500);
    }
  }
  start(process.execPath, ['signaling/src/index.js'], { ...env, PORT: String(signalingPort), BACKEND_URL: base }, 'signaling.log');
  await until('signaling port', () => new Promise(ok => {
    const socket = net.connect(signalingPort, '127.0.0.1');
    socket.on('connect', () => { socket.destroy(); ok(true); });
    socket.on('error', () => ok(false));
  }));
  console.log('Running real HTTP / WebSocket / multipart scenarios...');
  const testFiles = regressionMode
    ? ['scripts/t05-e2e/core.test.cjs', 'scripts/t05-e2e/call.test.cjs', 'scripts/t05-e2e/journeys.test.cjs',
      'scripts/t05-e2e/extended.test.cjs', 'scripts/t05-e2e/p1.test.cjs', 'scripts/t05-e2e/remaining.test.cjs',
      'scripts/t05-e2e/environment.test.cjs']
    : abuseMode ? ['scripts/t06-seciurity/abuse.test.cjs']
      : quotaMode ? ['scripts/t06-seciurity/quota-security.test.cjs']
      : multipartMode ? ['scripts/t06-seciurity/multipart-security.test.cjs']
      : expiryMode ? ['scripts/t06-seciurity/expiry-security.test.cjs']
      : remainingMode ? ['scripts/t06-seciurity/remaining-runnable.test.cjs',
        'scripts/t06-seciurity/remaining-environment.test.cjs']
      : ['scripts/t06-seciurity/security.test.cjs', 'scripts/t06-seciurity/boundaries.test.cjs',
        'scripts/t06-seciurity/ownership.test.cjs', 'scripts/t06-seciurity/critical.test.cjs',
        'scripts/t06-seciurity/extended.test.cjs', 'scripts/t06-seciurity/signaling-security.test.cjs',
        'scripts/t06-seciurity/video-security.test.cjs', 'scripts/t06-seciurity/cross-security.test.cjs',
        'scripts/t06-seciurity/observability.test.cjs', 'scripts/t06-seciurity/config-security.test.cjs',
        'scripts/t06-seciurity/remaining-local.test.cjs', 'scripts/t06-seciurity/fault-security.test.cjs'];
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1',
    ...(process.env.T06_TEST_PATTERN ? [`--test-name-pattern=${process.env.T06_TEST_PATTERN}`] : []),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', `--test-reporter-destination=${resolve(report, 'results.xml')}`,
    ...testFiles], {
    cwd: root, env: { ...process.env, E2E_BACKEND_URL: base,
      E2E_BACKEND_START_ENV: JSON.stringify(env),
      E2E_RESULT_DIR: report,
      E2E_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}/ws/signaling`,
      E2E_PG_CONTAINER: pg.name, E2E_REDIS_CONTAINER: redis.name,
      E2E_CALL_SECRET: internalSecret, E2E_WEBHOOK_SECRET: webhookSecret,
      E2E_JWT_SECRET: jwt }, stdio: 'inherit', windowsHide: true,
  });
  children.push(tests);
  const code = await finish(tests);
  writeFileSync(resolve(report, 'run.json'), JSON.stringify({ runId, date: new Date().toISOString(), exitCode: code,
    resources: { containers: [...containers], postgresMarker: runId },
    services: ['Spring Boot JAR', 'Node signaling', 'PostgreSQL', 'Redis', 'MinIO with webhook'],
    limits: ['No browser/WebRTC media', 'No load test', 'No external network/NAT test'] }, null, 2));
  return code;
}
main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message); process.exitCode = 1;
  writeFileSync(resolve(report, 'run.json'), JSON.stringify({ runId, date: new Date().toISOString(),
    exitCode: 1, classification: 'REVIEW_REQUIRED', setupError: error.message }, null, 2));
}).finally(async () => {
  await cleanup();
  if (existsSync(resolve(report, 'run.json'))) {
    const metadata = JSON.parse(readFileSync(resolve(report, 'run.json'), 'utf8'));
    try {
      const owned = docker('ps', '-aq', '--filter', `label=veiltalk.e2e=${runId}`);
      if (owned) throw new Error('Owned containers remain after cleanup');
      const after = new Set(docker('ps', '-aq').split(/\s+/).filter(Boolean));
      if (preexistingContainers.some(id => ![...after].some(current => current.startsWith(id)))) {
        throw new Error('Preexisting container disappeared');
      }
      metadata.cleanup = { verified: true };
    } catch (error) {
      metadata.cleanup = { verified: false, error: error.message };
      process.exitCode = 1;
    }
    if (devBaseline) {
      try {
        if (JSON.stringify(snapshotDev()) !== JSON.stringify(devBaseline)) throw new Error('Dev stack changed');
        metadata.devIsolation = { verified: true };
      } catch (error) {
        metadata.devIsolation = { verified: false, error: error.message };
        process.exitCode = 1;
      }
    }
    const patterns = [
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
      /[?&]X-Amz-Signature=[A-Fa-f0-9]{32,}/g,
      /T04Strong123!/g,
      /Using generated security password:/g,
    ];
    const artifacts = ['build.log', 'backend.log', 'signaling.log', 'results.xml', 'run.json'];
    const leaked = artifacts.filter(name => existsSync(resolve(report, name)) && patterns.some(pattern => {
      pattern.lastIndex = 0;
      return pattern.test(readFileSync(resolve(report, name), 'utf8'));
    }) || [...runtimeSecrets].some(secret => readFileSync(resolve(report, name), 'utf8').includes(secret)));
    metadata.artifactScan = { verified: leaked.length === 0, flaggedFiles: leaked };
    if (leaked.length) process.exitCode = 1;
    if (!abuseMode && !quotaMode && !multipartMode && !expiryMode && !remainingMode && !regressionMode) {
      appendJUnitCase('LOG-009 JUnit and runner artifacts contain no raw credentials',
        leaked.length ? `Credential material detected in: ${leaked.join(', ')}` : null);
    }
    metadata.exitCode = process.exitCode ?? 0;
    writeFileSync(resolve(report, 'run.json'), JSON.stringify(metadata, null, 2));
    if (!regressionMode && existsSync(resolve(report, 'results.xml'))) require('./write-results.cjs').writeReport(report);
  }
  console.log(`Reports: ${report}`);
});
