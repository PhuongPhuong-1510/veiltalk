'use strict';
const h = require('./support.cjs');
const { assert, caseTest: test, request, ok, uuid, user, parallel, pairCount, sql, password } = h;

const loginBody = owner => ({ email: owner.email, password: owner.password });
const refreshBody = owner => ({ refresh_token: owner.refresh });

test('T07-AUTH-004', async () => {
  const owner = await user();
  const before = Number(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${owner.id}'`));
  const { responses } = await parallel(() => request('POST', '/auth/refresh', null, refreshBody(owner)), 2);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const accessTokens = responses.map(response => response.data?.access_token);
  assert.ok(accessTokens.every(Boolean), 'Each reusable refresh must return an access token');
  assert.equal(new Set(accessTokens).size, 2, 'Concurrent refresh responses reused an access JWT');
  assert.equal(Number(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${owner.id}'`)), before,
    'Reusable refresh unexpectedly created/rotated a refresh row');
  for (const token of accessTokens) await ok('GET', '/users/me', token);
});

test('T07-AUTH-005', async () => {
  const owner = await user();
  const { responses } = await parallel(index => index === 0
    ? request('POST', '/auth/logout', owner.token, refreshBody(owner))
    : request('POST', '/auth/refresh', null, refreshBody(owner)), 2);
  const [logout, refresh] = responses;
  assert.equal(logout.status, 204, `Logout must establish the revoke point, got ${logout.status}`);
  assert.ok(refresh.status === 200 || refresh.status === 401,
    `Refresh in the race must resolve as success-before-revoke or unauthorized, got ${refresh.status}`);
  await ok('GET', '/users/me', owner.token, undefined, 401);
  await ok('POST', '/auth/refresh', null, refreshBody(owner), 401);
  if (refresh.status === 200) {
    await ok('GET', '/users/me', refresh.data.access_token, undefined, 401);
  }
});

test('T07-AUTH-006', async () => {
  const owner = await user();
  const { responses } = await parallel(() => request('POST', '/auth/login', null, loginBody(owner)), 10);
  assert.ok(responses.every(response => response.status === 200),
    `Concurrent login statuses=${responses.map(response => response.status)}`);
  const refreshTokens = responses.map(response => response.data?.tokens?.refresh_token);
  const accessTokens = responses.map(response => response.data?.tokens?.access_token);
  assert.equal(new Set(refreshTokens).size, 10, 'Concurrent login returned duplicate refresh tokens');
  assert.equal(new Set(accessTokens).size, 10, 'Concurrent login returned duplicate access tokens');
  assert.equal(Number(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${owner.id}'`)), 11,
    'Register refresh plus ten login refresh rows must be persisted');
});

// Race probes: client dispatch gate + database oracle. Critical-section overlap not instrumented.
test('T07-AUTH-007', async () => {
  const email = `t07-race-${uuid()}@example.com`;
  const body = { email, password: h.password, display_name: 'Race Registry', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` };
  const { responses } = await parallel(() => request('POST', '/auth/register', null, body), 4);
  assert.deepEqual(responses.map(x => x.status).sort(), [201,409,409,409].sort());
  assert.equal(sql(`SELECT count(*) FROM users WHERE email='${email}'`), '1');
  assert.equal(new Set(responses.filter(x => x.status === 201).map(x => x.data?.user?.id)).size, 1);
});

test('T07-AUTH-008', async () => {
  const owner = await user();
  const second = await ok('POST', '/auth/login', null, loginBody(owner));
  const { responses } = await parallel(index => index === 0
    ? request('DELETE', '/users/me', owner.token, { password })
    : request('GET', '/users/me', second.tokens.access_token), 2);
  assert.equal(responses[0].status, 204);
  assert.ok([200, 401].includes(responses[1].status),
    `In-flight request must linearize before/after deletion, got ${responses[1].status}`);
  assert.ok(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${owner.id}'`) === 't');
  for (const token of [owner.token, second.tokens.access_token]) {
    await ok('GET', '/users/me', token, undefined, 401);
  }
  for (const token of [owner.refresh, second.tokens.refresh_token]) {
    await ok('POST', '/auth/refresh', null, { refresh_token: token }, 401);
  }
});

test('T07-AUTH-011', async t => {
  const owner = await user();
  let socket;
  const { responses } = await parallel(index => {
    if (index === 0) return request('DELETE', '/users/me', owner.token, { password });
    if (index === 1) return request('POST', '/auth/refresh', null, refreshBody(owner));
    socket = new h.Socket(h.base.replace(/^http/, 'ws') + '/ws/messaging', owner.token, t);
    return socket.open().then(() => ({ status: 101 })).catch(error => ({ status: /401|403/.test(error.message) ? 401 : 599 }));
  }, 3);
  assert.equal(responses[0].status, 204);
  assert.ok([200, 401].includes(responses[1].status));
  assert.ok([101, 401].includes(responses[2].status));
  await ok('POST', '/auth/refresh', null, refreshBody(owner), 401);
  if (responses[1].status === 200) await ok('GET', '/users/me', responses[1].data.access_token, undefined, 401);
  const deadline = Date.now() + 6000;
  while (socket.closeCode === undefined && Date.now() < deadline) await h.wait(25);
  assert.notEqual(socket.closeCode, undefined, 'Socket opened during deletion remained usable');
});

test('T07-AUTH-012', async () => {
  const a = await user(), b = await user(), c = await user();
  const { responses } = await parallel(index => {
    if (index === 0) return request('POST', '/auth/logout', a.token, refreshBody(a));
    if (index === 1) return request('POST', '/auth/refresh', null, refreshBody(b));
    return request('POST', '/auth/login', null, loginBody(c));
  }, 3);
  assert.deepEqual(responses.map(response => response.status), [204, 200, 200]);
  await ok('GET', '/users/me', a.token, undefined, 401);
  const bProfile = await ok('GET', '/users/me', responses[1].data.access_token);
  const cProfile = await ok('GET', '/users/me', responses[2].data.tokens.access_token);
  assert.equal(bProfile.id, b.id);
  assert.equal(cProfile.id, c.id);
});

test('T07-CONV-001', async () => {
  const a = await user(), b = await user();
  const { responses } = await parallel(i => request('POST', '/conversations', i === 0 ? a.token : b.token,
    { other_user_id: i === 0 ? b.id : a.id }), 2);
  assert.deepEqual(responses.map(x => x.status).sort(), [200,201]);
  assert.equal(new Set(responses.map(x => x.data?.id)).size, 1);
  assert.equal(pairCount(a.id,b.id), 1);
});

test('T07-CONV-002', async () => {
  const a = await user(), b = await user();
  const { responses } = await parallel(i => request('POST', '/conversations', i % 2 ? b.token : a.token,
    { other_user_id: i % 2 ? a.id : b.id }), 10);
  assert.deepEqual(responses.map(x => x.status).sort(), [201, ...Array(9).fill(200)].sort());
  assert.equal(new Set(responses.map(x => x.data?.id)).size, 1);
  assert.equal(pairCount(a.id,b.id), 1);
});

test('T07-CONV-003', async () => {
  const a = await user(), b = await user();
  const { responses } = await parallel(index => index === 0
    ? request('POST', '/conversations', a.token, { other_user_id: b.id })
    : request('DELETE', '/users/me', b.token, { password }), 2);
  assert.equal(responses[1].status, 204);
  assert.ok([201, 404].includes(responses[0].status),
    `Create must linearize before/after user deletion, got ${responses[0].status}`);
  assert.ok(pairCount(a.id, b.id) <= 1);
  const retry = await request('POST', '/conversations', a.token, { other_user_id: b.id });
  assert.equal(retry.status, 404, 'A conversation must not be created with an already deleted user');
});

test('T07-CONV-004', async () => {
  const p = await h.pair();
  const before = Date.parse(sql(`SELECT updated_at FROM conversations WHERE id='${p.id}'`));
  const bodies = Array.from({ length: 8 }, (_, index) => h.validMessage(`conversation touch ${index}`));
  const { responses } = await parallel(index => request('POST', `/conversations/${p.id}/messages`,
    index % 2 ? p.b.token : p.a.token, bodies[index]), bodies.length);
  assert.ok(responses.every(response => response.status === 201));
  const updated = Date.parse(sql(`SELECT updated_at FROM conversations WHERE id='${p.id}'`));
  assert.ok(updated >= before, 'Concurrent messages moved conversation.updated_at backwards');
  assert.equal(Number(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}' AND id IN (${bodies.map(body => `'${body.id}'`).join(',')})`)), bodies.length);
});

test('T07-CONV-008', async () => {
  const a = await user(), b = await user(), c = await user();
  const { responses } = await parallel(i => request('POST', '/conversations', a.token,
    { other_user_id: i ? c.id : b.id }), 2);
  assert.deepEqual(responses.map(x => x.status).sort(), [201,201]);
  assert.equal(pairCount(a.id,b.id), 1);
  assert.equal(pairCount(a.id,c.id), 1);
  assert.notEqual(responses[0].data?.id, responses[1].data?.id);
});

