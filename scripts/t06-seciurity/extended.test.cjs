const h = require('../t04-api/support.cjs');
const { createHmac } = require('node:crypto');
const { test: longTest } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');
const { assert, caseTest: test, request, ok, user, pair, video,
  sql, redis, uuid, validMessage, message, wait, messaging, base, Socket } = h;

function signed(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', process.env.E2E_JWT_SECRET).update(input).digest('base64url')}`;
}
function accessClaims(owner) {
  const now = Math.floor(Date.now() / 1000);
  return { type: 'access', sub: owner.id, role: 'user', jti: uuid(), iat: now - 1, exp: now + 900 };
}
function deny(response, statuses = [401, 403, 404, 405]) {
  assert.ok(statuses.includes(response.status), `Expected denial; HTTP ${response.status}`);
  assert.doesNotMatch(response.raw, /stacktrace|password_hash|X-Amz-Signature|jdbc/i);
}

test('AUTH-016 valid refresh JWT without DB record cannot mint access', async () => {
  const a = await user(), now = Math.floor(Date.now() / 1000);
  const forged = signed({ type: 'refresh', jti: uuid(), iat: now - 1, exp: now + 900 });
  const before = sql('SELECT count(*) FROM refresh_tokens');
  deny(await request('POST', '/auth/refresh', null, { refresh_token: forged }), [401]);
  assert.equal(sql('SELECT count(*) FROM refresh_tokens'), before);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-017 logout with another user refresh token cannot revoke either session', async () => {
  const a = await user(), b = await user();
  const before = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id IN ('${a.id}','${b.id}') AND revoked_at IS NULL`);
  deny(await request('POST', '/auth/logout', a.token, { refresh_token: b.refresh }), [401]);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id IN ('${a.id}','${b.id}') AND revoked_at IS NULL`), before);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.ok((await ok('POST', '/auth/refresh', null, { refresh_token: b.refresh })).access_token);
});

test('AUTH-019 signed access JWT missing each required claim is rejected', async () => {
  const a = await user(), claims = accessClaims(a);
  for (const field of ['sub', 'exp', 'iat', 'jti', 'role', 'type']) {
    const variant = { ...claims }; delete variant[field];
    deny(await request('GET', '/users/me', signed(variant)), [401]);
  }
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-020 signed JWT with future iat or nonincreasing exp is rejected', async () => {
  const a = await user(), claims = accessClaims(a);
  for (const variant of [
    { ...claims, iat: claims.exp + 60, exp: claims.exp + 120 },
    { ...claims, exp: claims.iat },
    { ...claims, exp: claims.iat - 1 },
  ]) deny(await request('GET', '/users/me', signed(variant)), [401]);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-021 oversized and malformed JWT fail without disrupting valid access', async () => {
  const a = await user();
  for (const token of ['x'.repeat(12000), 'eyJ7.e30.bad', '{not-jwt}']) {
    const response = await request('GET', '/users/me', token);
    deny(response, [400, 401, 413, 431]);
  }
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-023 client Date header cannot revive an expired signed token', async () => {
  const a = await user(), claims = accessClaims(a);
  claims.iat = Math.floor(Date.now() / 1000) - 120;
  claims.exp = claims.iat + 60;
  const expired = signed(claims);
  for (const date of ['2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
    deny(await request('GET', '/users/me', null, undefined,
      { headers: { Authorization: `Bearer ${expired}`, Date: date, 'X-Client-Time': date } }), [401]);
  }
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('BFLA-009 method override cannot enter internal handlers or emit a call', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  const item = await video(a), before = sql(`SELECT status FROM videos WHERE id='${item.id}'`);
  for (const path of ['/internal/call/notify', '/internal/videos/webhook']) {
    for (const method of ['GET', 'PUT', 'PATCH', 'OPTIONS']) {
      const response = await request(method, path, null,
        ['GET', 'OPTIONS'].includes(method) ? undefined : { caller_id: a.id, callee_id: b.id },
        { headers: { 'X-HTTP-Method-Override': 'POST' } });
      assert.ok([200, 204, 401, 404, 405].includes(response.status));
    }
  }
  await wait(450);
  assert.equal(receiver.events.some(event => event.type === 'CALL_INCOMING'), false);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), before);
});

test('BFLA-010 unsigned role change in JWT cannot grant admin identity', async () => {
  const a = await user(), parts = a.token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.role = 'admin';
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  deny(await request('GET', '/users/me', parts.join('.')), [401]);
  assert.equal(sql(`SELECT role FROM users WHERE id='${a.id}'`), 'user');
  assert.equal((await ok('GET', '/users/me', a.token)).role, 'user');
});

test('BFLA-011 response-only video fields cannot update owner, status or timestamps', async () => {
  const a = await user(), b = await user(), item = await video(a);
  const before = sql(`SELECT user_id, status, created_at, file_size_bytes FROM videos WHERE id='${item.id}'`);
  const response = await request('PUT', `/videos/${item.id}`, a.token,
    { title: 'valid title', user_id: b.id, status: 'ready', created_at: '2000-01-01T00:00:00Z',
      file_size_bytes: 0, etag: 'forged' });
  assert.ok([200, 400].includes(response.status));
  assert.equal(sql(`SELECT user_id, status, created_at, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('BFLA-012 wrong or blank password cannot delete account or revoke token', async () => {
  const a = await user(), item = await video(a);
  for (const password of ['Wrong123!', '']) {
    const response = await request('DELETE', '/users/me', a.token, { password });
    deny(response, [400, 401]);
  }
  assert.equal(sql(`SELECT deleted_at IS NULL FROM users WHERE id='${a.id}'`), 't');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.ok((await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh })).access_token);
});

test('BFLA-013 unregistered methods and lookalike internal paths have no privileged effect', async t => {
  const a = await user(), b = await user(), receiver = await messaging(b, t);
  for (const path of ['/Internal/call/notify', '/internal/call/notify/',
    '/internal/videos/webhook/', '/internal/videos/Webhook']) {
    const response = await request('POST', path, null,
      { caller_id: a.id, callee_id: b.id, call_id: uuid() });
    assert.ok([401, 404, 405].includes(response.status));
  }
  for (const method of ['GET', 'PUT', 'PATCH']) {
    const response = await request(method, '/internal/call/notify', null,
      method === 'GET' ? undefined : { caller_id: a.id, callee_id: b.id });
    assert.ok([401, 404, 405].includes(response.status));
  }
  await wait(450);
  assert.equal(receiver.events.some(event => event.type === 'CALL_INCOMING'), false);
});

test('BFLA-014 CORS preflight does not grant authorization to actual request', async () => {
  const a = await user();
  const preflight = await fetch(`${base}/users/me`, { method: 'OPTIONS', headers: {
    Origin: 'https://foreign.example', 'Access-Control-Request-Method': 'GET',
  } });
  assert.notEqual(preflight.headers.get('access-control-allow-origin'), 'https://foreign.example');
  const response = await request('GET', '/users/me', null, undefined,
    { headers: { Origin: 'https://foreign.example' } });
  deny(response, [401, 403]);
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://foreign.example');
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('WSM-011 malformed JSON and missing type cause protocol errors without DB writes', async t => {
  const p = await pair(), socket = await messaging(p.a, t);
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  socket.ws.send('{');
  assert.equal((await socket.take('ERROR')).data.code, 'VALIDATION_ERROR');
  socket.send({ data: { conversation_id: p.id } });
  assert.equal((await socket.take('ERROR')).data.code, 'VALIDATION_ERROR');
  assert.equal(socket.ws.readyState, 1);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('WSM-010 open messaging socket stops receiving after signed token expiry', async t => {
  const p = await pair();
  const now = Math.floor(Date.now() / 1000);
  const shortToken = signed({ type: 'access', sub: p.a.id, role: 'user',
    jti: uuid(), iat: now - 1, exp: now + 4 });
  const socket = await messaging({ token: shortToken }, t);
  const deadline = Date.now() + 8000;
  while (!socket.closeCode && Date.now() < deadline) await wait(50);
  assert.equal(socket.closeCode, 4002);
  const sent = await message(p.b, p.id, `after-expiry-${uuid()}`);
  await wait(400);
  assert.equal(socket.events.some(event => JSON.stringify(event).includes(sent.body.content)), false);
});

test('WSM-013 oversized frame closes its socket without affecting another user', async t => {
  const p = await pair(), attacker = await messaging(p.a, t), recipient = await messaging(p.b, t);
  attacker.ws.send('x'.repeat(40000));
  const deadline = Date.now() + 5000;
  while (!attacker.closeCode && Date.now() < deadline) await wait(25);
  assert.ok(attacker.closeCode, 'Oversized frame did not close the socket');
  assert.equal(recipient.ws.readyState, 1);
  recipient.send({ type: 'PONG' });
  assert.equal(recipient.ws.readyState, 1);
});

test('WSM-015 forged PONG fields do not grant conversation access', async t => {
  const p = await pair(), c = await user();
  const outsider = await messaging(c, t), recipient = await messaging(p.b, t);
  outsider.send({ type: 'PONG', user_id: p.a.id,
    data: { user_id: p.a.id, conversation_id: p.id } });
  outsider.send({ type: 'TYPING', data: { conversation_id: p.id } });
  assert.equal((await outsider.take('ERROR')).data.code, 'FORBIDDEN');
  await wait(400);
  assert.equal(recipient.events.some(event => event.type === 'TYPING'), false);
});

test('WSM-016 revoking one login token does not close another token socket', async t => {
  const a = await user();
  const otherLogin = await ok('POST', '/auth/login', null, { email: a.email, password: a.password });
  const first = await messaging(a, t);
  const second = await messaging({ token: otherLogin.tokens.access_token }, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  const deadline = Date.now() + 6000;
  while (!first.closeCode && Date.now() < deadline) await wait(50);
  assert.ok(first.closeCode);
  assert.equal(second.ws.readyState, 1);
  second.send({ type: 'PONG' });
  assert.equal((await ok('GET', '/users/me', otherLogin.tokens.access_token)).id, a.id);
});

test('WSM-017 rejected handshake does not write full JWT into backend log', async t => {
  const a = await user(), parts = a.token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const bad = parts.join('.');
  const socket = new Socket(base.replace(/^http/, 'ws') + '/ws/messaging', bad, t);
  let refused = false;
  try { await socket.open(); } catch (error) {
    assert.match(error.message, /Unexpected server response: (401|403)/);
    refused = true;
  }
  assert.equal(refused, true);
  await wait(100);
  const log = readFileSync(resolve(process.env.E2E_RESULT_DIR, 'backend.log'), 'utf8');
  assert.equal(log.includes(a.token), false);
  assert.equal(log.includes(bad), false);
});

test('WSM-018 heartbeat PONG cannot preserve revoked socket access', async t => {
  const p = await pair(), revoked = await messaging(p.a, t), valid = await messaging(p.b, t);
  await ok('POST', '/auth/logout', p.a.token, { refresh_token: p.a.refresh }, 204);
  if (revoked.ws.readyState === 1) revoked.send({ type: 'PONG' });
  const deadline = Date.now() + 6000;
  while (!revoked.closeCode && Date.now() < deadline) await wait(50);
  assert.ok(revoked.closeCode);
  const sent = await message(p.b, p.id, `heartbeat-after-revoke-${uuid()}`);
  await wait(400);
  assert.equal(revoked.events.some(event => JSON.stringify(event).includes(sent.body.content)), false);
  assert.equal(valid.ws.readyState, 1);
});

test('WSM-019 outsider reconnect receives no buffered private event', async t => {
  const p = await pair(), c = await user();
  const first = await messaging(c, t);
  await first.close();
  const sent = await message(p.a, p.id, `private-before-reconnect-${uuid()}`);
  const second = await messaging(c, t);
  await wait(450);
  assert.equal(second.events.some(event => JSON.stringify(event).includes(sent.body.content)), false);
  assert.equal(second.events.some(event => event.type === 'NEW_MESSAGE'), false);
});

test('INPUT-005 null, object and array values cannot create malformed messages', async () => {
  const p = await pair();
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  for (const content of [null, { nested: true }, ['array']]) {
    const response = await request('POST', `/conversations/${p.id}/messages`, p.a.token,
      { ...validMessage(), content });
    deny(response, [400]);
  }
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('INPUT-006 deeply nested or long invalid field is bounded and leaves DB unchanged', async () => {
  const p = await pair();
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  let nested = 'leaf';
  for (let i = 0; i < 120; i++) nested = { child: nested };
  for (const content of [nested, 'x'.repeat(100000)]) {
    const response = await request('POST', `/conversations/${p.id}/messages`, p.a.token,
      { ...validMessage(), content });
    deny(response, [400, 413]);
  }
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('INPUT-010 CRLF in display name cannot inject response headers', async () => {
  const a = await user();
  const response = await request('PUT', '/users/me', a.token,
    { display_name: 'T06\r\nX-Injected: yes' });
  assert.ok([200, 400].includes(response.status));
  assert.equal(response.headers.get('x-injected'), null);
  assert.equal(response.headers.get('location'), null);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('INPUT-009 video format cannot add path traversal segments to object key', async () => {
  const a = await user();
  for (const format of ['../', 'x/y', 'x\\y', '%2F']) {
    const response = await request('POST', '/videos', a.token,
      { title: 'format safety', estimated_size_bytes: 1,
        chunk_size_bytes: 5242880, format });
    assert.ok([201, 400].includes(response.status));
    if (response.status === 201) {
      const key = sql(`SELECT storage_path FROM videos WHERE id='${response.data.id}'`);
      assert.match(key, /^videos\/[0-9a-f-]+\/source\.[A-Za-z0-9_]{1,10}$/);
      assert.equal(key.includes('..'), false);
      await ok('POST', `/videos/${response.data.id}/abort`, a.token,
        { upload_id: response.data.upload_id }, 204);
    }
  }
});

test('INPUT-011 unsupported content types cannot create a conversation', async () => {
  const a = await user(), b = await user();
  const before = sql('SELECT count(*) FROM conversations');
  for (const contentType of ['text/plain', 'application/octet-stream', 'multipart/form-data']) {
    const response = await request('POST', '/conversations', a.token,
      JSON.stringify({ other_user_id: b.id }),
      { raw: true, headers: { 'Content-Type': contentType } });
    deny(response, [400, 415]);
  }
  assert.equal(sql('SELECT count(*) FROM conversations'), before);
});

test('INPUT-012 method override cannot turn a read into an authorized write', async () => {
  const a = await user(), b = await user(), before = sql('SELECT count(*) FROM conversations');
  for (const method of ['GET', 'PUT', 'PATCH']) {
    const response = await request(method, '/conversations', a.token,
      method === 'GET' ? undefined : { other_user_id: b.id },
      { headers: { 'X-HTTP-Method-Override': 'POST' } });
    assert.ok([200, 400, 404, 405].includes(response.status));
  }
  assert.equal(sql('SELECT count(*) FROM conversations'), before);
});

test('INPUT-014 validation, missing object and conflict errors hide internals', async () => {
  const a = await user();
  const responses = [
    await request('POST', '/videos', a.token, { title: '' }),
    await request('GET', `/videos/${uuid()}`, a.token),
    await request('POST', '/auth/register', null,
      { email: a.email, password: a.password, display_name: 'duplicate', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` }),
  ];
  assert.deepEqual(responses.map(r => r.status), [400, 404, 409]);
  for (const response of responses) {
    assert.equal(typeof response.data?.error?.code, 'string');
    assert.doesNotMatch(response.raw, /stacktrace|exception|org\.springframework|jdbc:|select .* from|password_hash/i);
  }
});

test('INPUT-015 extreme page limits and malformed cursors cannot bypass caps', async () => {
  const a = await user();
  for (const path of ['/videos?limit=-999999999999', '/videos?limit=999999999999',
    '/conversations?limit=-1', '/conversations?limit=999999999999']) {
    const response = await request('GET', path, a.token);
    assert.ok([200, 400].includes(response.status));
    if (response.status === 200) assert.ok(response.data.data.length <= 100);
  }
  for (const path of ['/videos?cursor=not-a-cursor',
    '/conversations?cursor=not-a-cursor']) deny(await request('GET', path, a.token), [400]);
});

test('INPUT-016 unsupported Content-Encoding cannot run protected business action', async () => {
  const a = await user(), b = await user(), before = sql('SELECT count(*) FROM conversations');
  for (const encoding of ['gzip', 'br', 'compress']) {
    const response = await request('POST', '/conversations', a.token,
      JSON.stringify({ other_user_id: b.id }),
      { raw: true, headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding } });
    deny(response, [400, 415]);
  }
  assert.equal(sql('SELECT count(*) FROM conversations'), before);
});

test('INPUT-007 Unicode survives while invalid control characters are rejected without writes', async () => {
  const a = await user({ display_name: 'Nguyễn 😀' });
  assert.equal((await ok('GET', '/users/me', a.token)).display_name, 'Nguyễn 😀');
  const p = await pair();
  const formatted = 'Xin chào 😀\t dòng hai\r\ncuối';
  const sent = await ok('POST', `/conversations/${p.id}/messages`, p.a.token, validMessage(formatted), 201);
  assert.equal(sent.content, formatted);
  const originalName = (await ok('GET', '/users/me', a.token)).display_name;
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  for (const value of ['bad\u0000name', 'bad\u0001name', 'bad\u007fname']) {
    const profile = await request('PUT', '/users/me', a.token, { display_name: value });
    assert.equal(profile.status, 400, `display_name control was accepted: ${value.charCodeAt(3)}`);
    const sentInvalid = await request('POST', `/conversations/${p.id}/messages`, p.a.token, validMessage(value));
    assert.equal(sentInvalid.status, 400, `message control was accepted: ${value.charCodeAt(3)}`);
  }
  assert.equal((await ok('GET', '/users/me', a.token)).display_name, originalName);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('INPUT-013 duplicate sensitive JSON keys return 400 before any mutation', async () => {
  const a = await user(), b = await user(), c = await user();
  const headers = { 'Content-Type': 'application/json' };
  const beforeConversations = sql('SELECT count(*) FROM conversations');
  const duplicatePeer = `{"other_user_id":"${b.id}","other_user_id":"${c.id}"}`;
  const conversation = await request('POST', '/conversations', a.token, duplicatePeer, { raw: true, headers });
  assert.equal(conversation.status, 400);
  assert.equal(sql('SELECT count(*) FROM conversations'), beforeConversations);
  const beforeVideos = sql('SELECT count(*) FROM videos');
  const duplicateFormat = '{"title":"duplicate","estimated_size_bytes":5242900,"chunk_size_bytes":5242880,"format":"mp4","format":"webm"}';
  const created = await request('POST', '/videos', a.token, duplicateFormat, { raw: true, headers });
  assert.equal(created.status, 400);
  assert.equal(sql('SELECT count(*) FROM videos'), beforeVideos);
  const item = await video(a);
  const duplicateUpload = `{"upload_id":"${item.upload_id}","upload_id":"forged"}`;
  const abort = await request('POST', `/videos/${item.id}/abort`, a.token, duplicateUpload, { raw: true, headers });
  assert.equal(abort.status, 400);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('ABUSE-002 search rate limit for one account does not block another', async () => {
  const a = await user(), b = await user(), body = { email: `${uuid()}@example.com` };
  const seconds = Math.floor(Date.now() / 1000) % 60;
  if (seconds > 48) await wait((62 - seconds) * 1000);
  for (let i = 0; i < 10; i++) assert.equal((await request('POST', '/users/search', a.token, body)).status, 200);
  assert.equal((await request('POST', '/users/search', a.token, body)).status, 429);
  assert.equal((await request('POST', '/users/search', b.token, body)).status, 200);
});

test('ABUSE-003 client metrics second event inside three seconds is rate limited', async () => {
  const a = await user(), body = { session_type: 'preview', fps: 30,
    timestamp: new Date().toISOString() };
  assert.equal((await request('POST', '/metrics/client', a.token, body)).status, 204);
  const blocked = await request('POST', '/metrics/client', a.token, body);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('ABUSE-008 messaging WS caps twenty attempts per IP and five live sessions per user', async t => {
  const a = await user(), b = await user();
  const sockets = [];
  for (let i = 0; i < 5; i++) sockets.push(await messaging(a, t));
  const sixth = new Socket(base.replace(/^http/, 'ws') + '/ws/messaging', a.token, t);
  await assert.rejects(sixth.open(), /Unexpected server response: 429/);
  await sockets[0].close();
  for (let i = 0; i < 100 && sockets[0].ws.readyState !== WebSocket.CLOSED; i++) await wait(20);
  assert.equal(sockets[0].ws.readyState, WebSocket.CLOSED);
  const replacement = await messaging(a, t);
  assert.equal(replacement.ws.readyState, WebSocket.OPEN);

  const endpoint = `${base.replace(/^http/, 'ws')}/ws/messaging?token=${encodeURIComponent(b.token)}`;
  async function attempt(ip) {
    const socket = new WebSocket(endpoint, { headers: { 'X-Forwarded-For': ip } });
    socket.on('error', () => {});
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { socket.terminate(); fail(new Error('WS attempt timed out')); }, 5000);
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timer); response.resume(); done({ status: response.statusCode });
      });
      socket.once('open', () => {
        socket.once('close', () => { clearTimeout(timer); done({ status: 101 }); });
        socket.close();
      });
    });
  }
  for (let i = 0; i < 20; i++) assert.equal((await attempt('198.51.100.42')).status, 101);
  assert.equal((await attempt('198.51.100.42')).status, 429);
  assert.equal((await attempt('198.51.100.43')).status, 101);
});

test('ABUSE-004 changing X-Forwarded-For cannot bypass per-user search limit', async () => {
  const a = await user(), body = { email: `${uuid()}@example.com` };
  const seconds = Math.floor(Date.now() / 1000) % 60;
  if (seconds > 48) await wait((62 - seconds) * 1000);
  for (let i = 0; i < 10; i++) {
    const response = await request('POST', '/users/search', a.token, body,
      { headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } });
    assert.equal(response.status, 200);
  }
  const blocked = await request('POST', '/users/search', a.token, body,
    { headers: { 'X-Forwarded-For': '203.0.113.254' } });
  assert.equal(blocked.status, 429);
});

longTest('ABUSE-005 search limit expires and allows valid requests again',
  { timeout: 90000 }, async () => {
    const a = await user(), body = { email: `${uuid()}@example.com` };
    const seconds = Math.floor(Date.now() / 1000) % 60;
    if (seconds > 48) await wait((62 - seconds) * 1000);
    const window = Math.floor(Date.now() / 60000);
    for (let i = 0; i < 10; i++) {
      assert.equal((await request('POST', '/users/search', a.token, body)).status, 200);
    }
    assert.equal((await request('POST', '/users/search', a.token, body)).status, 429);
    const key = `rate:user-search:${a.id}:${window}`;
    const ttl = Number(redis('TTL', key));
    assert.ok(ttl > 0 && ttl <= 60, `Unexpected TTL ${ttl}`);
    await wait((ttl + 2) * 1000);
    assert.equal(redis('EXISTS', key), '0');
    assert.equal((await request('POST', '/users/search', a.token, body)).status, 200);
  });

test('ABUSE-009 repeated invalid WS events close only the offending socket', async t => {
  const a = await user(), b = await user();
  const bad = await messaging(a, t), good = await messaging(b, t);
  for (let i = 0; i < 3; i++) {
    bad.send({ type: 'UNSUPPORTED_T06' });
    assert.equal((await bad.take('ERROR')).data.code, 'UNSUPPORTED_EVENT');
  }
  const deadline = Date.now() + 5000;
  while (!bad.closeCode && Date.now() < deadline) await wait(25);
  assert.equal(bad.closeCode, 1008);
  assert.equal(good.ws.readyState, 1);
});

test('ABUSE-010 over-quota admission is per user and does not create video', async () => {
  const a = await user(), b = await user();
  const before = sql(`SELECT count(*) FROM videos WHERE user_id='${a.id}'`);
  const response = await request('POST', '/videos', a.token,
    { title: 'over quota', estimated_size_bytes: 2147483649,
      chunk_size_bytes: 5242880, format: 'webm' });
  assert.equal(response.status, 507);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE user_id='${a.id}'`), before);
  assert.equal((await request('POST', '/videos', b.token,
    { title: 'within quota', estimated_size_bytes: 1,
      chunk_size_bytes: 5242880, format: 'webm' })).status, 201);
});

test('ABUSE-012 one invalid WS client does not break another user session', async t => {
  const p = await pair(), bad = await messaging(p.a, t), good = await messaging(p.b, t);
  for (let i = 0; i < 3; i++) {
    bad.ws.send('{');
    assert.equal((await bad.take('ERROR')).data.code, 'VALIDATION_ERROR');
  }
  const deadline = Date.now() + 5000;
  while (!bad.closeCode && Date.now() < deadline) await wait(25);
  assert.equal(bad.closeCode, 1008);
  good.send({ type: 'PONG' });
  assert.equal(good.ws.readyState, 1);
  assert.equal((await ok('GET', '/users/me', p.b.token)).id, p.b.id);
});
