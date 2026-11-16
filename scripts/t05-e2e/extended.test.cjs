const { test } = require('node:test');
const { createHash } = require('node:crypto');
const h = require('../t04-api/support.cjs');
const { assert, caseTest: tc, user, pair, uuid, ok, sql, redis, wait, message,
  avatarModel, readyVideo, messaging, signaling, Socket } = h;

test('T05-CON-007', { timeout: 120_000 }, async () => {
  const a = await user(), expected = new Set();
  for (let i = 0; i < 55; i += 1) {
    const b = await user();
    expected.add((await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201)).id);
  }
  const seen = new Set();
  let cursor;
  do {
    const page = await ok('GET', `/conversations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, a.token);
    for (const item of page.data) {
      assert.equal(seen.has(item.id), false, `Duplicate conversation ${item.id}`);
      seen.add(item.id);
    }
    cursor = page.next_cursor;
    if (!page.has_more) break;
    assert.ok(cursor);
  } while (seen.size < 56);
  assert.deepEqual([...seen].sort(), [...expected].sort());
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE user_a_id='${a.id}' OR user_b_id='${a.id}'`), '55');
});

test('T05-MSG-011', { timeout: 120_000 }, async () => {
  const p = await pair(), expected = new Set();
  const baseline = Date.now() - 120_000;
  for (let i = 0; i < 110; i += 1) {
    const id = uuid();
    const body = { id, content: `History ${i}`, client_timestamp: new Date(baseline + i * 1000).toISOString() };
    await ok('POST', `/conversations/${p.id}/messages`, p.a.token, body, 201);
    expected.add(id);
  }
  const seen = new Set();
  let cursor;
  do {
    const page = await ok('GET', `/conversations/${p.id}/messages?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, p.b.token);
    for (const item of page.data) {
      assert.equal(seen.has(item.id), false, `Duplicate message ${item.id}`);
      seen.add(item.id);
    }
    cursor = page.prev_cursor;
    if (!page.has_more) break;
    assert.ok(cursor);
  } while (seen.size < 111);
  assert.deepEqual([...seen].sort(), [...expected].sort());
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '110');
});

tc('T05-CROSS-002', async t => {
  const p = await pair(), one = await messaging(p.b, t), two = await messaging(p.b, t);
  const first = await message(p.a, p.id, 'Device first');
  assert.equal((await one.take('NEW_MESSAGE')).data.id, first.body.id);
  assert.equal((await two.take('NEW_MESSAGE')).data.id, first.body.id);
  await one.close();
  const second = await message(p.a, p.id, 'Device second');
  assert.equal((await two.take('NEW_MESSAGE')).data.id, second.body.id);
  const three = await messaging(p.b, t);
  assert.equal(three.seenPing, true);
  const ids = (await ok('GET', `/conversations/${p.id}/messages`, p.b.token)).data.map(x => x.id);
  assert.ok(ids.includes(first.body.id) && ids.includes(second.body.id));
  await ok('PUT', `/conversations/${p.id}/messages/${second.body.id}`, p.b.token, { status: 'read' });
  assert.equal(sql(`SELECT status FROM messages WHERE id='${second.body.id}'`), 'read');
});

tc('T05-CROSS-003', async t => {
  const p = await pair(), inbox = await messaging(p.b, t), sa = await signaling(p.a, t);
  const first = await message(p.a, p.id, 'Before call');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, first.body.id);
  const callId = uuid();
  sa.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: p.b.id, data: { sdp: 'T05 cross' } });
  assert.equal((await inbox.take('CALL_INCOMING')).data.call_id, callId);
  const sb = await signaling(p.b, t);
  assert.equal((await sb.take('CALL_OFFER')).call_id, callId);
  sb.send({ type: 'CALL_REJECT', call_id: callId, target_user_id: p.a.id, data: { reason: 'declined' } });
  assert.equal((await sa.take('CALL_REJECT')).call_id, callId);
  const second = await message(p.a, p.id, 'After call');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, second.body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '2');
});

tc('T05-CROSS-004', async () => {
  const a = await user(), model = await avatarModel(a.token);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  const v = await readyVideo(a), renamed = 'T05 complete journey';
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '0');
  await ok('PUT', `/videos/${v.item.id}`, a.token, { title: renamed });
  const detail = await ok('GET', `/videos/${v.item.id}`, a.token);
  const list = await ok('GET', '/videos', a.token);
  assert.equal(list.data.find(x => x.id === v.item.id)?.title, renamed);
  assert.equal(list.storage_used_bytes, v.first.length + v.last.length);
  const response = await fetch(detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(Buffer.concat([v.first, v.last])));
  await ok('DELETE', `/videos/${v.item.id}`, a.token, undefined, 204);
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${v.item.id}'`), 't');
});

tc('T05-CROSS-005', async t => {
  const p = await pair(), model = await avatarModel(p.a.token);
  await ok('PUT', '/avatars/me', p.a.token, { model_id: model.id }, 201);
  const sent = await message(p.a, p.id, 'Retained after logout');
  const v = await readyVideo(p.a);
  for (const path of ['/users/me', '/avatars/me', `/conversations/${p.id}/messages`, '/videos', `/videos/${v.item.id}`]) {
    await ok('GET', path, p.a.token);
  }
  await ok('POST', '/auth/logout', p.a.token, { refresh_token: p.a.refresh }, 204);
  for (const path of ['/users/me', '/avatars/me', `/conversations/${p.id}/messages`, '/videos', `/videos/${v.item.id}`]) {
    await ok('GET', path, p.a.token, undefined, 401);
  }
  await assert.rejects(() => new Socket(h.base.replace(/^http/, 'ws') + '/ws/messaging', p.a.token, t).open());
  const signal = await new Socket(h.signalingUrl, p.a.token, t).open();
  const end = Date.now() + 3000;
  while (!signal.closeCode && Date.now() < end) await wait(20);
  assert.equal(signal.closeCode, 4001);
  assert.equal((await ok('GET', '/users/me', p.b.token)).id, p.b.id);
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.b.token)).data.find(x => x.id === sent.body.id)?.content, sent.body.content);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${v.item.id}'`), 'ready');
});
