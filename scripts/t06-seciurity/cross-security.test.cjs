const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, ok, user, pair, message,
  readyVideo, video, sql, redis, uuid, wait, Socket, messaging, signaling,
  base, signalingUrl } = h;

function deny(response, statuses = [401, 403, 404]) {
  assert.ok(statuses.includes(response.status), `Expected denial; HTTP ${response.status}`);
  assert.equal(response.data?.view_url, undefined);
}
async function rejectedMessaging(token, t) {
  const socket = new Socket(base.replace(/^http/, 'ws') + '/ws/messaging', token, t);
  try { await socket.open(); } catch (error) {
    assert.match(error.message, /Unexpected server response: (401|403)/);
    return;
  }
  const deadline = Date.now() + 3000;
  while (!socket.closeCode && Date.now() < deadline) await wait(25);
  assert.ok(socket.closeCode, 'Unauthorized messaging socket stayed open');
}
async function closed(socket, code = 4001) {
  const deadline = Date.now() + 6000;
  while (!socket.closeCode && Date.now() < deadline) await wait(25);
  assert.equal(socket.closeCode, code);
}

test('CROSS-001 logout revokes the same access on HTTP, messaging and signaling', async t => {
  const a = await user(), b = await user(), bSocket = await messaging(b, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  deny(await request('GET', '/users/me', a.token), [401]);
  await rejectedMessaging(a.token, t);
  const signal = new Socket(signalingUrl, a.token, t);
  await signal.open();
  await closed(signal);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.equal(bSocket.ws.readyState, 1);
});

test('CROSS-002 outsider cannot interact with private conversation through HTTP or WS', async t => {
  const p = await pair(), c = await user(), sender = await messaging(c, t);
  const aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const sent = await message(p.a, p.id, `cross-private-${uuid()}`);
  const before = sql(`SELECT count(*), min(status) FROM messages WHERE conversation_id='${p.id}'`);
  deny(await request('GET', `/conversations/${p.id}/messages`, c.token), [403]);
  deny(await request('POST', `/conversations/${p.id}/messages`, c.token,
    { id: uuid(), content: 'forged', client_timestamp: new Date().toISOString() }), [403]);
  deny(await request('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, c.token,
    { status: 'read' }), [403]);
  sender.send({ type: 'TYPING', data: { conversation_id: p.id } });
  assert.equal((await sender.take('ERROR')).data.code, 'FORBIDDEN');
  await wait(450);
  assert.equal(sql(`SELECT count(*), min(status) FROM messages WHERE conversation_id='${p.id}'`), before);
  for (const socket of [aSocket, bSocket]) {
    assert.equal(socket.events.some(event => event.type === 'TYPING'), false);
  }
});

test('CROSS-003 user JWT and forged signaling event cannot create internal call notify', async t => {
  const a = await user(), b = await user(), c = await user();
  const inbox = await messaging(b, t), attacker = await signaling(c, t);
  deny(await request('POST', '/internal/call/notify', c.token,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() }), [401]);
  attacker.send({ type: 'CALL_INCOMING', from_user_id: a.id, target_user_id: b.id,
    data: { caller_id: a.id } });
  await wait(500);
  assert.equal(inbox.events.some(event => event.type === 'CALL_INCOMING'), false);
});

test('CROSS-004 outsider cannot change video metadata, multipart or object access', async () => {
  const a = await user(), b = await user(), ready = await readyVideo(b), active = await video(b);
  const before = sql(`SELECT id, status, deleted_at IS NULL FROM videos WHERE user_id='${b.id}' ORDER BY id`);
  const session = redis('HGETALL', `video:upload:${active.id}`);
  for (const path of [`/videos/${ready.item.id}`, `/videos/${active.id}`]) {
    deny(await request('GET', path, a.token), [403, 404]);
    deny(await request('DELETE', path, a.token), [403]);
  }
  deny(await request('POST', `/videos/${active.id}/chunks`, a.token,
    { upload_id: active.upload_id, part_number: 2, etag_previous: 'forged' }), [403]);
  deny(await request('POST', `/videos/${active.id}/abort`, a.token,
    { upload_id: active.upload_id }), [403]);
  assert.equal(sql(`SELECT id, status, deleted_at IS NULL FROM videos WHERE user_id='${b.id}' ORDER BY id`), before);
  assert.equal(redis('HGETALL', `video:upload:${active.id}`), session);
  assert.ok((await ok('GET', `/videos/${ready.item.id}`, b.token)).view_url);
});

test('CROSS-005 account deletion revokes HTTP, refresh and both realtime channels', async t => {
  const a = await user(), b = await user();
  const msg = await messaging(a, t), signal = await signaling(a, t);
  const bMsg = await messaging(b, t);
  await ok('DELETE', '/users/me', a.token, { password: a.password }, 204);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${a.id}'`), 't');
  deny(await request('GET', '/users/me', a.token), [401]);
  deny(await request('POST', '/auth/refresh', null, { refresh_token: a.refresh }), [401]);
  await closed(msg, 4002);
  await closed(signal);
  await rejectedMessaging(a.token, t);
  assert.equal(bMsg.ws.readyState, 1);
});

test('CROSS-006 revoking one login leaves another device usable across channels', async t => {
  const a = await user(), login = await ok('POST', '/auth/login', null,
    { email: a.email, password: a.password });
  const otherToken = login.tokens.access_token;
  const oldMsg = await messaging(a, t), newMsg = await messaging({ token: otherToken }, t);
  const oldSignal = await signaling(a, t), newSignal = await signaling({ token: otherToken }, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  deny(await request('GET', '/users/me', a.token), [401]);
  await closed(oldMsg, 4002);
  await closed(oldSignal);
  assert.equal((await ok('GET', '/users/me', otherToken)).id, a.id);
  assert.equal(newMsg.ws.readyState, 1);
  assert.equal(newSignal.ws.readyState, 1);
});

test('CROSS-009 late callee gets correct pending offer while outsider stays isolated', async t => {
  const a = await user(), b = await user(), c = await user();
  const inboxB = await messaging(b, t), outsider = await signaling(c, t);
  const caller = await signaling(a, t), callId = uuid(), sdp = `e09-${uuid()}`;
  caller.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id,
    from_user_id: c.id, data: { sdp } });
  assert.equal((await inboxB.take('CALL_INCOMING')).data.caller_id, a.id);
  const callee = await signaling(b, t);
  const received = await callee.take('CALL_OFFER');
  assert.equal(received.call_id, callId);
  assert.equal(received.from_user_id, a.id);
  assert.equal(received.data.sdp, sdp);
  await wait(450);
  assert.equal(outsider.events.some(event => JSON.stringify(event).includes(sdp)), false);
});

test('INT-007 internal credentials require exact bytes, with no secret in errors', async t => {
  const a = await user(), b = await user(), inbox = await messaging(b, t);
  const original = process.env.E2E_CALL_SECRET;
  const body = { caller_id: a.id, callee_id: b.id, call_id: uuid() };
  // HTTP clients may normalize leading/trailing optional whitespace in header values.
  // These variants remain different after HTTP header parsing.
  for (const credential of [original + 'x', original.toUpperCase(),
    ` ${original}`, `${original} x`]) {
    const response = await request('POST', '/internal/call/notify', null, body,
      { headers: { Authorization: `Bearer ${credential}` } });
    deny(response, [401]);
    assert.equal(response.raw.includes(original), false);
  }
  await wait(450);
  assert.equal(inbox.events.some(event => event.type === 'CALL_INCOMING'), false);
  const valid = await request('POST', '/internal/call/notify', null, body,
    { headers: { Authorization: `Bearer ${original}` } });
  assert.equal(valid.status, 204);
  assert.equal((await inbox.take('CALL_INCOMING')).data.caller_id, a.id);
});

test('INT-008 notify validates participants and signaling binds caller to authenticated socket', async t => {
  const a = await user(), b = await user(), deleted = await user();
  const inbox = await messaging(b, t);
  const header = { Authorization: `Bearer ${process.env.E2E_CALL_SECRET}` };
  await ok('DELETE', '/users/me', deleted.token, { password: deleted.password }, 204);
  for (const body of [
    { caller_id: uuid(), callee_id: b.id, call_id: uuid() },
    { caller_id: deleted.id, callee_id: b.id, call_id: uuid() },
    { caller_id: a.id, callee_id: uuid(), call_id: uuid() },
  ]) {
    const response = await request('POST', '/internal/call/notify', null, body, { headers: header });
    assert.equal(response.status, 404);
    assert.equal(response.raw.includes(process.env.E2E_CALL_SECRET), false);
  }
  await wait(400);
  assert.equal(inbox.events.some(event => event.type === 'CALL_INCOMING'), false);
  const caller = await signaling(a, t), callId = uuid();
  caller.send({ type: 'CALL_OFFER', target_user_id: b.id, call_id: callId,
    caller_id: deleted.id, from_user_id: deleted.id, data: { sdp: 'int008-offer' } });
  const event = await inbox.take('CALL_INCOMING');
  assert.equal(event.data.caller_id, a.id);
  assert.equal(event.data.call_id, callId);
});

test('INT-012 replayed webhook after video deletion cannot restore READY', async () => {
  const a = await user(), ready = await readyVideo(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  await ok('DELETE', `/videos/${ready.item.id}`, a.token, undefined, 204);
  const body = { Records: [{ eventName: 's3:ObjectCreated:CompleteMultipartUpload',
    s3: { bucket: { name: 'veiltalk-e2e' }, object: { key, size: ready.first.length + ready.last.length } } }] };
  for (let i = 0; i < 2; i++) {
    const response = await request('POST', '/internal/videos/webhook', null, body,
      { headers: { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` } });
    assert.equal(response.status, 204);
  }
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${ready.item.id}'`), 't');
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
});
