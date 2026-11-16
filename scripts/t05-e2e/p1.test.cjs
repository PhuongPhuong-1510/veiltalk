const { test: rawTest } = require('node:test');
const h = require('../t04-api/support.cjs');
const { assert, caseTest: tc, user, pair, uuid, ok, request, sql, wait, password,
  avatarModel, message, validMessage, messaging, signaling } = h;

const offer = (target, callId) => ({ type: 'CALL_OFFER', call_id: callId, target_user_id: target, data: { sdp: 'T05 P1 offer' } });
const callAction = (type, target, callId, data = {}) => ({ type, call_id: callId, target_user_id: target, data });
const noEvent = async (socket, predicate, duration = 1000) => {
  await wait(duration);
  assert.equal(socket.events.some(predicate), false, 'Unexpected event received');
};

tc('T05-ACC-006', async () => {
  const a = await user();
  const second = await ok('POST', '/auth/login', null, { email: a.email, password });
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  assert.equal((await ok('GET', '/users/me', second.tokens.access_token)).id, a.id);
  await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh }, 401);
  const refreshed = await ok('POST', '/auth/refresh', null, { refresh_token: second.tokens.refresh_token });
  assert.equal((await ok('GET', '/users/me', refreshed.access_token)).id, a.id);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NOT NULL`), '1');
});

tc('T05-ACC-007', async () => {
  const a = await user(), b = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: b.refresh }, 401);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NOT NULL`), '0');
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${b.id}' AND revoked_at IS NOT NULL`), '0');
  assert.equal((await ok('POST', '/auth/refresh', null, { refresh_token: b.refresh })).access_token.length > 0, true);
});

tc('T05-ACC-008', async () => {
  const a = await user(), displayName = 'Updated during session';
  await ok('PUT', '/users/me', a.token, { display_name: displayName });
  assert.equal((await ok('GET', '/users/me', a.token)).display_name, displayName);
  const refreshed = await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh });
  const profile = await ok('GET', '/users/me', refreshed.access_token);
  assert.equal(profile.id, a.id);
  assert.equal(profile.display_name, displayName);
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${a.id}'`), displayName);
});

tc('T05-ACC-009', async () => {
  const a = await user(), model = await avatarModel(a.token);
  assert.equal((await ok('POST', '/auth/login', null, { email: a.email, password })).user.has_avatar, false);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal(login.user.has_avatar, true);
  assert.equal((await ok('GET', '/avatars/me', login.tokens.access_token)).user_id, a.id);
  assert.equal(sql(`SELECT count(*) FROM avatar_profiles WHERE user_id='${a.id}'`), '1');
});

tc('T05-ACC-010', async () => {
  const a = await user();
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh }, 401);
  await ok('POST', '/auth/login', null, { email: a.email, password }, 401);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${a.id}'`), 't');
});

tc('T05-ACC-011', async () => {
  const a = await user(), beforeUsers = sql('SELECT count(*) FROM users');
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal(typeof (await ok('GET', '/users/me/settings', a.token)).discoverable, 'boolean');
  assert.ok((await ok('GET', '/avatars/models', a.token)).models.length > 0);
  assert.deepEqual((await ok('GET', '/conversations', a.token)).data, []);
  assert.deepEqual((await ok('GET', '/videos', a.token)).data, []);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id='${a.id}'`), '1');
  assert.equal(sql('SELECT count(*) FROM users'), beforeUsers);
});

tc('T05-USR-004', async () => {
  const a = await user(), b = await user({ display_name: 'Search result name' });
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  const search = await ok('POST', '/users/search', a.token, { email: b.email });
  assert.equal(search.found, true);
  assert.deepEqual(search.user, { id: b.id, display_name: 'Search result name' });
  const conversation = await ok('POST', '/conversations', a.token, { other_user_id: search.user.id }, 201);
  assert.equal(conversation.other_user.display_name, 'Search result name');
  assert.equal((await ok('GET', `/conversations/${conversation.id}`, b.token)).other_user.id, a.id);
});

tc('T05-USR-005', async () => {
  const a = await user(), b = await user();
  const beforeA = await ok('GET', '/users/me/settings', a.token);
  const beforeB = await ok('GET', '/users/me/settings', b.token);
  const updated = await ok('PUT', '/users/me/settings', a.token, { theme: 'dark', discoverable: !beforeA.discoverable });
  assert.equal(updated.theme, 'dark');
  assert.equal(updated.discoverable, !beforeA.discoverable);
  assert.deepEqual(await ok('GET', '/users/me/settings', b.token), beforeB);
});

tc('T05-USR-006', async () => {
  const a = await user(), displayName = "Nguyễn O'Neil 👋 雪 e\u0301";
  const updated = await ok('PUT', '/users/me', a.token, { display_name: displayName });
  assert.equal(updated.display_name, displayName);
  assert.equal((await ok('GET', '/users/me', a.token)).display_name, displayName);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal(login.user.display_name, displayName);
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${a.id}'`), displayName);
});

tc('T05-USR-007', async () => {
  const a = await user(), b = await user();
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  assert.equal((await ok('POST', '/users/search', a.token, { email: b.email })).found, true);
  await ok('DELETE', '/users/me', b.token, { password }, 204);
  const result = await ok('POST', '/users/search', a.token, { email: b.email });
  assert.equal(result.found, false);
  assert.equal(result.user, null);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${b.id}'`), 't');
});

tc('T05-USR-008', async () => {
  const a = await user();
  for (let i = 0; i < 10; i += 1) {
    const response = await request('POST', '/users/search', a.token, { email: `absent-${i}@example.com` });
    assert.equal(response.status, 200);
  }
  const limited = await request('POST', '/users/search', a.token, { email: 'another-absent@example.com' });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal(typeof (await ok('GET', '/users/me/settings', a.token)).theme, 'string');
});

tc('T05-AVA-003', async () => {
  const a = await user(), models = (await ok('GET', '/avatars/models', a.token)).models;
  const created = await request('PUT', '/avatars/me', a.token, { model_id: models[0].id });
  assert.equal(created.status, 201);
  const first = await ok('GET', '/avatars/me', a.token);
  for (let i = 0; i < 2; i += 1) {
    const update = await request('PUT', '/avatars/me', a.token, { model_id: models[0].id });
    assert.equal(update.status, 200);
    assert.equal(update.data, null);
  }
  assert.equal((await ok('GET', '/avatars/me', a.token)).id, first.id);
  assert.equal(sql(`SELECT count(*) FROM avatar_profiles WHERE user_id='${a.id}'`), '1');
});

tc('T05-AVA-004', async () => {
  const a = await user(), model = await avatarModel(a.token);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id, customizations: {} }, 201);
  const before = await ok('GET', '/avatars/me', a.token);
  await ok('PUT', '/avatars/me', a.token, { model_id: uuid() }, 400);
  const after = await ok('GET', '/avatars/me', a.token);
  assert.equal(after.id, before.id);
  assert.equal(after.model_id, before.model_id);
  assert.deepEqual(after.customizations, before.customizations);
});

tc('T05-AVA-005', async () => {
  const a = await user(), before = await ok('GET', '/avatars/models', a.token), model = before.models[0];
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  const after = await ok('GET', '/avatars/models', a.token);
  assert.deepEqual(after, before);
  assert.equal((await ok('GET', '/avatars/me', a.token)).model_id, model.id);
});

tc('T05-AVA-006', async () => {
  const a = await user(), b = await user(), model = await avatarModel(a.token);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  assert.equal((await ok('GET', `/avatars/${a.id}`, b.token)).user_id, a.id);
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('GET', `/avatars/${a.id}`, b.token, undefined, 404);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${a.id}'`), 't');
});

tc('T05-CON-004', async () => {
  const p = await pair();
  const detail = await ok('GET', `/conversations/${p.id}`, p.a.token);
  const list = await ok('GET', '/conversations', p.a.token);
  assert.equal(detail.last_message, null);
  assert.deepEqual(list.data.filter(x => x.id === p.id).map(x => x.last_message), [null]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '0');
});

tc('T05-CON-006', async () => {
  const a = await user(), b = await user(), c = await user();
  const older = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  await new Promise(resolve => setTimeout(resolve, 20));
  const newer = await ok('POST', '/conversations', a.token, { other_user_id: c.id }, 201);
  const before = await ok('GET', '/conversations', a.token);
  assert.equal(before.data[0].id, newer.id);
  await new Promise(resolve => setTimeout(resolve, 20));
  const sent = await message(a, older.id, 'Move conversation to top');
  const after = await ok('GET', '/conversations', a.token);
  assert.equal(after.data[0].id, older.id);
  assert.equal(after.data[0].last_message.content, sent.data.content);
  assert.ok(Date.parse(after.data[0].updated_at) > Date.parse(before.data.find(x => x.id === older.id).updated_at));
});

tc('T05-CON-009', async () => {
  const p = await pair(), baseTime = Date.now() - 60_000;
  for (let i = 0; i < 12; i += 1) {
    await ok('POST', `/conversations/${p.id}/messages`, p.a.token, {
      id: uuid(), content: `message-${i}`, client_timestamp: new Date(baseTime + i * 1000).toISOString(),
    }, 201);
  }
  const list = await ok('GET', '/conversations', p.a.token);
  assert.equal(list.data.filter(x => x.id === p.id).length, 1);
  assert.equal(list.data.find(x => x.id === p.id).last_message.content, 'message-11');
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${p.id}'`), '1');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '12');
});

tc('T05-CON-010', async () => {
  const p = await pair(), before = await ok('GET', `/conversations/${p.id}`, p.a.token);
  await ok('PUT', '/users/me', p.b.token, { display_name: 'Changed peer name' });
  const after = await ok('GET', `/conversations/${p.id}`, p.a.token);
  assert.equal(after.id, before.id);
  assert.equal(after.other_user.id, p.b.id);
  assert.equal(after.other_user.display_name, 'Changed peer name');
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${p.id}' AND ((user_a_id='${p.a.id}' AND user_b_id='${p.b.id}') OR (user_a_id='${p.b.id}' AND user_b_id='${p.a.id}'))`), '1');
});

tc('T05-MSG-006', async t => {
  const a = await user(), b = await user(), c = await user();
  const ab = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const ac = await ok('POST', '/conversations', a.token, { other_user_id: c.id }, 201);
  const inboxC = await messaging(c, t), original = await message(a, ab.id, 'Original scope');
  await ok('POST', `/conversations/${ac.id}/messages`, a.token, original.body, 409);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${original.body.id}' AND conversation_id='${ab.id}' AND sender_id='${a.id}'`), '1');
  assert.equal((await ok('GET', `/conversations/${ab.id}/messages`, b.token)).data[0].content, 'Original scope');
  assert.deepEqual((await ok('GET', `/conversations/${ac.id}/messages`, c.token)).data, []);
  await noEvent(inboxC, e => e.type === 'NEW_MESSAGE' && e.data.id === original.body.id);
});

tc('T05-MSG-007', async () => {
  const p = await pair(), original = await message(p.a, p.id, 'Owned by sender A');
  await ok('POST', `/conversations/${p.id}/messages`, p.b.token, { ...original.body, content: 'Attempt by B' }, 409);
  const history = await ok('GET', `/conversations/${p.id}/messages`, p.b.token);
  assert.equal(history.data.filter(x => x.id === original.body.id).length, 1);
  assert.equal(history.data[0].sender_id, p.a.id);
  assert.equal(history.data[0].content, 'Owned by sender A');
  assert.equal(sql(`SELECT sender_id FROM messages WHERE id='${original.body.id}'`), p.a.id);
});

tc('T05-MSG-008', async t => {
  const p = await pair(), sender = await messaging(p.a, t), recipient = await messaging(p.b, t);
  const sent = await message(p.a, p.id, 'status lifecycle');
  assert.equal(sent.data.status, 'sent');
  await recipient.take('NEW_MESSAGE');
  for (const status of ['delivered', 'read']) {
    const response = await ok('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, p.b.token, { status });
    assert.equal(response.id, sent.body.id);
    assert.equal(response.status, status);
    for (const socket of [sender, recipient]) {
      const event = await socket.take('MESSAGE_STATUS_UPDATE');
      assert.deepEqual(event.data, { id: sent.body.id, status });
    }
  }
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.a.token)).data[0].status, 'read');
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`), 'read');
});

tc('T05-MSG-009', async t => {
  const p = await pair(), sender = await messaging(p.a, t);
  const sent = await message(p.a, p.id, 'read once');
  await ok('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, p.b.token, { status: 'read' });
  await sender.take('MESSAGE_STATUS_UPDATE');
  await ok('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, p.b.token, { status: 'read' });
  await noEvent(sender, e => e.type === 'MESSAGE_STATUS_UPDATE' && e.data.id === sent.body.id);
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`), 'read');
});

tc('T05-MSG-010', async t => {
  const p = await pair(), outsider = await user(), sender = await messaging(p.a, t), recipient = await messaging(p.b, t);
  const sent = await message(p.a, p.id, 'status protected');
  await recipient.take('NEW_MESSAGE');
  const fromSender = await request('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, p.a.token, { status: 'read' });
  const fromOutsider = await request('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, outsider.token, { status: 'read' });
  assert.equal(fromSender.status, 403);
  assert.equal(fromOutsider.status, 403);
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`), 'sent');
  await noEvent(sender, e => e.type === 'MESSAGE_STATUS_UPDATE' && e.data.id === sent.body.id);
  await noEvent(recipient, e => e.type === 'MESSAGE_STATUS_UPDATE' && e.data.id === sent.body.id);
});

tc('T05-MSG-012', async t => {
  const p = await pair(), first = await message(p.a, p.id, 'sent while offline');
  const reconnected = await messaging(p.b, t);
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.b.token)).data.some(x => x.id === first.body.id), true);
  const second = await message(p.a, p.id, 'sent after reconnect');
  assert.deepEqual((await reconnected.take('NEW_MESSAGE')).data, second.data);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '2');
});

tc('T05-MSG-013', async t => {
  const p = await pair(), inbox = await messaging(p.b, t), content = "Xin chào 👋\nDòng 2 — 雪";
  const sent = await message(p.a, p.id, content);
  assert.equal((await inbox.take('NEW_MESSAGE')).data.content, content);
  for (const owner of [p.a, p.b]) {
    const item = (await ok('GET', `/conversations/${p.id}/messages`, owner.token)).data.find(x => x.id === sent.body.id);
    assert.equal(item.content, content);
  }
  assert.equal(sql(`SELECT content FROM messages WHERE id='${sent.body.id}'`), content);
});

tc('T05-MSG-014', async () => {
  const p = await pair(), ids = [], baseTime = Date.now() - 60_000;
  for (let i = 0; i < 10; i += 1) {
    const body = { id: uuid(), content: `ordered-${i}`, client_timestamp: new Date(baseTime + i * 1000).toISOString() };
    ids.push(body.id);
    await ok('POST', `/conversations/${p.id}/messages`, p.a.token, body, 201);
  }
  const history = await ok('GET', `/conversations/${p.id}/messages`, p.b.token);
  assert.deepEqual(history.data.map(x => x.id), ids);
  const conversations = await ok('GET', '/conversations', p.a.token);
  assert.equal(conversations.data.filter(x => x.id === p.id).length, 1);
  assert.equal(conversations.data.find(x => x.id === p.id).last_message.content, 'ordered-9');
});

tc('T05-MSG-015', async t => {
  const a = await user(), b = await user(), c = await user();
  const ab = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const ac = await ok('POST', '/conversations', a.token, { other_user_id: c.id }, 201);
  const inboxB = await messaging(b, t), inboxC = await messaging(c, t);
  const first = await message(a, ab.id, 'only for B');
  assert.equal((await inboxB.take('NEW_MESSAGE')).data.id, first.body.id);
  await noEvent(inboxC, e => e.type === 'NEW_MESSAGE' && e.data.id === first.body.id);
  const second = await message(a, ac.id, 'only for C');
  assert.equal((await inboxC.take('NEW_MESSAGE')).data.id, second.body.id);
  await noEvent(inboxB, e => e.type === 'NEW_MESSAGE' && e.data.id === second.body.id);
});

tc('T05-MSG-016', async () => {
  const p = await pair(), before = await ok('GET', `/conversations/${p.id}`, p.a.token);
  await new Promise(resolve => setTimeout(resolve, 25));
  const sent = await message(p.a, p.id, 'touch updated_at');
  const after = await ok('GET', `/conversations/${p.id}`, p.a.token);
  assert.ok(Date.parse(after.updated_at) > Date.parse(before.updated_at));
  assert.equal(after.last_message.content, sent.data.content);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}' AND conversation_id='${p.id}'`), '1');
});

tc('T05-WS-002', async t => {
  const p = await pair(), first = await messaging(p.b, t), second = await messaging(p.b, t);
  await first.close();
  const sent = await message(p.a, p.id, 'second tab remains');
  assert.equal((await second.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal(second.closeCode, undefined);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`), '1');
});

tc('T05-WS-003', async t => {
  const p = await pair(), sender = await messaging(p.a, t), receiver = await messaging(p.b, t);
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  sender.send({ type: 'TYPING', data: { conversation_id: p.id } });
  assert.deepEqual((await receiver.take('TYPING')).data, { conversation_id: p.id });
  sender.send({ type: 'TYPING_STOP', data: { conversation_id: p.id } });
  assert.deepEqual((await receiver.take('TYPING_STOP')).data, { conversation_id: p.id });
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

tc('T05-WS-004', async t => {
  const p = await pair(), outsider = await user(), aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const cSocket = await messaging(outsider, t);
  cSocket.send({ type: 'TYPING', data: { conversation_id: p.id } });
  const error = await cSocket.take('ERROR');
  assert.equal(error.data.code, 'FORBIDDEN');
  await noEvent(aSocket, e => e.type === 'TYPING' && e.data.conversation_id === p.id);
  await noEvent(bSocket, e => e.type === 'TYPING' && e.data.conversation_id === p.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), '0');
});

tc('T05-WS-006', async t => {
  const p = await pair(), first = await messaging(p.b, t);
  await first.close();
  const second = await messaging(p.b, t), sent = await message(p.a, p.id, 'after reconnect');
  assert.equal((await second.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.b.token)).data[0].id, sent.body.id);
});

tc('T05-WS-007', async t => {
  const p = await pair(), sender = await messaging(p.a, t), receiver = await messaging(p.b, t), id = uuid();
  sender.send({ type: 'NEW_MESSAGE', data: { id, content: 'must not persist' } });
  const error = await sender.take('ERROR');
  assert.equal(error.data.code, 'UNSUPPORTED_EVENT');
  await noEvent(receiver, e => e.type === 'NEW_MESSAGE' && e.data.id === id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${id}'`), '0');
  assert.deepEqual((await ok('GET', `/conversations/${p.id}/messages`, p.a.token)).data, []);
});

tc('T05-WS-008', async t => {
  const p = await pair(), sender1 = await messaging(p.a, t), sender2 = await messaging(p.a, t);
  const sent = await message(p.a, p.id, 'read on other device');
  await ok('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, p.b.token, { status: 'read' });
  for (const socket of [sender1, sender2]) {
    const event = await socket.take('MESSAGE_STATUS_UPDATE');
    assert.deepEqual(event.data, { id: sent.body.id, status: 'read' });
  }
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`), 'read');
});

tc('T05-WS-009', async t => {
  const p = await pair(), offline = await message(p.a, p.id, 'persist while receiver offline');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${offline.body.id}'`), '1');
  const receiver = await messaging(p.b, t);
  const next = await message(p.a, p.id, 'realtime after reconnect');
  assert.equal((await receiver.take('NEW_MESSAGE')).data.id, next.body.id);
  const history = await ok('GET', `/conversations/${p.id}/messages`, p.b.token);
  assert.deepEqual(new Set(history.data.map(x => x.id)), new Set([offline.body.id, next.body.id]));
});

tc('T05-WS-010', async t => {
  const a = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await assert.rejects(() => new h.Socket(h.base.replace(/^http/, 'ws') + '/ws/messaging', a.token, t).open());
});

tc('T05-CALL-004', async t => {
  const a = await user(), b = await user(), c = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t), sc = await signaling(c, t);
  const first = uuid();
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  sa.send(callAction('CALL_END', b.id, first));
  assert.equal((await sb.take('CALL_END')).call_id, first);
  const next = uuid();
  sc.send(offer(b.id, next));
  assert.equal((await sb.take('CALL_OFFER')).call_id, next);
  sb.send(callAction('CALL_REJECT', c.id, next));
  assert.equal((await sc.take('CALL_REJECT')).call_id, next);
});

tc('T05-CALL-005', async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t), sb = await signaling(b, t);
  const first = uuid();
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  sb.send(callAction('CALL_ANSWER', a.id, first, { sdp: 'accepted' }));
  assert.equal((await sa.take('CALL_ANSWER')).call_id, first);
  sb.send(callAction('CALL_END', a.id, first));
  assert.equal((await sa.take('CALL_END')).call_id, first);
  const next = uuid();
  sa.send(offer(b.id, next));
  assert.equal((await sb.take('CALL_OFFER')).call_id, next);
  sb.send(callAction('CALL_REJECT', a.id, next));
  assert.equal((await sa.take('CALL_REJECT')).call_id, next);
});

tc('T05-CALL-006', async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t), sb = await signaling(b, t);
  const callId = uuid();
  sa.send(offer(b.id, callId));
  assert.equal((await sb.take('CALL_OFFER')).call_id, callId);
  sb.send(callAction('CALL_ANSWER', a.id, callId, { sdp: 'no messaging socket' }));
  assert.equal((await sa.take('CALL_ANSWER')).call_id, callId);
});

rawTest('T05-CALL-007', { timeout: 120_000 }, async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t);
  const callId = uuid();
  sa.send(offer(b.id, callId));
  const timeoutEvent = await sa.take('CALL_END', 45_000);
  assert.equal(timeoutEvent.data.reason, 'timeout');
  const sb = await signaling(b, t), next = uuid();
  sa.send(offer(b.id, next));
  assert.equal((await sb.take('CALL_OFFER')).call_id, next);
  sb.send(callAction('CALL_REJECT', a.id, next));
  assert.equal((await sa.take('CALL_REJECT')).call_id, next);
});

tc('T05-CALL-010', async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t), sb = await signaling(b, t);
  const first = uuid();
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  sb.send(callAction('CALL_ANSWER', a.id, first, { sdp: 'accepted' }));
  await sa.take('CALL_ANSWER');
  await sb.close();
  const ended = await sa.take('CALL_END');
  assert.equal(ended.data.reason, 'peer_disconnected');
  const reconnected = await signaling(b, t), next = uuid();
  sa.send(offer(b.id, next));
  assert.equal((await reconnected.take('CALL_OFFER')).call_id, next);
  reconnected.send(callAction('CALL_REJECT', a.id, next));
  assert.equal((await sa.take('CALL_REJECT')).call_id, next);
});
