const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, ok, user, pair, video, validVideo,
  validMessage, message, sql, redis, uuid, avatarModel, messaging, wait } = h;

function denied(response, statuses = [403, 404]) {
  assert.ok(statuses.includes(response.status), `Expected ${statuses}; HTTP ${response.status}`);
  assert.equal(response.data?.view_url, undefined);
  assert.doesNotMatch(response.raw, /X-Amz-Signature|password_hash/i);
}

test('BOLA-005 message ID from another conversation cannot be updated', async t => {
  const a = await user(), b = await user(), c = await user();
  const ab = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const ac = await ok('POST', '/conversations', a.token, { other_user_id: c.id }, 201);
  const privateMessage = await message(a, ac.id, `other-conversation-${uuid()}`);
  const aSocket = await messaging(a, t), cSocket = await messaging(c, t);
  const before = sql(`SELECT conversation_id, status FROM messages WHERE id='${privateMessage.body.id}'`);
  denied(await request('PUT', `/conversations/${ab.id}/messages/${privateMessage.body.id}`, b.token,
    { status: 'read' }));
  assert.equal(sql(`SELECT conversation_id, status FROM messages WHERE id='${privateMessage.body.id}'`), before);
  await wait(400);
  assert.equal(aSocket.events.some(event => event.type === 'MESSAGE_STATUS_UPDATE'), false);
  assert.equal(cSocket.events.some(event => event.type === 'MESSAGE_STATUS_UPDATE'), false);
});

test('BOLA-012 mixed owner video ID and foreign upload ID cannot control either session', async () => {
  const a = await user(), b = await user();
  const av = await video(a), bv = await video(b);
  const aBefore = redis('HGETALL', `video:upload:${av.id}`);
  const bBefore = redis('HGETALL', `video:upload:${bv.id}`);
  for (const [suffix, body] of [
    ['/chunks', { upload_id: bv.upload_id, part_number: 2, etag_previous: 'forged' }],
    ['/finalize', { upload_id: bv.upload_id, duration_secs: 1,
      parts: [{ part_number: 1, etag: 'forged' }] }],
    ['/abort', { upload_id: bv.upload_id }],
  ]) denied(await request('POST', `/videos/${av.id}${suffix}`, a.token, body), [400, 403, 404, 409]);
  assert.equal(redis('HGETALL', `video:upload:${av.id}`), aBefore);
  assert.equal(redis('HGETALL', `video:upload:${bv.id}`), bBefore);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${av.id}'`), 'recording');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${bv.id}'`), 'recording');
});

test('BOLA-013 cursor from a private conversation does not reveal its messages elsewhere', async () => {
  const a = await user(), b = await user(), c = await user();
  const ab = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const ac = await ok('POST', '/conversations', a.token, { other_user_id: c.id }, 201);
  await message(a, ac.id, `cursor-private-one-${uuid()}`);
  const secret = await message(a, ac.id, `cursor-private-two-${uuid()}`);
  await message(a, ab.id, `shared-one-${uuid()}`);
  await message(b, ab.id, `shared-two-${uuid()}`);
  const page = await ok('GET', `/conversations/${ac.id}/messages?limit=1`, a.token);
  assert.ok(page.prev_cursor);
  const response = await request('GET', `/conversations/${ab.id}/messages?cursor=${encodeURIComponent(page.prev_cursor)}`, b.token);
  assert.ok([200, 400].includes(response.status));
  assert.equal(response.raw.includes(secret.body.content), false);
  assert.equal(response.raw.includes(secret.body.id), false);
  denied(await request('GET', `/conversations/${ac.id}/messages?cursor=${encodeURIComponent(page.prev_cursor)}`, b.token));
});

test('BOLA-014 public avatar returns only public fields', async () => {
  const a = await user(), b = await user(), model = await avatarModel(a.token);
  const upsert = await request('PUT', '/avatars/me', a.token,
    { model_id: model.id, customizations: {} });
  assert.ok([200, 201].includes(upsert.status));
  const own = await ok('GET', '/avatars/me', a.token);
  const publicView = await ok('GET', `/avatars/${a.id}`, b.token);
  assert.equal(publicView.user_id, a.id);
  assert.equal(publicView.model_id, own.model_id);
  assert.equal(publicView.model_url, own.model_url);
  assert.deepEqual(Object.keys(publicView).sort(), ['customizations', 'model_id', 'model_url', 'user_id']);
  assert.equal(JSON.stringify(publicView).includes(a.email), false);
  assert.equal(JSON.stringify(publicView).includes(a.token), false);
});

test('BOLA-015 deleted video cannot be read, renamed or deleted again', async () => {
  const a = await user(), b = await user(), item = await video(a);
  await ok('DELETE', `/videos/${item.id}`, a.token, undefined, 204);
  const before = sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`);
  assert.equal(before, 't');
  for (const actor of [a, b]) {
    denied(await request('GET', `/videos/${item.id}`, actor.token));
    denied(await request('PUT', `/videos/${item.id}`, actor.token, { title: 'revived' }));
    denied(await request('DELETE', `/videos/${item.id}`, actor.token));
  }
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`), before);
});

test('BOLA-016 outsider cannot send TYPING or TYPING_STOP to private conversation', async t => {
  const p = await pair(), c = await user();
  const aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const attacker = await messaging(c, t);
  for (const type of ['TYPING', 'TYPING_STOP']) {
    attacker.send({ type, data: { conversation_id: p.id } });
    const error = await attacker.take('ERROR');
    assert.equal(error.data.code, 'FORBIDDEN');
  }
  await wait(500);
  for (const socket of [aSocket, bSocket]) {
    assert.equal(socket.events.some(event => ['TYPING', 'TYPING_STOP'].includes(event.type)), false);
  }
});

test('BOLA-017 random and foreign IDs reveal no private content or side effects', async () => {
  const p = await pair(), c = await user(), privateMessage = await message(p.a, p.id, `hidden-${uuid()}`);
  const before = sql(`SELECT status FROM messages WHERE id='${privateMessage.body.id}'`);
  for (const id of [p.id, uuid()]) {
    denied(await request('GET', `/conversations/${id}`, c.token));
    denied(await request('GET', `/conversations/${id}/messages`, c.token));
  }
  denied(await request('PUT', `/conversations/${p.id}/messages/${privateMessage.body.id}`,
    c.token, { status: 'read' }));
  assert.equal(sql(`SELECT status FROM messages WHERE id='${privateMessage.body.id}'`), before);
});

test('BOLA-018 supplied user IDs cannot take ownership across message, video and avatar', async () => {
  const p = await pair();
  const body = { ...validMessage(`owner-${uuid()}`), sender_id: p.b.id, user_id: p.b.id };
  const sent = await request('POST', `/conversations/${p.id}/messages`, p.a.token, body);
  assert.ok([201, 400].includes(sent.status));
  if (sent.status === 201) assert.equal(sql(`SELECT sender_id FROM messages WHERE id='${body.id}'`), p.a.id);
  const created = await request('POST', '/videos', p.a.token, validVideo({ user_id: p.b.id }));
  assert.ok([201, 400].includes(created.status));
  if (created.status === 201) assert.equal(sql(`SELECT user_id FROM videos WHERE id='${created.data.id}'`), p.a.id);
  const model = await avatarModel(p.a.token);
  const avatar = await request('PUT', '/avatars/me', p.a.token,
    { model_id: model.id, customizations: {}, user_id: p.b.id });
  assert.ok([200, 201, 400].includes(avatar.status));
  assert.equal(sql(`SELECT count(*) FROM avatar_profiles WHERE user_id='${p.b.id}'`), '0');
});
