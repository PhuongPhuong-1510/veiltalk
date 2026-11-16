const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, ok, user, pair, uuid, validMessage,
  message, video, readyVideo, sql, redis, wait, Socket, messaging, signaling, base, signalingUrl } = h;

function denied(response, statuses = [403]) {
  assert.ok(statuses.includes(response.status), `Expected denial, received HTTP ${response.status}`);
  assert.equal(response.data?.view_url, undefined);
  assert.equal(response.data?.chunk_url, undefined);
}
async function quiet(socket, types, duration = 500) {
  await wait(duration);
  assert.equal(socket.events.some(event => types.includes(event.type)), false,
    `Unexpected ${types.join('/')} event`);
}
async function rejectedSocket(url, token, t) {
  const socket = new Socket(url, token, t);
  try { await socket.open(); } catch (error) {
    assert.match(error.message, /Unexpected server response: (401|403)/);
    return;
  }
  const deadline = Date.now() + 2500;
  while (!socket.closeCode && Date.now() < deadline) await wait(20);
  assert.equal(socket.closeCode, 4001, 'Unauthorized socket remained usable');
}

test('AUTH-001 registration stores a BCrypt hash and returns no password hash', async () => {
  const email = `t06-${uuid()}@example.com`;
  const secret = `Strong${uuid()}9`;
  const response = await request('POST', '/auth/register', null,
    { email, password: secret, display_name: 'T06 auth', username: `u${uuid().replaceAll('-', '').slice(0, 20)}` });
  assert.equal(response.status, 201);
  const hash = sql(`SELECT password_hash FROM users WHERE email='${email}'`);
  assert.match(hash, /^\$2[aby]\$\d\d\$/);
  assert.notEqual(hash, secret);
  assert.equal(response.raw.includes(secret), false);
  assert.equal(response.raw.includes(hash), false);
  assert.equal(response.raw.includes('password_hash'), false);
});

test('AUTH-002 wrong and unknown credentials share a neutral error and create no refresh token', async () => {
  const a = await user();
  const before = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`);
  const good = await request('POST', '/auth/login', null, { email: a.email, password: a.password });
  assert.equal(good.status, 200);
  assert.ok(good.data?.tokens?.access_token);
  const afterGood = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`);
  assert.equal(Number(afterGood), Number(before) + 1);
  const wrong = await request('POST', '/auth/login', null, { email: a.email, password: 'Wrong123!' });
  const missing = await request('POST', '/auth/login', null,
    { email: `${uuid()}@example.com`, password: 'Wrong123!' });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(wrong.data, missing.data);
  assert.equal(wrong.raw.includes(a.password), false);
  assert.equal(wrong.data?.tokens, undefined);
  assert.equal(missing.data?.tokens, undefined);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`), afterGood);
});

test('AUTH-014 deleted account loses HTTP, refresh and WebSocket access', async t => {
  const a = await user();
  const existing = await messaging(a, t);
  await ok('DELETE', '/users/me', a.token, { password: a.password }, 204);
  assert.notEqual(sql(`SELECT deleted_at IS NULL FROM users WHERE id='${a.id}'`), 't');
  denied(await request('GET', '/users/me', a.token), [401]);
  denied(await request('POST', '/auth/refresh', null, { refresh_token: a.refresh }), [401]);
  await rejectedSocket(base.replace(/^http/, 'ws') + '/ws/messaging', a.token, t);
  await rejectedSocket(signalingUrl, a.token, t);
  const end = Date.now() + 6000;
  while (!existing.closeCode && Date.now() < end) await wait(50);
  assert.ok(existing.closeCode, 'Existing socket remained open after deletion');
});

test('AUTH-015 logout revokes refresh record and reuse is denied', async () => {
  const a = await user();
  const before = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NULL`);
  assert.equal(before, '1');
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NULL`), '0');
  denied(await request('POST', '/auth/refresh', null, { refresh_token: a.refresh }), [401]);
});

test('AUTH-018 malformed Bearer headers cannot authenticate', async () => {
  const a = await user();
  for (const value of [a.token, `Basic ${a.token}`,
    `Bearer ${a.token} extra`, `Bearer ${a.token}, Bearer ${a.token}`, 'Bearer']) {
    const response = await request('GET', '/users/me', null, undefined,
      { headers: { Authorization: value } });
    denied(response, [401]);
  }
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-024 separate logins create distinct token IDs and refresh records', async () => {
  const a = await user();
  const first = await ok('POST', '/auth/login', null, { email: a.email, password: a.password });
  const second = await ok('POST', '/auth/login', null, { email: a.email, password: a.password });
  const claim = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.notEqual(first.tokens.access_token, second.tokens.access_token);
  assert.notEqual(claim(first.tokens.access_token).jti, claim(second.tokens.access_token).jti);
  assert.notEqual(first.tokens.refresh_token, second.tokens.refresh_token);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NULL`), '3');
  await ok('POST', '/auth/logout', first.tokens.access_token,
    { refresh_token: first.tokens.refresh_token }, 204);
  denied(await request('GET', '/users/me', first.tokens.access_token), [401]);
  denied(await request('POST', '/auth/refresh', null,
    { refresh_token: first.tokens.refresh_token }), [401]);
  assert.equal((await ok('GET', '/users/me', second.tokens.access_token)).id, a.id);
  assert.ok((await ok('POST', '/auth/refresh', null,
    { refresh_token: second.tokens.refresh_token })).access_token);
});

test('AUTH-004 changed JWT signature cannot authenticate or mutate data', async () => {
  const a = await user();
  const parts = a.token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const altered = parts.join('.');
  const before = sql(`SELECT count(*) FROM conversations WHERE user_a_id='${a.id}' OR user_b_id='${a.id}'`);
  denied(await request('GET', '/users/me', altered), [401]);
  denied(await request('POST', '/conversations', altered, { other_user_id: uuid() }), [401]);
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE user_a_id='${a.id}' OR user_b_id='${a.id}'`), before);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-005 changed JWT payload cannot authenticate', async () => {
  const a = await user();
  const parts = a.token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.sub = uuid();
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  denied(await request('GET', '/users/me', parts.join('.')), [401]);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-006 unsigned JWT cannot authenticate', async () => {
  const a = await user();
  const claims = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString('utf8'));
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  denied(await request('GET', '/users/me', unsigned), [401]);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-007 refresh token is rejected as access on HTTP and WebSocket', async t => {
  const a = await user();
  denied(await request('GET', '/users/me', a.refresh), [401]);
  await rejectedSocket(base.replace(/^http/, 'ws') + '/ws/messaging', a.refresh, t);
  await rejectedSocket(signalingUrl, a.refresh, t);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-008 access token cannot replace refresh token', async () => {
  const a = await user();
  const before = sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`);
  denied(await request('POST', '/auth/refresh', null, { refresh_token: a.token }), [401]);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}'`), before);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('AUTH-010 logout revokes HTTP access without creating a conversation', async () => {
  const a = await user(), b = await user();
  const before = sql(`SELECT count(*) FROM conversations WHERE user_a_id='${a.id}' OR user_b_id='${a.id}'`);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  denied(await request('GET', '/users/me', a.token), [401]);
  denied(await request('POST', '/conversations', a.token, { other_user_id: b.id }), [401]);
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE user_a_id='${a.id}' OR user_b_id='${a.id}'`), before);
  denied(await request('POST', '/auth/refresh', null, { refresh_token: a.refresh }), [401]);
});

test('AUTH-011 revoked access cannot open new messaging WebSocket', async t => {
  const a = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await rejectedSocket(base.replace(/^http/, 'ws') + '/ws/messaging', a.token, t);
});

test('AUTH-012 and SIG-001 revoked access cannot signal after logout', async t => {
  const a = await user(), b = await user();
  const recipient = await signaling(b, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await rejectedSocket(signalingUrl, a.token, t);
  await quiet(recipient, ['CALL_OFFER', 'CALL_ANSWER', 'ICE_CANDIDATE']);
});

test('AUTH-013 logout of one user does not revoke another', async () => {
  const a = await user(), b = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  denied(await request('GET', '/users/me', a.token), [401]);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  const refreshed = await ok('POST', '/auth/refresh', null, { refresh_token: b.refresh });
  assert.equal((await ok('GET', '/users/me', refreshed.access_token)).id, b.id);
});

test('BOLA-001 outsider cannot read conversation detail', async () => {
  const p = await pair(), c = await user();
  const before = sql(`SELECT count(*) FROM conversations WHERE id='${p.id}'`);
  const response = await request('GET', `/conversations/${p.id}`, c.token);
  denied(response, [403]);
  assert.equal(response.raw.includes(p.a.id) || response.raw.includes(p.b.id), false);
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${p.id}'`), before);
});

test('BOLA-002 outsider cannot read conversation messages', async () => {
  const p = await pair(), c = await user();
  const sent = await message(p.a, p.id, `private-${uuid()}`);
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  const response = await request('GET', `/conversations/${p.id}/messages`, c.token);
  denied(response, [403]);
  assert.equal(response.raw.includes(sent.body.content), false);
  assert.equal(response.raw.includes(sent.body.id), false);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('BOLA-003 outsider cannot create a message or notify participants', async t => {
  const p = await pair(), c = await user();
  const aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  const payload = validMessage(`unauthorized-${uuid()}`);
  denied(await request('POST', `/conversations/${p.id}/messages`, c.token, payload), [403]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${payload.id}'`), '0');
  await quiet(aSocket, ['NEW_MESSAGE']);
  await quiet(bSocket, ['NEW_MESSAGE']);
});

test('BOLA-004 outsider cannot change message status or emit status events', async t => {
  const p = await pair(), c = await user();
  const sent = await message(p.a, p.id, `private-${uuid()}`);
  const aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  const before = sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`);
  denied(await request('PUT', `/conversations/${p.id}/messages/${sent.body.id}`, c.token,
    { status: 'read' }), [403]);
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`), before);
  await quiet(aSocket, ['MESSAGE_STATUS_UPDATE']);
  await quiet(bSocket, ['MESSAGE_STATUS_UPDATE']);
});

test('BOLA-006 outsider cannot reserve an upload chunk for the owner', async () => {
  const a = await user(), b = await user(), item = await video(b);
  const key = `video:upload:${item.id}`;
  const sessionBefore = redis('HGETALL', key);
  assert.ok(sessionBefore, 'Owner upload session is missing');
  denied(await request('POST', `/videos/${item.id}/chunks`, a.token,
    { upload_id: item.upload_id, part_number: 2, etag_previous: 'not-uploaded' }), [403]);
  assert.equal(redis('HGETALL', key), sessionBefore);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
  assert.equal((await ok('GET', `/videos/${item.id}`, b.token)).id, item.id);
});

test('BOLA-007 outsider cannot finalize owner upload', async () => {
  const a = await user(), b = await user(), item = await video(b);
  const key = `video:upload:${item.id}`;
  const sessionBefore = redis('HGETALL', key);
  denied(await request('POST', `/videos/${item.id}/finalize`, a.token,
    { upload_id: item.upload_id, duration_secs: 1, parts: [{ part_number: 1, etag: 'forged' }] }), [403]);
  assert.equal(redis('HGETALL', key), sessionBefore);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
  assert.equal((await ok('GET', `/videos/${item.id}`, b.token)).id, item.id);
});

test('BOLA-008 outsider cannot abort owner upload', async () => {
  const a = await user(), b = await user(), item = await video(b);
  const key = `video:upload:${item.id}`;
  const sessionBefore = redis('HGETALL', key);
  denied(await request('POST', `/videos/${item.id}/abort`, a.token, { upload_id: item.upload_id }), [403]);
  assert.equal(redis('HGETALL', key), sessionBefore);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
  assert.equal((await ok('GET', `/videos/${item.id}`, b.token)).id, item.id);
});

test('BOLA-009 outsider cannot read a ready video or receive a view URL', async () => {
  const a = await user(), b = await user();
  const owned = await readyVideo(b);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${owned.item.id}'`);
  const response = await request('GET', `/videos/${owned.item.id}`, a.token);
  denied(response, [403, 404]);
  assert.equal(response.raw.includes(owned.item.id), false);
  assert.equal(response.raw.includes('X-Amz-'), false);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${owned.item.id}'`), before);
  assert.equal((await ok('GET', `/videos/${owned.item.id}`, b.token)).status, 'ready');
});

test('BOLA-010 and BOLA-011 outsider cannot delete or rename owner video', async () => {
  const a = await user(), b = await user(), owned = await readyVideo(b);
  const path = `/videos/${owned.item.id}`;
  const before = sql(`SELECT title, status, deleted_at IS NULL FROM videos WHERE id='${owned.item.id}'`);
  denied(await request('PUT', path, a.token, { title: 'taken over' }), [403]);
  denied(await request('DELETE', path, a.token), [403]);
  assert.equal(sql(`SELECT title, status, deleted_at IS NULL FROM videos WHERE id='${owned.item.id}'`), before);
  const detail = await ok('GET', path, b.token);
  assert.equal(detail.status, 'ready');
  assert.notEqual(detail.title, 'taken over');
  assert.ok(detail.view_url);
});

test('WSM-007 outsider cannot spoof typing identity into a conversation', async t => {
  const p = await pair(), c = await user();
  const outsider = await messaging(c, t), aSocket = await messaging(p.a, t), bSocket = await messaging(p.b, t);
  outsider.send({ type: 'TYPING', data: { conversation_id: p.id, from_user_id: p.a.id } });
  await quiet(aSocket, ['TYPING']);
  await quiet(bSocket, ['TYPING']);
});

test('WSM-008 outsider receives no private message event', async t => {
  const p = await pair(), c = await user();
  const bSocket = await messaging(p.b, t), outsider = await messaging(c, t);
  const sent = await message(p.a, p.id, `private-${uuid()}`);
  assert.equal((await bSocket.take('NEW_MESSAGE')).data.id, sent.body.id);
  await quiet(outsider, ['NEW_MESSAGE']);
  assert.equal(outsider.events.some(event => JSON.stringify(event).includes(sent.body.content)), false);
});

test('WSM-009 already-open messaging socket loses access after logout', async t => {
  const p = await pair();
  const revoked = await messaging(p.a, t);
  await ok('POST', '/auth/logout', p.a.token, { refresh_token: p.a.refresh }, 204);
  const deadline = Date.now() + 6000;
  while (!revoked.closeCode && Date.now() < deadline) await wait(50);
  assert.equal(revoked.closeCode, 4002);
  const sent = await message(p.b, p.id, `after-logout-${uuid()}`);
  await quiet(revoked, ['NEW_MESSAGE']);
  assert.equal(revoked.events.some(event => JSON.stringify(event).includes(sent.body.content)), false);
});

test('WSM-012 client cannot publish server-only events', async t => {
  const p = await pair(), sender = await messaging(p.a, t), recipient = await messaging(p.b, t);
  const before = sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`);
  for (const type of ['NEW_MESSAGE', 'CALL_INCOMING', 'MESSAGE_STATUS_UPDATE']) {
    sender.send({ type, data: { conversation_id: p.id, id: uuid(), content: 'forged' } });
  }
  await quiet(recipient, ['NEW_MESSAGE', 'CALL_INCOMING', 'MESSAGE_STATUS_UPDATE']);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`), before);
});

test('WSM-014 schema violations expire per socket; third within window closes 1008', async t => {
  const p = await pair(), c = await user();
  const attacker = await messaging(c, t), other = await messaging(p.a, t);
  attacker.send({ type: 'TYPING', data: { conversation_id: p.id } });
  assert.equal((await attacker.take('ERROR')).data.code, 'FORBIDDEN');
  attacker.ws.send('{');
  assert.equal((await attacker.take('ERROR')).data.code, 'VALIDATION_ERROR');
  await wait(2300);
  attacker.ws.send('{');
  assert.equal((await attacker.take('ERROR')).data.code, 'VALIDATION_ERROR');
  assert.equal(attacker.ws.readyState, 1, 'Expired violation still counted');
  attacker.send({ type: 'UNKNOWN' });
  assert.equal((await attacker.take('ERROR')).data.code, 'UNSUPPORTED_EVENT');
  assert.equal(attacker.ws.readyState, 1, 'Socket closed before configured threshold');
  attacker.ws.send('{');
  assert.equal((await attacker.take('ERROR')).data.code, 'VALIDATION_ERROR');
  const deadline = Date.now() + 2000;
  while (!attacker.closeCode && Date.now() < deadline) await wait(20);
  assert.equal(attacker.closeCode, 1008);
  assert.equal(other.ws.readyState, 1, 'Another socket was affected');
});

test('SIG-005 and SIG-006 outsider cannot answer, send ICE, or end another call', async t => {
  const a = await user(), b = await user(), c = await user();
  const caller = await signaling(a, t), callee = await signaling(b, t), outsider = await signaling(c, t);
  const callId = uuid();
  caller.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id, data: { sdp: 'offer' } });
  assert.equal((await callee.take('CALL_OFFER')).call_id, callId);
  for (const type of ['CALL_ANSWER', 'ICE_CANDIDATE', 'CALL_END']) {
    outsider.send({ type, call_id: callId, target_user_id: a.id, data: { sdp: 'forged' } });
  }
  await quiet(caller, ['CALL_ANSWER', 'ICE_CANDIDATE', 'CALL_END']);
  callee.send({ type: 'CALL_ANSWER', call_id: callId, target_user_id: a.id, data: { sdp: 'real' } });
  assert.equal((await caller.take('CALL_ANSWER')).from_user_id, b.id);
});

test('SIG-004 caller identity comes from authenticated socket', async t => {
  const a = await user(), b = await user(), c = await user();
  const recipient = await signaling(b, t), attacker = await signaling(c, t);
  const callId = uuid();
  attacker.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id,
    from_user_id: a.id, data: { sdp: 'offer' } });
  const offer = await recipient.take('CALL_OFFER');
  assert.equal(offer.from_user_id, c.id);
  assert.notEqual(offer.from_user_id, a.id);
});

test('SIG-007 late callee receives the authenticated pending offer', async t => {
  const a = await user(), b = await user(), c = await user();
  const caller = await signaling(a, t), inbox = await messaging(b, t), outsider = await signaling(c, t);
  const callId = uuid();
  caller.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id, data: { sdp: 'offer' } });
  assert.equal((await inbox.take('CALL_INCOMING')).data.call_id, callId);
  const callee = await signaling(b, t);
  const offer = await callee.take('CALL_OFFER');
  assert.equal(offer.call_id, callId);
  assert.equal(offer.from_user_id, a.id);
  await quiet(outsider, ['CALL_OFFER']);
});

test('SIG-021 already-open signaling socket cannot relay after logout', async t => {
  const a = await user(), b = await user();
  const revoked = await signaling(a, t), recipient = await signaling(b, t);
  const inbox = await messaging(b, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  revoked.send({ type: 'CALL_OFFER', call_id: uuid(), target_user_id: b.id, data: { sdp: 'forged' } });
  await quiet(recipient, ['CALL_OFFER']);
  await quiet(inbox, ['CALL_INCOMING']);
  const deadline = Date.now() + 10_000;
  while (!revoked.closeCode && Date.now() < deadline) await wait(50);
  assert.equal(revoked.closeCode, 4001);
});

test('INT-001 notify without secret cannot emit CALL_INCOMING', async t => {
  const a = await user(), b = await user(), inbox = await messaging(b, t);
  const response = await request('POST', '/internal/call/notify', null,
    { caller_id: a.id, callee_id: b.id, call_id: uuid() });
  denied(response, [401, 403]);
  await quiet(inbox, ['CALL_INCOMING']);
});
