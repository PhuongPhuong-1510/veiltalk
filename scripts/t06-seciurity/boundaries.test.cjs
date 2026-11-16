const h = require('../t04-api/support.cjs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');
const { assert, caseTest: test, request, ok, user, pair, video, validVideo,
  message, validMessage, sql, redis, uuid, messaging, wait, base } = h;

function deny(response, accepted = [401, 403]) {
  assert.ok(accepted.includes(response.status), `Expected denial; HTTP ${response.status}`);
  assert.equal(response.data?.tokens, undefined);
  assert.equal(response.data?.view_url, undefined);
  assert.doesNotMatch(response.raw, /stacktrace|password_hash|X-Amz-Signature/i);
}
async function noEvent(socket, type) {
  await wait(450);
  assert.equal(socket.events.some(event => event.type === type), false, `Unexpected ${type}`);
}
async function refusedWs(url, options = {}) {
  const socket = new WebSocket(url, options);
  const status = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('WebSocket handshake timeout')), 5000);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer); response.resume(); done(response.statusCode);
    });
    socket.once('open', () => {
      clearTimeout(timer); socket.close(); fail(new Error('Unauthorized WebSocket opened'));
    });
    socket.once('error', error => { clearTimeout(timer); fail(error); });
  });
  assert.ok([401, 403].includes(status), `Expected 401/403; got ${status}`);
}
const wsUrl = () => base.replace(/^http/, 'ws') + '/ws/messaging';
const webhook = (key = 'videos/nonexistent/source.webm') => ({ Records: [{
  eventName: 's3:ObjectCreated:CompleteMultipartUpload',
  s3: { bucket: { name: 'veiltalk-e2e' }, object: { key, size: 12 } },
}] });

test('BFLA-001 user JWT cannot call internal notify or emit a call event', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const response = await request('POST', '/internal/call/notify', a.token,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() });
  deny(response, [401]);
  await noEvent(receiver, 'CALL_INCOMING');
});

test('BFLA-002 user JWT cannot call video webhook or change status and quota', async () => {
  const a = await user(), item = await video(a);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  const response = await request('POST', '/internal/videos/webhook', a.token,
    webhook(sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`)));
  deny(response, [401]);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('BFLA-003 missing, wrong and blank internal secrets have no side effect', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const item = await video(a);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  for (const authorization of [undefined, 'Bearer invalid', 'Bearer ', 'Bearer  invalid']) {
    const options = authorization ? { headers: { Authorization: authorization } } : {};
    deny(await request('POST', '/internal/call/notify', null,
      { caller_id: a.id, callee_id: b.id, call_id: uuid() }, options), [401]);
    deny(await request('POST', '/internal/videos/webhook', null,
      webhook(sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`)), options), [401]);
  }
  await noEvent(receiver, 'CALL_INCOMING');
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('BFLA-004 public avatar catalog does not grant access to private APIs', async () => {
  const a = await user();
  assert.equal((await request('GET', '/avatars/models', null)).status, 200);
  const protectedCalls = [
    ['GET', '/users/me'], ['GET', '/users/me/settings'], ['GET', '/conversations'],
    ['GET', '/videos'], ['GET', `/conversations/${uuid()}`],
    ['POST', '/conversations', { other_user_id: a.id }],
    ['POST', '/users/search', { query: a.email }],
  ];
  for (const [method, path, body] of protectedCalls) {
    deny(await request(method, path, null, body), [401]);
  }
});

test('BFLA-005 profile update cannot elevate role', async () => {
  const a = await user();
  const before = sql(`SELECT role FROM users WHERE id='${a.id}'`);
  const response = await request('PUT', '/users/me', a.token,
    { display_name: 'T06 role check', role: 'admin', is_admin: true });
  assert.ok([200, 400].includes(response.status));
  assert.equal(sql(`SELECT role FROM users WHERE id='${a.id}'`), before);
  assert.equal((await ok('GET', '/users/me', a.token)).role, before);
});

test('BFLA-006 profile update cannot change identity or deletion fields', async () => {
  const a = await user(), b = await user();
  const before = sql(`SELECT id, created_at, deleted_at FROM users WHERE id IN ('${a.id}','${b.id}') ORDER BY id`);
  const response = await request('PUT', '/users/me', a.token,
    { display_name: 'T06 identity check', id: b.id, user_id: b.id,
      deleted_at: null, created_at: '2000-01-01T00:00:00Z' });
  assert.ok([200, 400].includes(response.status));
  assert.equal(sql(`SELECT id, created_at, deleted_at FROM users WHERE id IN ('${a.id}','${b.id}') ORDER BY id`), before);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('BFLA-007 message body cannot forge sender or server fields', async t => {
  const p = await pair(), receiver = await messaging(p.b, t);
  const body = { ...validMessage(`sender-check-${uuid()}`), sender_id: p.b.id,
    user_id: p.b.id, system: true, internal: true };
  const response = await request('POST', `/conversations/${p.id}/messages`, p.a.token, body);
  assert.ok([201, 400].includes(response.status));
  if (response.status === 201) {
    assert.equal(sql(`SELECT sender_id FROM messages WHERE id='${body.id}'`), p.a.id);
    const event = await receiver.take('NEW_MESSAGE');
    assert.equal(event.data.sender_id, p.a.id);
  } else {
    assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`), '0');
    await noEvent(receiver, 'NEW_MESSAGE');
  }
});

test('BFLA-008 video creation cannot forge owner, status or quota', async () => {
  const a = await user(), b = await user();
  const beforeB = sql(`SELECT count(*) FROM videos WHERE user_id='${b.id}'`);
  const response = await request('POST', '/videos', a.token, validVideo({
    user_id: b.id, owner_id: b.id, status: 'ready', storage_used_bytes: 0,
  }));
  assert.ok([201, 400].includes(response.status));
  assert.equal(sql(`SELECT count(*) FROM videos WHERE user_id='${b.id}'`), beforeB);
  if (response.status === 201) {
    assert.equal(sql(`SELECT user_id, status FROM videos WHERE id='${response.data.id}'`), `${a.id}|recording`);
    assert.equal((await ok('GET', `/videos/${response.data.id}`, a.token)).view_url, null);
  }
});

test('WSM-001 missing messaging token is refused during handshake', async () => {
  await refusedWs(wsUrl());
});

test('WSM-002 empty, duplicate and invalid messaging tokens are refused', async () => {
  const a = await user();
  for (const query of ['?token=', `?token=${encodeURIComponent(a.token)}&token=${encodeURIComponent(a.token)}`,
    '?token=invalid']) await refusedWs(wsUrl() + query);
});

test('WSM-003 altered messaging token signature is refused', async () => {
  const a = await user(), parts = a.token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await refusedWs(wsUrl() + '?token=' + encodeURIComponent(parts.join('.')));
});

test('WSM-004 logged-out token cannot start messaging session', async () => {
  const a = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await refusedWs(wsUrl() + '?token=' + encodeURIComponent(a.token));
});

test('WSM-005 deleted account token cannot start messaging session', async () => {
  const a = await user();
  await ok('DELETE', '/users/me', a.token, { password: a.password }, 204);
  await refusedWs(wsUrl() + '?token=' + encodeURIComponent(a.token));
});

test('WSM-006 allowed Origin opens and disallowed Origin is refused', async t => {
  const a = await user();
  const allowed = new WebSocket(wsUrl() + '?token=' + encodeURIComponent(a.token),
    { headers: { Origin: 'http://localhost:5173' } });
  t.after(() => allowed.close());
  await new Promise((done, fail) => {
    allowed.once('open', done);
    allowed.once('error', fail);
  });
  await refusedWs(wsUrl() + '?token=' + encodeURIComponent(a.token),
    { headers: { Origin: 'https://foreign.example' } });
});

test('INT-002 user access credential cannot substitute for notify secret', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  deny(await request('POST', '/internal/call/notify', a.token,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() }), [401]);
  await noEvent(receiver, 'CALL_INCOMING');
});

test('INT-003 wrong notify secret cannot emit a call event', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const response = await request('POST', '/internal/call/notify', null,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() },
    { headers: { Authorization: 'Bearer wrong-notify-secret' } });
  deny(response, [401]);
  assert.equal(response.raw.includes(process.env.E2E_CALL_SECRET), false);
  await noEvent(receiver, 'CALL_INCOMING');
});

test('INT-004 webhook without Authorization cannot mutate video status', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  deny(await request('POST', '/internal/videos/webhook', null, webhook(key)), [401]);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('INT-005 user JWT cannot substitute for webhook secret', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  deny(await request('POST', '/internal/videos/webhook', a.token, webhook(key)), [401]);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('INT-006 notify and webhook secrets cannot be used interchangeably', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  deny(await request('POST', '/internal/call/notify', null,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() },
    { headers: { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` } }), [401]);
  deny(await request('POST', '/internal/videos/webhook', null, webhook(key),
    { headers: { Authorization: `Bearer ${process.env.E2E_CALL_SECRET}` } }), [401]);
  await noEvent(receiver, 'CALL_INCOMING');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
});

test('INT-009 authenticated forged webhook cannot make missing object READY', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  assert.match(before, /^recording\|\d+$/);
  const response = await request('POST', '/internal/videos/webhook', null, webhook(key),
    { headers: { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` } });
  assert.ok([204, 400, 404, 409].includes(response.status));
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('INT-010 malformed internal body and wrong secret do not reveal internals', async () => {
  for (const path of ['/internal/call/notify', '/internal/videos/webhook']) {
    const response = await request('POST', path, null, '{',
      { raw: true, headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' } });
    deny(response, [401]);
    assert.doesNotMatch(response.raw, /jdbc|postgres|exception|com\.veiltalk|secret/i);
  }
});

test('INPUT-001 malformed JSON on a protected route cannot create data', async () => {
  const p = await pair();
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  const response = await request('POST', `/conversations/${p.id}/messages`, p.a.token, '{',
    { raw: true, headers: { 'Content-Type': 'application/json' } });
  deny(response, [400]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('INPUT-002 server-owned profile and video fields cannot be mass assigned', async () => {
  const a = await user(), b = await user();
  const role = sql(`SELECT role FROM users WHERE id='${a.id}'`);
  const profile = await request('PUT', '/users/me', a.token,
    { display_name: 'T06 mass assignment', id: b.id, role: 'admin', deleted_at: null });
  assert.ok([200, 400].includes(profile.status));
  assert.equal(sql(`SELECT role FROM users WHERE id='${a.id}'`), role);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  const created = await request('POST', '/videos', a.token,
    validVideo({ user_id: b.id, status: 'ready' }));
  assert.ok([201, 400].includes(created.status));
  if (created.status === 201) {
    assert.equal(sql(`SELECT user_id, status FROM videos WHERE id='${created.data.id}'`), `${a.id}|recording`);
  }
});

test('INPUT-003 safe SQL metacharacters in search cannot disclose private accounts', async () => {
  const a = await user(), b = await user();
  const before = sql('SELECT count(*) FROM users');
  for (const email of ["' OR '1'='1", `${b.email}'--`, `x' UNION SELECT '${a.id}`]) {
    const response = await request('POST', '/users/search', a.token, { email });
    assert.ok([400, 200, 429].includes(response.status));
    assert.equal(response.data?.found, undefined);
    assert.doesNotMatch(response.raw, /syntax error|select .* from|postgres|jdbc/i);
  }
  assert.equal(sql('SELECT count(*) FROM users'), before);
});

test('INPUT-004 malformed cursor and object ID cannot read outsider data', async () => {
  const p = await pair(), c = await user();
  for (const path of [`/conversations/${p.id}/messages?cursor=' OR '1'='1`,
    `/conversations/${encodeURIComponent("' OR '1'='1")}`,
    `/videos?cursor=${encodeURIComponent("' OR '1'='1")}`]) {
    const response = await request('GET', path.replaceAll(' ', '%20'), c.token);
    assert.ok([400, 403, 404].includes(response.status), `${path}: ${response.status}`);
    assert.equal(response.raw.includes(p.a.email), false);
    assert.doesNotMatch(response.raw, /syntax error|jdbc|postgres/i);
  }
});

test('CONFIG-001 foreign Origin receives no CORS grant on preflight or actual response', async () => {
  const a = await user(), origin = 'https://foreign.example';
  const preflight = await fetch(`${base}/users/me`, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization',
  } });
  assert.notEqual(preflight.headers.get('access-control-allow-origin'), origin);
  assert.notEqual(preflight.headers.get('access-control-allow-origin'), '*');
  const actual = await fetch(`${base}/users/me`, { headers: {
    Origin: origin, Authorization: `Bearer ${a.token}`,
  } });
  assert.notEqual(actual.headers.get('access-control-allow-origin'), origin);
  assert.notEqual(actual.headers.get('access-control-allow-origin'), '*');
  await actual.arrayBuffer();
});
