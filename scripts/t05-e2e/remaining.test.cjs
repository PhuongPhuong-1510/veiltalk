const { test: rawTest } = require('node:test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const h = require('../t04-api/support.cjs');
const { assert, caseTest: tc, user, pair, uuid, ok, request, sql, redis, wait, password,
  avatarModel, video, preparedVideo, readyVideo, abortVideo, uploadPart, message, messaging, signaling, Socket } = h;

const offer = (target, callId) => ({ type: 'CALL_OFFER', call_id: callId, target_user_id: target, data: { sdp: 'T05 remaining offer' } });
const action = (type, target, callId, data = {}) => ({ type, call_id: callId, target_user_id: target, data });
const metric = () => ({ session_type: 'preview', fps: 30, timestamp: new Date().toISOString() });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validFirstPart = () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  readFileSync(resolve(__dirname, '../t04-api/fixtures/valid.webm')).copy(bytes);
  return bytes;
};
async function waitForVideo(owner, id, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const detail = await ok('GET', `/videos/${id}`, owner.token);
    if (detail.status === 'ready') return detail;
    await wait(150);
  }
  throw new Error(`Video ${id} did not become ready`);
}
async function waitForClose(socket, code, timeout = 5000) {
  const end = Date.now() + timeout;
  while (socket.closeCode === undefined && Date.now() < end) await wait(20);
  assert.equal(socket.closeCode, code, `Expected WebSocket close ${code}, got ${socket.closeCode}`);
}
async function enterMetricsWindow() {
  while (Date.now() % 3000 > 400) await wait(25);
}

tc('T05-ACC-012', async t => {
  const a = await user();
  const a1 = a.token;
  const refreshed = await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh });
  const a2 = refreshed.access_token;
  const independent = await ok('POST', '/auth/login', null, { email: a.email, password });
  const b1 = independent.tokens.access_token;
  const a1Socket = await messaging({ token: a1 }, t);
  const a2Socket = await messaging({ token: a2 }, t);
  await ok('POST', '/auth/logout', a2, { refresh_token: a.refresh }, 204);
  assert.equal((await ok('GET', '/users/me', a1)).id, a.id);
  await ok('GET', '/users/me', a2, undefined, 401);
  await ok('POST', '/auth/refresh', null, { refresh_token: a.refresh }, 401);
  assert.equal((await ok('GET', '/users/me', b1)).id, a.id);
  await waitForClose(a2Socket, 4002);
  assert.equal(a1Socket.closeCode, undefined);
  assert.equal((await signaling({ token: a1 }, t)).ws.readyState, 1);
  assert.equal((await signaling({ token: b1 }, t)).ws.readyState, 1);
  const denied = await new Socket(h.signalingUrl, a2, t).open();
  await waitForClose(denied, 4001);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NOT NULL`), '1');
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NULL`), '1');
});

tc('T05-CON-008', async () => {
  const a = await user(), peers = await Promise.all(Array.from({ length: 4 }, () => user()));
  const conversations = [];
  for (const peer of peers) {
    conversations.push((await ok('POST', '/conversations', a.token, { other_user_id: peer.id }, 201)).id);
  }
  const tiedAt = '2026-01-01T00:00:00Z';
  sql(`ALTER TABLE conversations DISABLE TRIGGER trg_conversations_updated_at; UPDATE conversations SET updated_at='${tiedAt}' WHERE id IN (${conversations.map(id => `'${id}'`).join(',')}); ALTER TABLE conversations ENABLE TRIGGER trg_conversations_updated_at;`);
  const expected = conversations.slice().sort().reverse();
  const seen = [];
  let cursor;
  do {
    const page = await ok('GET', `/conversations?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, a.token);
    seen.push(...page.data.map(item => item.id));
    cursor = page.next_cursor;
    if (!page.has_more) break;
    assert.ok(cursor);
  } while (seen.length <= conversations.length);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, conversations.length);
});

tc('T05-WS-005', async t => {
  const p = await pair(), receiver = await messaging(p.b, t);
  const deadline = Date.now() + 6000;
  while ((receiver.pingCount ?? 0) < 2 && Date.now() < deadline) await wait(25);
  assert.ok(receiver.pingCount >= 2, `Expected at least two PINGs, received ${receiver.pingCount ?? 0}`);
  assert.equal(receiver.closeCode, undefined);
  const sent = await message(p.a, p.id, 'after two heartbeat cycles');
  assert.equal((await receiver.take('NEW_MESSAGE')).data.id, sent.body.id);
});

tc('T05-WS-011', async t => {
  const p = await pair(), receiver = await messaging(p.b, t), sender = await messaging(p.a, t);
  await ok('POST', '/auth/logout', p.b.token, { refresh_token: p.b.refresh }, 204);
  await waitForClose(receiver, 4002);
  await ok('GET', '/users/me', p.b.token, undefined, 401);
  const sent = await message(p.a, p.id, 'persist after receiver revocation');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`), '1');
  assert.equal((await ok('GET', `/conversations/${p.id}/messages`, p.a.token)).data[0].id, sent.body.id);
  assert.equal(sender.closeCode, undefined);
});

rawTest('T05-CALL-008', { timeout: 120_000 }, async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t), sb = await signaling(b, t);
  const first = uuid();
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  const ended = await sa.take('CALL_END', 45_000);
  assert.equal(ended.data.reason, 'timeout');
  const next = uuid();
  sa.send(offer(b.id, next));
  assert.equal((await sb.take('CALL_OFFER')).call_id, next);
  sb.send(action('CALL_REJECT', a.id, next));
  assert.equal((await sa.take('CALL_REJECT')).call_id, next);
});

rawTest('T05-VID-007', { timeout: 120_000 }, async () => {
  const a = await user(), item = await video(a, { estimated_size_bytes: 10 * 1024 * 1024 + 64 });
  const first = validFirstPart(), second = Buffer.alloc(5 * 1024 * 1024, 0x32), last = Buffer.from('third final part');
  const etag1 = await uploadPart(item.first_chunk_url, first);
  const part2 = await ok('POST', `/videos/${item.id}/chunks`, a.token, { upload_id: item.upload_id, part_number: 2, etag_previous: etag1 });
  const etag2 = await uploadPart(part2.chunk_url, second);
  const part3 = await ok('POST', `/videos/${item.id}/chunks`, a.token, { upload_id: item.upload_id, part_number: 3, etag_previous: etag2 });
  const etag3 = await uploadPart(part3.chunk_url, last);
  await ok('POST', `/videos/${item.id}/finalize`, a.token, { upload_id: item.upload_id, duration_secs: 3,
    parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }, { part_number: 3, etag: etag3 }] }, 202);
  const detail = await waitForVideo(a, item.id);
  const response = await fetch(detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(Buffer.concat([first, second, last])));
  assert.equal(detail.file_size_bytes, first.length + second.length + last.length);
  assert.equal(redis('EXISTS', `video:upload:${item.id}`), '0');
});

rawTest('T05-VID-008', { timeout: 120_000 }, async () => {
  const a = await user(), item = await video(a);
  const first = validFirstPart(), last = Buffer.from('retry part URL');
  const etag1 = await uploadPart(item.first_chunk_url, first);
  const payload = { upload_id: item.upload_id, part_number: 2, etag_previous: etag1 };
  const firstUrl = await ok('POST', `/videos/${item.id}/chunks`, a.token, payload);
  const retryUrl = await ok('POST', `/videos/${item.id}/chunks`, a.token, payload);
  assert.equal(firstUrl.part_number, 2);
  assert.equal(retryUrl.part_number, 2);
  const etag2 = await uploadPart(retryUrl.chunk_url, last);
  await ok('POST', `/videos/${item.id}/finalize`, a.token, { upload_id: item.upload_id, duration_secs: 2,
    parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }] }, 202);
  const detail = await waitForVideo(a, item.id);
  assert.equal(detail.file_size_bytes, first.length + last.length);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${item.id}'`), '1');
});

rawTest('T05-VID-009', { timeout: 120_000 }, async () => {
  const a = await user(), v = await preparedVideo(a);
  await ok('POST', `/videos/${v.item.id}/finalize`, a.token, v.finalize, 202);
  await ok('POST', `/videos/${v.item.id}/finalize`, a.token, v.finalize, 409);
  const detail = await waitForVideo(a, v.item.id);
  assert.equal(detail.status, 'ready');
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${v.item.id}' AND status='ready' AND deleted_at IS NULL`), '1');
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '0');
});

tc('T05-VID-010', async () => {
  const a = await user(), recording = await video(a), ready = await readyVideo(a);
  const all = await ok('GET', '/videos', a.token);
  assert.equal(all.data.find(item => item.id === recording.id)?.status, 'recording');
  assert.equal(all.data.find(item => item.id === ready.item.id)?.status, 'ready');
  assert.equal((await ok('GET', '/videos?status=recording', a.token)).data.some(item => item.id === recording.id), true);
  const readyFilter = await ok('GET', '/videos?status=ready', a.token);
  assert.equal(readyFilter.data.some(item => item.id === ready.item.id), true);
  assert.equal(readyFilter.data.some(item => item.id === recording.id), false);
  assert.equal(readyFilter.storage_used_bytes, ready.detail.file_size_bytes);
  await abortVideo(a, recording);
});

tc('T05-VID-011', async () => {
  const a = await user(), items = [];
  for (let i = 0; i < 2; i += 1) items.push((await readyVideo(a)).item);
  for (let i = 2; i < 5; i += 1) items.push(await video(a, { title: `page-${i}` }));
  const expected = sql(`SELECT id FROM videos WHERE user_id='${a.id}' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`).split(/\s+/).filter(Boolean);
  const seen = [];
  let cursor;
  do {
    const page = await ok('GET', `/videos?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, a.token);
    seen.push(...page.data.map(item => item.id));
    cursor = page.next_cursor;
    if (!page.has_more) break;
    assert.ok(cursor);
  } while (seen.length <= items.length);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, items.length);
  for (const item of items.slice(2)) await abortVideo(a, item);
});

tc('T05-VID-013', async () => {
  const a = await user(), v = await readyVideo(a);
  const response = await fetch(v.detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), digest(Buffer.concat([v.first, v.last])));
  assert.equal(bytes.length, v.detail.file_size_bytes);
  assert.equal((await ok('GET', '/videos', a.token)).data.some(item => item.id === v.item.id), true);
});

rawTest('T05-VID-014', { timeout: 120_000 }, async () => {
  const a = await user(), first = await readyVideo(a), second = await readyVideo(a);
  const before = await ok('GET', '/videos', a.token);
  assert.equal(before.storage_used_bytes, first.detail.file_size_bytes + second.detail.file_size_bytes);
  await ok('DELETE', `/videos/${first.item.id}`, a.token, undefined, 204);
  const middle = await ok('GET', '/videos', a.token);
  assert.equal(middle.storage_used_bytes, second.detail.file_size_bytes);
  await ok('DELETE', `/videos/${second.item.id}`, a.token, undefined, 204);
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
});

tc('T05-VID-015', async () => {
  const a = await user(), v = await readyVideo(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${v.item.id}'`);
  const webhook = { Records: [{ eventName: 's3:ObjectCreated:CompleteMultipartUpload',
    s3: { bucket: { name: 'veiltalk-e2e' }, object: { key, size: v.detail.file_size_bytes } } }] };
  const headers = { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` };
  const before = await ok('GET', '/videos', a.token);
  for (let i = 0; i < 2; i += 1) {
    const replay = await request('POST', '/internal/videos/webhook', null, webhook, { headers });
    assert.equal(replay.status, 204);
  }
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${v.item.id}' AND status='ready' AND deleted_at IS NULL`), '1');
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, before.storage_used_bytes);
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '0');
});

tc('T05-VID-016', async () => {
  const a = await user(), ready = await readyVideo(a), recording = await video(a);
  const readyDetail = await ok('GET', `/videos/${ready.item.id}`, a.token);
  const bytes = await fetch(readyDetail.view_url, { signal: AbortSignal.timeout(15000) });
  const before = Buffer.from(await bytes.arrayBuffer());
  await ok('POST', `/videos/${recording.id}/abort`, a.token, { upload_id: recording.upload_id }, 204);
  const after = await ok('GET', `/videos/${ready.item.id}`, a.token);
  const afterBytes = await fetch(after.view_url, { signal: AbortSignal.timeout(15000) });
  assert.deepEqual(Buffer.from(await afterBytes.arrayBuffer()), before);
  assert.equal(after.status, 'ready');
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${ready.item.id}' AND status='ready' AND deleted_at IS NULL`), '1');
  assert.equal(redis('EXISTS', `video:upload:${recording.id}`), '0');
});

tc('T05-VID-017', async () => {
  const a = await user(), v = await preparedVideo(a), wrong = structuredClone(v.finalize);
  wrong.parts[1].etag = 'invalid-etag';
  await ok('POST', `/videos/${v.item.id}/finalize`, a.token, wrong, 400);
  assert.equal((await ok('GET', `/videos/${v.item.id}`, a.token)).status, 'recording');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${v.item.id}'`), 'recording');
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '1');
  await abortVideo(a, v.item);
});

rawTest('T05-VID-018', { timeout: 120_000 }, async () => {
  const a = await user(), b = await user(), va = await video(a), vb = await video(b);
  const bytes = Buffer.alloc(5 * 1024 * 1024, 0x55);
  const [etagA, etagB] = await Promise.all([
    uploadPart(va.first_chunk_url, bytes), uploadPart(vb.first_chunk_url, bytes),
  ]);
  const [partA, partB] = await Promise.all([
    ok('POST', `/videos/${va.id}/chunks`, a.token, { upload_id: va.upload_id, part_number: 2, etag_previous: etagA }),
    ok('POST', `/videos/${vb.id}/chunks`, b.token, { upload_id: vb.upload_id, part_number: 2, etag_previous: etagB }),
  ]);
  assert.equal(partA.part_number, 2);
  assert.equal(partB.part_number, 2);
  assert.equal(redis('EXISTS', `video:upload:${va.id}`), '1');
  assert.equal(redis('EXISTS', `video:upload:${vb.id}`), '1');
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id IN ('${va.id}','${vb.id}') AND status='recording'`), '2');
  const cleanup = await Promise.all([abortVideo(a, va), abortVideo(b, vb)]);
  assert.deepEqual(cleanup.map(response => response.status), [204, 204]);
});

rawTest('T05-DEL-003', { timeout: 120_000 }, async () => {
  const a = await user(), b = await user(), retained = await readyVideo(a), independent = await readyVideo(b);
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('GET', '/videos', a.token, undefined, 401);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${retained.item.id}' AND user_id='${a.id}'`), 'ready');
  assert.equal(sql(`SELECT deleted_at IS NULL FROM videos WHERE id='${retained.item.id}'`), 't');
  const retainedBytes = await fetch(retained.detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(retainedBytes.status, 200);
  assert.equal(digest(Buffer.from(await retainedBytes.arrayBuffer())), digest(Buffer.concat([retained.first, retained.last])));
  const downloaded = await fetch(independent.detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(downloaded.status, 200);
  assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), digest(Buffer.concat([independent.first, independent.last])));
  assert.equal((await ok('GET', `/videos/${independent.item.id}`, b.token)).status, 'ready');
});

tc('T05-DEL-004', async () => {
  const a = await user(), b = await user();
  const name = `Deleted profile ${uuid()}`;
  const avatar = `https://example.com/avatar/${uuid()}.png`;
  await ok('PUT', '/users/me', b.token, { display_name: name, avatar_url: avatar });
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  const conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const first = await message(a, conversation.id, 'History from A');
  const second = await message(b, conversation.id, 'History from B');
  const path = `/conversations/${conversation.id}`;
  const before = await ok('GET', `${path}/messages`, a.token);
  assert.deepEqual(new Set(before.data.map(item => item.id)), new Set([first.body.id, second.body.id]));
  assert.equal((await ok('GET', path, a.token)).other_user.display_name, name);
  assert.equal((await ok('GET', '/conversations', a.token)).data.find(item => item.id === conversation.id).other_user.avatar_url, avatar);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${conversation.id}'`), '2');

  await ok('DELETE', '/users/me', b.token, { password }, 204);
  await ok('GET', '/users/me', b.token, undefined, 401);
  await ok('POST', '/auth/login', null, { email: b.email, password }, 401);
  await ok('POST', '/auth/refresh', null, { refresh_token: b.refresh }, 401);
  const detail = await ok('GET', path, a.token);
  const summary = (await ok('GET', '/conversations', a.token)).data.find(item => item.id === conversation.id);
  for (const other of [detail.other_user, summary.other_user]) {
    assert.equal(other.id, b.id);
    assert.equal(other.display_name, 'Deleted user');
    assert.equal(other.avatar_url, null);
  }
  const history = await ok('GET', `${path}/messages`, a.token);
  assert.deepEqual(new Set(history.data.map(item => item.id)), new Set([first.body.id, second.body.id]));
  assert.equal(history.data.find(item => item.id === first.body.id).content, first.body.content);
  assert.equal(history.data.find(item => item.id === second.body.id).content, second.body.content);
  const search = await ok('POST', '/users/search', a.token, { email: b.email });
  assert.equal(search.found, false);
  assert.equal(search.user, null);
  await ok('POST', `${path}/messages`, a.token,
    { id: uuid(), content: 'New message after deletion', client_timestamp: new Date().toISOString() }, 404);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${b.id}'`), 't');
  assert.equal(sql(`SELECT count(*) FROM conversations WHERE id='${conversation.id}' AND deleted_at IS NULL`), '1');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${conversation.id}'`), '2');
});

tc('T05-DEL-005', async () => {
  const a = await user(), b = await user(), model = await avatarModel(b.token);
  await ok('PUT', '/avatars/me', b.token, { model_id: model.id }, 201);
  assert.equal((await ok('GET', `/avatars/${b.id}`, a.token)).user_id, b.id);
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  await ok('DELETE', '/users/me', b.token, { password }, 204);
  await ok('GET', `/avatars/${b.id}`, a.token, undefined, 404);
  const search = await ok('POST', '/users/search', a.token, { email: b.email });
  assert.equal(search.found, false);
  assert.equal(search.user, null);
  await ok('POST', '/auth/login', null, { email: b.email, password }, 401);
  await ok('POST', '/auth/refresh', null, { refresh_token: b.refresh }, 401);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${b.id}'`), 't');
});

tc('T05-DEL-006', async () => {
  const a = await user(), b = await user(), model = await avatarModel(a.token);
  const conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  const recording = await video(a), bytes = Buffer.alloc(5 * 1024 * 1024, 0x66);
  await uploadPart(recording.first_chunk_url, bytes);
  await ok('DELETE', '/users/me', a.token, { password: 'WrongPassword123!' }, 401);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal((await ok('GET', '/avatars/me', a.token)).user_id, a.id);
  assert.equal((await ok('GET', `/conversations/${conversation.id}`, a.token)).id, conversation.id);
  assert.equal((await ok('GET', `/videos/${recording.id}`, a.token)).status, 'recording');
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${a.id}' AND revoked_at IS NOT NULL`), '0');
  assert.equal(redis('EXISTS', `video:upload:${recording.id}`), '1');
  const next = await ok('POST', `/videos/${recording.id}/chunks`, a.token,
    { upload_id: recording.upload_id, part_number: 2, etag_previous: await uploadPart(recording.first_chunk_url, bytes) });
  assert.equal(next.part_number, 2);
  await abortVideo(a, recording);
});

tc('T05-DEL-007', async t => {
  const a = await user(), b = await user(), c = await user();
  const bc = await ok('POST', '/conversations', b.token, { other_user_id: c.id }, 201);
  const bSocket = await messaging(b, t);
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.equal((await ok('GET', '/conversations', b.token)).data.some(item => item.id === bc.id), true);
  const cSocket = await messaging(c, t), sent = await message(b, bc.id, 'B remains active');
  assert.equal((await cSocket.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal(bSocket.closeCode, undefined);
  assert.equal(sql(`SELECT count(*) FROM refresh_tokens WHERE user_id='${b.id}' AND revoked_at IS NULL`), '1');
});

tc('T05-DEL-008', async t => {
  const a = await user(), b = await user(), c = await user(), oldSocket = await messaging(a, t);
  const bSocket = await messaging(b, t), bc = await ok('POST', '/conversations', b.token, { other_user_id: c.id }, 201);
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await waitForClose(oldSocket, 4002);
  await ok('GET', '/users/me', a.token, undefined, 401);
  const cSocket = await messaging(c, t), sent = await message(b, bc.id, 'unrelated account remains live');
  assert.equal((await cSocket.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal(bSocket.closeCode, undefined);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}' AND sender_id='${b.id}'`), '1');
});

tc('T05-MET-001', async () => {
  const a = await user(), before = await ok('GET', '/users/me', a.token), rowCount = sql(`SELECT count(*) FROM users WHERE id='${a.id}'`);
  const response = await request('POST', '/metrics/client', a.token, metric());
  assert.equal(response.status, 204);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id='${a.id}'`), rowCount);
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${a.id}'`), before.display_name);
});

tc('T05-MET-002', async () => {
  const a = await user();
  await enterMetricsWindow();
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 204);
  const limited = await request('POST', '/metrics/client', a.token, metric());
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await ok('GET', '/conversations', a.token)).data.length, 0);
  assert.ok((await ok('GET', '/avatars/models', a.token)).models.length > 0);
  await wait(Math.max(2100, Number(limited.headers.get('retry-after')) * 1000 + 100));
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 204);
});

tc('T05-MET-003', async () => {
  const a = await user(), b = await user();
  await enterMetricsWindow();
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 204);
  assert.equal((await request('POST', '/metrics/client', b.token, metric())).status, 204);
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 429);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.match(redis('KEYS', `rate:metrics-client:${a.id}:*`), new RegExp(`rate:metrics-client:${a.id}:`));
  assert.match(redis('KEYS', `rate:metrics-client:${b.id}:*`), new RegExp(`rate:metrics-client:${b.id}:`));
});

tc('T05-MET-004', async () => {
  const a = await user();
  const invalid = await request('POST', '/metrics/client', a.token, { ...metric(), session_type: 'unknown' });
  assert.equal(invalid.status, 400);
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 204);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

tc('T05-CROSS-006', async t => {
  const a = await user(), b = await user(), conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const inbox = await messaging(b, t), displayName = 'Fresh caller name', sa = await signaling(a, t), sb = await signaling(b, t);
  await ok('PUT', '/users/me', a.token, { display_name: displayName });
  const detail = await ok('GET', `/conversations/${conversation.id}`, b.token);
  assert.equal(detail.other_user.display_name, displayName);
  const callId = uuid();
  sa.send(offer(b.id, callId));
  const incoming = await inbox.take('CALL_INCOMING');
  assert.equal(incoming.data.caller_id, a.id);
  assert.equal(incoming.data.caller_display_name, displayName);
  assert.equal(incoming.data.call_id, callId);
  assert.equal((await sb.take('CALL_OFFER')).call_id, callId);
  sb.send(action('CALL_REJECT', a.id, callId));
  assert.equal((await sa.take('CALL_REJECT')).call_id, callId);
});

tc('T05-CROSS-007', async t => {
  const a = await user(), b = await user(), conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const inbox = await messaging(b, t);
  await enterMetricsWindow();
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 204);
  assert.equal((await request('POST', '/metrics/client', a.token, metric())).status, 429);
  for (let i = 0; i < 10; i += 1) assert.equal((await request('POST', '/users/search', a.token, { email: `no-${i}@example.com` })).status, 200);
  assert.equal((await request('POST', '/users/search', a.token, { email: 'no-more@example.com' })).status, 429);
  const sent = await message(a, conversation.id, 'business APIs survive rate limits');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal((await ok('GET', '/conversations', a.token)).data[0].id, conversation.id);
  assert.deepEqual((await ok('GET', '/videos', a.token)).data, []);
});

tc('T05-CROSS-008', async t => {
  const a = await user(), b = await user(), c = await user(), independent = await readyVideo(b);
  const bc = await ok('POST', '/conversations', b.token, { other_user_id: c.id }, 201), inbox = await messaging(c, t);
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  assert.equal((await ok('GET', `/videos/${independent.item.id}`, b.token)).status, 'ready');
  const sent = await message(b, bc.id, 'remaining account still chats');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${independent.item.id}' AND user_id='${b.id}' AND status='ready'`), '1');
});
