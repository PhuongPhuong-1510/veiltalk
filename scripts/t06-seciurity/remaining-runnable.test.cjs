const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const h = require('../t04-api/support.cjs');

const root = resolve(__dirname, '../..');
const composePath = resolve(root, 'docker-compose.yml');
const compose = readFileSync(composePath, 'utf8');
const { request, user, sql, redis, uuid, wait } = h;

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|^networks:|\\z)`, 'm'));
  assert.ok(match, `docker-compose.yml has no ${name} service`);
  return match[1];
}

test('VID-017 Redis failure after multipart creation has a tested compensation path',
  { timeout: 120_000 }, () => {
  const command = process.platform === 'win32' ? 'cmd.exe' : './mvnw';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'mvnw.cmd -q -Dtest=VideoInitiateUploadCompensationTests test']
    : ['-q', '-Dtest=VideoInitiateUploadCompensationTests', 'test'];
  const result = spawnSync(command, args, {
    cwd: resolve(root, 'backend'), encoding: 'utf8', timeout: 110_000, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0,
    'Redis-session failure left the created MinIO multipart without an abort/compensation call');
});

test('CONFIG-003 Compose does not publish PostgreSQL Redis or MinIO administration publicly', () => {
  for (const [service, ports] of Object.entries({
    postgres: [5432], redis: [6379], minio: [9000, 9001],
  })) {
    const block = serviceBlock(service);
    for (const port of ports) {
      const publicBinding = new RegExp(`^[ \\t]*-[ \\t]*["']?(?!127\\.0\\.0\\.1:|\\[::1\\]:)${port}:${port}["']?[ \\t]*$`, 'm');
      assert.doesNotMatch(block, publicBinding,
        `${service} ${port} is published on all host interfaces`);
    }
  }
});

test('CONFIG-010 container manifests avoid privileged runtime settings and use a non-root app user', () => {
  assert.doesNotMatch(compose, /^\s*privileged:\s*true\s*$/mi);
  assert.doesNotMatch(compose, /^\s*(?:network_mode|pid|ipc):\s*host\s*$/mi);
  assert.doesNotMatch(compose, /(?:^|[\\/])docker\.sock(?::|\s|$)/mi);
  assert.doesNotMatch(compose, /^\s*-?\s*ALL\s*$/m, 'Container adds all Linux capabilities');

  for (const directory of ['backend', 'frontend', 'signaling']) {
    const dockerfile = resolve(root, directory, 'Dockerfile');
    let source;
    try { source = readFileSync(dockerfile, 'utf8'); }
    catch { assert.fail(`${directory}/Dockerfile is missing, so runtime privilege cannot be verified`); }
    const users = [...source.matchAll(/^\s*USER\s+([^\s#]+)/gmi)].map(match => match[1]);
    assert.ok(users.length > 0, `${directory}/Dockerfile does not declare a non-root USER`);
    assert.doesNotMatch(users.at(-1), /^(?:0|root)$/i, `${directory} runtime user is root`);
  }
});

test('CONFIG-013 authenticated and token responses prohibit shared caching', async () => {
  const account = await user();
  const responses = [
    await request('GET', '/users/me', account.token),
    await request('POST', '/auth/login', null,
      { email: account.email, password: account.password }),
  ];
  for (const response of responses) {
    assert.ok([200, 201].includes(response.status));
    const cacheControl = response.headers.get('cache-control') ?? '';
    assert.match(cacheControl, /(?:no-store|private)/i,
      `Sensitive response allows shared caching: ${cacheControl || '(missing)'}`);
  }
});

test('CONFIG-015 JVM PostgreSQL and Redis clocks stay within five seconds', async () => {
  const before = Date.now() / 1000;
  const databaseSeconds = Number(sql('SELECT EXTRACT(EPOCH FROM clock_timestamp())'));
  const [redisSeconds, redisMicros] = redis('TIME').split(/\s+/).map(Number);
  const after = Date.now() / 1000;
  const midpoint = (before + after) / 2;
  const redisTime = redisSeconds + redisMicros / 1_000_000;
  assert.ok(Math.abs(databaseSeconds - midpoint) <= 5,
    `PostgreSQL clock skew is ${Math.abs(databaseSeconds - midpoint).toFixed(3)} seconds`);
  assert.ok(Math.abs(redisTime - midpoint) <= 5,
    `Redis clock skew is ${Math.abs(redisTime - midpoint).toFixed(3)} seconds`);
  const health = await request('GET', '/actuator/health', null);
  assert.equal(health.status, 200, 'JVM/backend was not available during the clock check');
});

test('LOG-008 security-sensitive actions produce an audit trail without credentials', async () => {
  const account = await user();
  const failedEmail = `audit-${uuid()}@example.test`;
  await request('POST', '/auth/login', null,
    { email: failedEmail, password: 'WrongPassword9' });
  await request('POST', '/auth/logout', account.token,
    { refresh_token: account.refresh });
  const badInternal = await request('POST', '/internal/call/notify', null,
    { caller_id: account.id, callee_id: uuid(), call_id: uuid() },
    { headers: { Authorization: 'Bearer invalid-audit-secret' } });
  assert.equal(badInternal.status, 401);
  await wait(100);

  const log = readFileSync(resolve(process.env.E2E_RESULT_DIR, 'backend.log'), 'utf8');
  const requiredEvents = [
    /(?:AUTH|LOGIN).*(?:FAIL|DENY)|(?:FAIL|DENY).*(?:AUTH|LOGIN)/i,
    /LOGOUT|TOKEN_REVOK/i,
    /(?:INTERNAL|CALL_NOTIFY).*(?:FAIL|DENY|UNAUTHORIZED)|(?:FAIL|DENY|UNAUTHORIZED).*(?:INTERNAL|CALL_NOTIFY)/i,
  ];
  for (const pattern of requiredEvents) {
    assert.match(log, pattern, `Missing security audit event matching ${pattern}`);
  }
  assert.equal(log.includes(account.token), false);
  assert.equal(log.includes(account.refresh), false);
  assert.equal(log.includes('WrongPassword9'), false);
  assert.equal(log.includes('invalid-audit-secret'), false);
});
