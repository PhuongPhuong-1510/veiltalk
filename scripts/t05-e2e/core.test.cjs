const h = require('../t04-api/support.cjs');
const { createHash } = require('node:crypto');
const { assert, caseTest: test, user, pair, uuid, ok, request, sql, redis, wait,
  password, validMessage, message, messaging, readyVideo, video, abortVideo } = h;

test('T05-ACC-001', async () => {
  const a = await user();
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal(login.user.id, a.id);
  assert.equal((await ok('GET', '/users/me', login.tokens.access_token)).id, a.id);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id='${a.id}'`), '1');
});

test('T05-ACC-002', async () => {
  const a = await user();
  const oldHash = sql(`SELECT password_hash FROM users WHERE id='${a.id}'`);
  await ok('POST', '/auth/register', null, {
    email: a.email, password: 'Changed123!', display_name: 'Other', username: `u${uuid().replaceAll('-', '').slice(0, 20)}`,
  }, 409);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal(login.user.id, a.id);
  assert.equal(sql(`SELECT count(*) FROM users WHERE email='${a.email}'`), '1');
  assert.equal(sql(`SELECT password_hash FROM users WHERE id='${a.id}'`), oldHash);
});

test('T05-ACC-003', async () => {
  const a = await user();
  const before = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`);
  await ok('POST', '/auth/login', null, { email: a.email, password: 'Wrong123!' }, 401);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`), before);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal((await ok('GET', '/users/me', login.tokens.access_token)).id, a.id);
});

test('T05-ACC-004', async () => {
  const a = await user();
  const refreshed = await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh });
  assert.equal((await ok('GET', '/users/me', refreshed.access_token)).id, a.id);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id='${a.id}'`), '1');
});

test('T05-ACC-005', async () => {
  const a = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh }, 401);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NOT NULL`), '1');
});

test('T05-CON-001', async () => {
  const p = await pair();
  assert.equal((await ok('GET', `/conversations/${p.id}`, p.a.token)).id, p.id);
  assert.equal((await ok('GET', `/conversations/${p.id}`, p.b.token)).id, p.id);
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${p.id}'`), '1');
});

test('T05-CON-002', async () => {
  const p = await pair();
  assert.equal((await ok('POST', '/conversations', p.a.token, { other_user_id: p.b.id }, 200)).id, p.id);
  assert.equal((await ok('POST', '/conversations', p.b.token, { other_user_id: p.a.id }, 200)).id, p.id);
  for (const owner of [p.a, p.b]) {
    const list = await ok('GET', '/conversations', owner.token);
    assert.equal(list.data.filter(x => x.id === p.id).length, 1);
  }
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${p.id}'`), '1');
});

test('T05-CON-005', async () => {
  const p = await pair();
  const sent = await message(p.a, p.id, 'Last message T05');
  for (const owner of [p.a, p.b]) {
    const detail = await ok('GET', `/conversations/${p.id}`, owner.token);
    const list = await ok('GET', '/conversations', owner.token);
    const item = list.data.find(x => x.id === p.id);
    assert.equal(detail.last_message.content, sent.body.content);
    assert.equal(detail.last_message.sender_id, p.a.id);
    assert.equal(detail.last_message.client_timestamp, sent.data.client_timestamp);
    assert.equal(detail.last_message.status, sent.data.status);
    assert.equal(item.last_message.content, sent.body.content);
    assert.equal(item.last_message.sender_id, p.a.id);
    assert.deepEqual(item.last_message, detail.last_message);
    assert.equal((await ok('GET', `/conversations/${p.id}/messages`, owner.token)).data.find(x => x.id === sent.body.id)?.content, sent.body.content);
  }
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`), '1');
});

test('T05-MSG-001', async t => {
  const p = await pair(), inbox = await messaging(p.b, t);
  const sent = await message(p.a, p.id, 'T05 hello 👋');
  const event = await inbox.take('NEW_MESSAGE');
  assert.deepEqual(event.data, sent.data);
  for (const owner of [p.a, p.b]) {
    assert.equal((await ok('GET', `/conversations/${p.id}/messages`, owner.token)).data.find(x => x.id === sent.body.id)?.content, sent.body.content);
  }
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}' AND sender_id='${p.a.id}'`), '1');
});

test('T05-MSG-002', async t => {
  const p = await pair(), aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const first = await message(p.a, p.id, 'first');
  assert.equal((await bSocket.take('NEW_MESSAGE')).data.id, first.body.id);
  const second = await message(p.b, p.id, 'second');
  assert.equal((await aSocket.take('NEW_MESSAGE')).data.id, second.body.id);
  for (const owner of [p.a, p.b]) {
    const ids = (await ok('GET', `/conversations/${p.id}/messages`, owner.token)).data.map(x => x.id);
    assert.equal(ids.includes(first.body.id) && ids.includes(second.body.id), true);
  }
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '2');
});

test('T05-MSG-003', async t => {
  const p = await pair(), one = await messaging(p.b, t), two = await messaging(p.b, t);
  const sent = await message(p.a, p.id, 'two devices');
  assert.deepEqual((await one.take('NEW_MESSAGE')).data, sent.data);
  assert.deepEqual((await two.take('NEW_MESSAGE')).data, sent.data);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`), '1');
});

test('T05-MSG-004', async t => {
  const p = await pair(), inbox = await messaging(p.b, t), body = validMessage('retry');
  const created = await ok('POST', `/conversations/${p.id}/messages`, p.a.token, body, 201);
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, body.id);
  const retried = await ok('POST', `/conversations/${p.id}/messages`, p.a.token, body, 200);
  assert.deepEqual(retried, created);
  await wait(500);
  assert.equal(inbox.events.filter(x => x.type === 'NEW_MESSAGE' && x.data.id === body.id).length, 0);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`), '1');
});

test('T05-MSG-005', async t => {
  const p = await pair(), inbox = await messaging(p.b, t), body = validMessage('parallel retry');
  const responses = await Promise.all(Array.from({ length: 4 }, () => request('POST', `/conversations/${p.id}/messages`, p.a.token, body)));
  assert.deepEqual(responses.map(x => x.status).sort(), [200, 200, 200, 201]);
  assert.ok(responses.every(x => x.data.id === body.id));
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, body.id);
  await wait(500);
  assert.equal(inbox.events.filter(x => x.type === 'NEW_MESSAGE' && x.data.id === body.id).length, 0);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`), '1');
});

test('T05-WS-001', async t => {
  const p = await pair(), inbox = await messaging(p.b, t);
  assert.equal(inbox.seenPing, true);
  const sent = await message(p.a, p.id, 'WebSocket after login');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, sent.body.id);
});

test('T05-VID-002', async () => {
  const a = await user(), v = await readyVideo(a);
  const response = await fetch(v.detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(Buffer.concat([v.first, v.last])));
  assert.equal(v.detail.file_size_bytes, v.first.length + v.last.length);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${v.item.id}'`), 'ready');
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '0');
});

test('T05-VID-003', async () => {
  const a = await user(), v = await readyVideo(a);
  const list = await ok('GET', '/videos?status=ready', a.token);
  assert.equal(list.data.find(x => x.id === v.item.id)?.status, 'ready');
  assert.equal(list.storage_used_bytes, v.detail.file_size_bytes);
  assert.equal(sql(`SELECT file_size_bytes FROM videos WHERE id='${v.item.id}'`), String(v.detail.file_size_bytes));
});

test('T05-VID-005', async () => {
  const a = await user(), v = await readyVideo(a);
  const before = (await ok('GET', '/videos', a.token)).storage_used_bytes;
  await ok('DELETE', `/videos/${v.item.id}`, a.token, undefined, 204);
  await ok('GET', `/videos/${v.item.id}`, a.token, undefined, 404);
  const after = await ok('GET', '/videos', a.token);
  assert.equal(after.storage_used_bytes, before - v.detail.file_size_bytes);
  assert.equal(after.data.some(x => x.id === v.item.id), false);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${v.item.id}'`), 't');
});

test('T05-VID-006', async () => {
  const a = await user(), v = await video(a);
  assert.equal(redis('EXISTS', `video:upload:${v.id}`), '1');
  assert.equal((await abortVideo(a, v)).status, 204);
  assert.equal(redis('EXISTS', `video:upload:${v.id}`), '0');
  const late = await fetch(v.first_chunk_url, { method: 'PUT', body: 'late part', signal: AbortSignal.timeout(5000) });
  assert.equal(late.status, 404);
  await late.arrayBuffer();
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
});

test('T05-DEL-001', async () => {
  const a = await user(), b = await user();
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  await ok('POST', '/auth/login', null, { email: a.email, password }, 401);
  await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh }, 401);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${a.id}'`), 't');
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NULL`), '0');
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
});
