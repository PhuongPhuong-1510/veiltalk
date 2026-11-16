const h = require('../t04-api/support.cjs');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  assert, caseTest: test, request, ok, user, pair, video, validMessage,
  sql, uuid, wait, messaging, base,
} = h;

function serviceLogs() {
  return ['backend.log', 'signaling.log', 'build.log']
    .map(name => readFileSync(resolve(process.env.E2E_RESULT_DIR, name), 'utf8'))
    .join('\n');
}

function assertNoInternalDetails(value) {
  assert.doesNotMatch(value, /(?:org\.springframework|com\.veiltalk)\.[A-Za-z0-9_.$]+/i);
  assert.doesNotMatch(value, /(?:jdbc:postgresql|password_hash|stack\s*trace|\bat\s+[A-Za-z0-9_.$]+\([^\r\n]+\.java:\d+\))/i);
  assert.doesNotMatch(value, /(?:SELECT|INSERT|UPDATE|DELETE)\s+[^\r\n]*(?:FROM|INTO|SET)\s+/i);
  assert.doesNotMatch(value, /(?:[A-Za-z]:\\|\/(?:home|app|workspace|project)\/)[^\s"']+/i);
}

function assertCorsDenied(response, origin) {
  assert.notEqual(response.headers.get('access-control-allow-origin'), origin);
  assert.notEqual(response.headers.get('access-control-allow-credentials'), 'true');
}

test('INPUT-008 HTML and script remain inert text in display_name and messages', async () => {
  const p = await pair();
  const displayName = `<script>t06_${uuid().slice(0, 8)}</script>`;
  const content = `<svg onload="globalThis.__t06='${uuid()}'"></svg><script>alert(2)</script>`;

  const profile = await request('PUT', '/users/me', p.a.token, { display_name: displayName });
  assert.equal(profile.status, 200, `Profile HTML text returned HTTP ${profile.status}`);
  assert.equal(profile.data?.display_name, displayName);
  assert.equal((await ok('GET', '/users/me', p.a.token)).display_name, displayName);
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${p.a.id}'`), displayName);

  const sent = await request('POST', `/conversations/${p.id}/messages`, p.a.token,
    validMessage(content));
  assert.equal(sent.status, 201, `Message HTML text returned HTTP ${sent.status}`);
  assert.equal(sent.data?.content, content);
  const history = await ok('GET', `/conversations/${p.id}/messages`, p.b.token);
  assert.equal(history.data.find(item => item.id === sent.data.id)?.content, content);
  assert.equal(sql(`SELECT content FROM messages WHERE id='${sent.data.id}'`), content);
  for (const response of [profile, sent]) {
    assertNoInternalDetails(response.raw);
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /^text\/html/i);
  }
  assert.equal((await request('GET', '/actuator/health', null)).status, 200);
});

test('CONFIG-008 unknown and invalid requests do not expose stack traces or internals', async () => {
  const a = await user();
  const cases = [
    await request('GET', `/not-a-route-${uuid()}`, a.token),
    await request('GET', `/videos/${uuid()}`, a.token),
    await request('POST', '/auth/login', null, '{', {
      raw: true, headers: { 'Content-Type': 'application/json' },
    }),
    await request('POST', '/videos', a.token, { title: 'bad', estimated_size_bytes: -1 }),
  ];
  assert.equal(cases[0].status, 404);
  assert.ok(cases.slice(1).every(response => response.status >= 400 && response.status < 500));
  for (const response of cases) {
    assertNoInternalDetails(response.raw);
    assert.equal(response.raw.includes(process.env.E2E_JWT_SECRET), false);
    assert.equal(response.raw.includes(process.env.E2E_CALL_SECRET), false);
    assert.equal(response.raw.includes(process.env.E2E_WEBHOOK_SECRET), false);
  }
});

test('LOG-001 access and refresh tokens never appear in service logs', async () => {
  const a = await user();
  const login = await ok('POST', '/auth/login', null, { email: a.email, password: a.password });
  const refreshed = await ok('POST', '/auth/refresh', null,
    { refresh_token: login.tokens.refresh_token });
  await ok('POST', '/auth/logout', refreshed.access_token,
    { refresh_token: login.tokens.refresh_token }, 204);
  await wait(150);
  const logs = serviceLogs();
  for (const secret of [a.token, a.refresh, login.tokens.access_token,
    login.tokens.refresh_token, refreshed.access_token]) {
    assert.equal(logs.includes(secret), false, 'A raw access/refresh token was written to a service log');
  }
  assert.doesNotMatch(logs, /\bBearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
});

test('LOG-005 error responses hide SQL, implementation classes and filesystem paths', async () => {
  const a = await user();
  const duplicate = await request('POST', '/auth/register', null,
    { email: a.email, password: a.password, display_name: 'duplicate', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` });
  const malformed = await request('POST', '/auth/login', null, '{', {
    raw: true, headers: { 'Content-Type': 'application/json' },
  });
  const missing = await request('GET', `/videos/${uuid()}`, a.token);
  const item = await video(a);
  const storage = await request('POST', `/videos/${item.id}/finalize`, a.token,
    { upload_id: `${item.upload_id}-wrong`, duration_secs: 1,
      parts: [{ part_number: 1, etag: 'not-an-etag' }] });
  for (const response of [duplicate, malformed, missing, storage]) {
    assert.ok(response.status >= 400 && response.status < 500, `Unexpected HTTP ${response.status}`);
    assertNoInternalDetails(response.raw);
  }
});

test('CROSS-007 validation failures across messaging and video leak no credentials or private payload', async t => {
  const p = await pair();
  const privateText = `private-${uuid()}`;
  const sent = await ok('POST', `/conversations/${p.id}/messages`, p.b.token,
    validMessage(privateText), 201);
  const item = await video(p.a);
  const socket = await messaging(p.a, t);
  socket.send({ type: 'TYPING', data: { conversation_id: uuid() } });
  const wsError = await socket.take('ERROR');
  const badMessage = await request('POST', `/conversations/${p.id}/messages`, p.a.token,
    { id: uuid(), content: '', client_timestamp: 'invalid' });
  const badVideo = await request('POST', `/videos/${item.id}/finalize`, p.a.token,
    { upload_id: 'wrong', duration_secs: -1, parts: [] });
  const evidence = [badMessage.raw, badVideo.raw, JSON.stringify(wsError), serviceLogs()].join('\n');
  for (const secret of [p.a.token, p.a.refresh, p.b.token, p.b.refresh,
    item.upload_id, item.first_chunk_url, process.env.E2E_CALL_SECRET,
    process.env.E2E_WEBHOOK_SECRET]) {
    assert.equal(evidence.includes(secret), false, 'Cross-module error evidence leaked a credential');
  }
  assert.equal(evidence.includes(privateText), false, 'Error evidence leaked another user message');
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.b.token))
    .data.some(message => message.id === sent.id), true);
  assertNoInternalDetails([badMessage.raw, badVideo.raw, JSON.stringify(wsError)].join('\n'));
});

test('CROSS-008 CORS does not replace authentication or object authorization', async () => {
  const origin = 'https://foreign.example';
  const p = await pair(), outsider = await user();
  const preflight = await fetch(`${base}/users/me`, { method: 'OPTIONS', headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization',
  } });
  assertCorsDenied(preflight, origin);

  const noToken = await fetch(`${base}/users/me`, { headers: { Origin: origin } });
  assertCorsDenied(noToken, origin);
  assert.ok([401, 403].includes(noToken.status));

  const directWithoutToken = await request('GET', '/users/me', null);
  assert.equal(directWithoutToken.status, 401);

  const direct = await request('GET', '/users/me', p.a.token);
  assert.equal(direct.status, 200);
  assert.equal(direct.data.id, p.a.id);
  const forbidden = await request('GET', `/conversations/${p.id}`, outsider.token);
  assert.ok([403, 404].includes(forbidden.status));
});
