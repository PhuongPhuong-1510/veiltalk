// Real-process functional tests. Own disposable containers only; never use .env.
const { spawn, execFileSync } = require('node:child_process');
const { mkdirSync, openSync, closeSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const net = require('node:net');

const root = resolve(__dirname, '../..');
const report = resolve(root, 'backend/target/e2e');
mkdirSync(report, { recursive: true });
const runId = `veiltalk-e2e-${Date.now()}-${randomBytes(3).toString('hex')}`;
const containers = [];
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim();
async function until(label, check, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* retry readiness only */ }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${label}; inspect backend/target/e2e logs`);
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
  const password = randomBytes(24).toString('hex');
  const jwt = randomBytes(48).toString('hex');
  const internalSecret = randomBytes(24).toString('hex');
  const webhookSecret = randomBytes(24).toString('hex');
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
    JWT_SECRET: jwt, JWT_ACCESS_EXPIRY: '900', JWT_REFRESH_EXPIRY: '604800',
    INTERNAL_CALL_NOTIFY_SECRET: internalSecret, SIGNALING_JWT_SECRET: jwt,
    MINIO_ENDPOINT: minio, MINIO_ACCESS_KEY: 'e2eadmin', MINIO_SECRET_KEY: password,
    MINIO_BUCKET: 'veiltalk-e2e', MINIO_WEBHOOK_SECRET: webhookSecret,
    SERVER_PORT: String(backendPort), SERVER_ADDRESS: '0.0.0.0',
    LOGGING_LEVEL_ROOT: 'INFO', LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB: 'WARN',
  };
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
  console.log('Starting MinIO with a real webhook to the backend...');
  container('minio', 'minio/minio:latest', { internal: 9000, host: minioPort }, {
    MINIO_ROOT_USER: 'e2eadmin', MINIO_ROOT_PASSWORD: password,
    MINIO_NOTIFY_WEBHOOK_ENABLE_E2E: 'on',
    MINIO_NOTIFY_WEBHOOK_ENDPOINT_E2E: `http://host.docker.internal:${backendPort}/internal/videos/webhook`,
    MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_E2E: webhookSecret,
    MINIO_NOTIFY_WEBHOOK_BATCH_SIZE_E2E: '1',
  }, ['server', '/data'], ['--add-host', 'host.docker.internal:host-gateway']);
  await until('MinIO', async () => (await fetch(`${minio}/minio/health/ready`, { signal: AbortSignal.timeout(2000) })).ok);
  await s3Put(minio, '/veiltalk-e2e', '', '', 'e2eadmin', password);
  await s3Put(minio, '/veiltalk-e2e', 'notification=',
    '<NotificationConfiguration><QueueConfiguration><Id>e2e</Id><Queue>arn:minio:sqs::E2E:webhook</Queue><Event>s3:ObjectCreated:CompleteMultipartUpload</Event></QueueConfiguration></NotificationConfiguration>', 'e2eadmin', password);
  start(process.execPath, ['signaling/src/index.js'], { ...env, PORT: String(signalingPort), BACKEND_URL: base }, 'signaling.log');
  await until('signaling port', () => new Promise(ok => {
    const socket = net.connect(signalingPort, '127.0.0.1');
    socket.on('connect', () => { socket.destroy(); ok(true); });
    socket.on('error', () => ok(false));
  }));
  console.log('Running real HTTP / WebSocket / multipart scenarios...');
  const tests = spawn(process.execPath, ['--test', '--test-concurrency=1',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', `--test-reporter-destination=${resolve(report, 'results.xml')}`,
    'scripts/e2e/backend.test.cjs'], {
    cwd: root, env: { ...process.env, E2E_BACKEND_URL: base,
      E2E_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}/ws/signaling`,
      E2E_PG_CONTAINER: pg.name, E2E_REDIS_CONTAINER: redis.name }, stdio: 'inherit', windowsHide: true,
  });
  children.push(tests);
  const code = await finish(tests);
  writeFileSync(resolve(report, 'run.json'), JSON.stringify({ runId, date: new Date().toISOString(), exitCode: code,
    services: ['Spring Boot JAR', 'Node signaling', 'PostgreSQL', 'Redis', 'MinIO with webhook'],
    limits: ['No browser/WebRTC media', 'No load test', 'No external network/NAT test'] }, null, 2));
  return code;
}
main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(async () => { await cleanup(); console.log(`Reports: ${report}`); });
