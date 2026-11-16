const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, uuid, sql, redis, password } = h;
const { createHash } = require('node:crypto');

function from(ip) { return { headers: { 'X-Forwarded-For': ip } }; }
async function register(ip, email = `${uuid()}@example.com`, pass = password) {
  return request('POST', '/auth/register', null,
    { email, password: pass, display_name: 'T06 abuse fixture', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` }, from(ip));
}
async function login(ip, email, pass) {
  return request('POST', '/auth/login', null, { email, password: pass }, from(ip));
}

test('ABUSE-006 login failure pair and IP limits are temporary, isolated and neutral', async () => {
  const ownerEmail = `${uuid()}@example.com`;
  assert.equal((await register('198.51.100.10', ownerEmail)).status, 201);
  const wrong = 'Wrong123!';
  const pairIp = '198.51.100.11';
  const missingEmail = `${uuid()}@example.com`;
  let existingError, missingError;
  for (let i = 0; i < 5; i++) {
    const existing = await login(pairIp, ownerEmail, wrong);
    const missing = await login(pairIp, missingEmail, wrong);
    assert.equal(existing.status, 401);
    assert.equal(missing.status, 401);
    existingError = existing.data?.error?.message;
    missingError = missing.data?.error?.message;
  }
  assert.equal(existingError, missingError, 'Response reveals account existence');
  const blocked = await login(pairIp, ownerEmail, password);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await login('198.51.100.12', ownerEmail, password)).status, 200,
    'One IP blocked the account for another IP');
  const globalIp = '198.51.100.13';
  for (let i = 0; i < 30; i++) {
    const response = await login(globalIp, `${uuid()}@example.com`, wrong);
    assert.equal(response.status, 401, `IP limit triggered before 30 failures at ${i}`);
  }
  const globalBlocked = await login(globalIp, `${uuid()}@example.com`, wrong);
  assert.equal(globalBlocked.status, 429);
  assert.ok(Number(globalBlocked.headers.get('retry-after')) > 0);
});

test('ABUSE-007 successful and failed registration limits are separate', async () => {
  const ip = '198.51.100.20';
  const rejected = await register(ip, `${uuid()}@example.com`, 'weak');
  assert.equal(rejected.status, 400);
  for (let i = 0; i < 5; i++) {
    assert.equal((await register(ip)).status, 201, `Invalid request consumed success slot ${i}`);
  }
  const sixthEmail = `${uuid()}@example.com`;
  const blocked = await register(ip, sixthEmail);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(sql(`SELECT count(*) FROM users WHERE email='${sixthEmail}'`), '0');
  const failedIp = '198.51.100.21';
  for (let i = 0; i < 30; i++) {
    const response = await register(failedIp, `${uuid()}@example.com`, 'weak');
    assert.equal(response.status, 400, `Failure limit triggered before 30 at ${i}`);
  }
  const failedBlocked = await register(failedIp);
  assert.equal(failedBlocked.status, 429);
  assert.ok(Number(failedBlocked.headers.get('retry-after')) > 0);
  assert.equal((await register('198.51.100.22')).status, 201,
    'One IP blocked registration from another IP');
  const remoteKey = `rate:auth:login-ip:${createHash('sha256').update('127.0.0.1').digest('hex')}`;
  const remoteBefore = Number(redis('ZCARD', remoteKey));
  for (const spoofed of ['203.0.113.1, 198.51.100.1', '203.0.113.2, 198.51.100.1']) {
    const response = await request('POST', '/auth/login', null,
      { email: `${uuid()}@example.com`, password: 'Wrong123!' }, from(spoofed));
    assert.equal(response.status, 401);
  }
  assert.equal(Number(redis('ZCARD', remoteKey)), remoteBefore + 2,
    'Untrusted forwarded chain bypassed the remote IP counter');
});
