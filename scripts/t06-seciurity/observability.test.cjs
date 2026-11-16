const h = require('../t04-api/support.cjs');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');
const { assert, caseTest: test, request, ok, user, video, readyVideo,
  sql, uuid, messaging, wait, base } = h;

function logs() {
  return ['backend.log', 'signaling.log', 'build.log']
    .map(name => readFileSync(resolve(process.env.E2E_RESULT_DIR, name), 'utf8')).join('\n');
}
function noInternalDetails(text) {
  assert.doesNotMatch(text, /stacktrace|password_hash|jdbc:|SELECT \* FROM|org\.springframework\.[A-Za-z]+Exception/i);
}

test('CONFIG-002 messaging handshake refuses foreign Origin with a valid token', async () => {
  const a = await user();
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws/messaging?token=' + encodeURIComponent(a.token),
    { headers: { Origin: 'https://foreign.example' } });
  const status = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Origin handshake timeout')), 5000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer); response.resume(); done(response.statusCode);
    });
    socket.once('open', () => { clearTimeout(timer); socket.close(); fail(new Error('Foreign Origin opened')); });
    socket.once('error', error => { clearTimeout(timer); fail(error); });
  });
  assert.ok([401, 403].includes(status));
});

test('CONFIG-007 actuator exposes health but not env, beans, metrics or heapdump', async () => {
  const health = await request('GET', '/actuator/health', null);
  assert.equal(health.status, 200);
  assert.equal(health.data?.status, 'UP');
  for (const path of ['/actuator', '/actuator/env', '/actuator/beans',
    '/actuator/metrics', '/actuator/heapdump']) {
    const response = await request('GET', path, null);
    assert.ok([401, 403, 404].includes(response.status), `${path}: HTTP ${response.status}`);
    assert.equal(response.raw.includes(process.env.E2E_JWT_SECRET), false);
    assert.equal(response.raw.includes(process.env.E2E_CALL_SECRET), false);
    noInternalDetails(response.raw);
  }
});

test('LOG-002 password stays hashed in DB and absent from responses and service logs', async () => {
  const email = `log-${uuid()}@example.com`, password = `T06Secret${uuid()}9`;
  const registration = await request('POST', '/auth/register', null,
    { email, password, display_name: 'T06 log check', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` });
  assert.equal(registration.status, 201);
  const failed = await request('POST', '/auth/login', null, { email, password: `${password}wrong` });
  assert.equal(failed.status, 401);
  const hash = sql(`SELECT password_hash FROM users WHERE email='${email}'`);
  assert.match(hash, /^\$2[aby]\$/);
  assert.notEqual(hash, password);
  for (const content of [registration.raw, failed.raw, logs()]) {
    assert.equal(content.includes(password), false);
    assert.equal(content.includes(`${password}wrong`), false);
    assert.equal(content.includes(hash), false);
  }
});

test('LOG-003 presigned URL query is absent from errors and service logs', async () => {
  const a = await user(), item = await video(a);
  const error = await request('POST', `/videos/${item.id}/finalize`, a.token,
    { upload_id: 'bad', duration_secs: 1, parts: [{ part_number: 1, etag: 'bad' }] });
  assert.ok([400, 404, 409].includes(error.status));
  for (const content of [error.raw, logs()]) {
    assert.equal(content.includes(item.first_chunk_url), false);
    assert.doesNotMatch(content, /[?&]X-Amz-Signature=[A-Fa-f0-9]{32,}/);
  }
});

test('LOG-004 internal call secret is not echoed on successful or rejected notify', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const body = { caller_id: a.id, callee_id: b.id, call_id: uuid() };
  const wrong = await request('POST', '/internal/call/notify', null, body,
    { headers: { Authorization: `Bearer ${process.env.E2E_CALL_SECRET}x` } });
  assert.equal(wrong.status, 401);
  const success = await request('POST', '/internal/call/notify', null, body,
    { headers: { Authorization: `Bearer ${process.env.E2E_CALL_SECRET}` } });
  assert.equal(success.status, 204);
  await receiver.take('CALL_INCOMING');
  for (const content of [wrong.raw, success.raw, logs()]) {
    assert.equal(content.includes(process.env.E2E_CALL_SECRET), false);
    assert.equal(content.includes(process.env.E2E_WEBHOOK_SECRET), false);
  }
});

test('LOG-006 metrics request does not print token or arbitrary personal content', async () => {
  const a = await user(), sentinel = `private-metrics-${uuid()}`;
  const response = await request('POST', '/metrics/client', a.token,
    { session_type: 'preview', fps: 30, timestamp: new Date().toISOString(),
      note: sentinel, email: a.email });
  assert.equal(response.status, 204);
  await wait(100);
  const content = logs();
  assert.equal(content.includes(a.token), false);
  assert.equal(content.includes(a.email), false);
  assert.equal(content.includes(sentinel), false);
});

test('LOG-007 forbidden and missing video errors reveal no owner detail', async () => {
  const a = await user(), b = await user(), ready = await readyVideo(b);
  const ownerKey = sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  for (const id of [ready.item.id, uuid()]) {
    const response = await request('GET', `/videos/${id}`, a.token);
    assert.ok([403, 404].includes(response.status));
    assert.equal(response.raw.includes(b.email), false);
    assert.equal(response.raw.includes(ready.detail.title), false);
    assert.equal(response.raw.includes(ownerKey), false);
    assert.equal(response.raw.includes(ready.detail.view_url), false);
    noInternalDetails(response.raw);
  }
});

test('LOG-011 health response contains status only and no environment secrets', async () => {
  const response = await request('GET', '/actuator/health', null);
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'UP');
  for (const component of Object.values(response.data.components ?? {})) {
    assert.deepEqual(Object.keys(component), ['status']);
    assert.equal(component.status, 'UP');
  }
  assert.equal(response.raw.includes(process.env.E2E_JWT_SECRET), false);
  assert.equal(response.raw.includes(process.env.E2E_CALL_SECRET), false);
  assert.equal(response.raw.includes(process.env.E2E_WEBHOOK_SECRET), false);
});
