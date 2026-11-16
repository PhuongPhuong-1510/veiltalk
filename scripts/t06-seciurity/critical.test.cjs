const h = require('../t04-api/support.cjs');
const { createHmac } = require('node:crypto');
const { assert, caseTest: test, request, ok, user, video, readyVideo, preparedVideo,
  sql, redis, uuid, wait, Socket, base, signalingUrl, uploadPart } = h;

function denied(response, statuses = [401, 403, 404]) {
  assert.ok(statuses.includes(response.status), `Expected denial; HTTP ${response.status}`);
  assert.equal(response.data?.view_url, undefined);
  assert.doesNotMatch(response.raw, /X-Amz-Signature|password_hash|stacktrace/i);
}
async function refusedSocket(url, token, t) {
  const socket = new Socket(url, token, t);
  await socket.open();
  const deadline = Date.now() + 3000;
  while (!socket.closeCode && Date.now() < deadline) await wait(25);
  assert.equal(socket.closeCode, 4001, 'Unauthorized signaling socket stayed open');
  assert.equal(socket.events.some(event => event.type?.startsWith('CALL_')), false);
}
function expiredToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ type: 'access', jti: uuid(), sub: userId,
    role: 'user', iat: now - 120, exp: now - 60 })).toString('base64url');
  const signed = `${header}.${payload}`;
  return `${signed}.${createHmac('sha256', process.env.E2E_JWT_SECRET).update(signed).digest('base64url')}`;
}
const webhook = key => ({ Records: [{ eventName: 's3:ObjectCreated:CompleteMultipartUpload',
  s3: { bucket: { name: 'veiltalk-e2e' }, object: { key, size: 12 } } }] });

test('AUTH-003 protected HTTP routes require Authorization and have no write side effect', async () => {
  const a = await user(), item = await video(a);
  const before = sql('SELECT count(*) FROM conversations');
  const routes = [
    ['GET', '/users/me'], ['PUT', '/users/me', { display_name: 'unauthorized' }],
    ['DELETE', '/users/me', { password: a.password }],
    ['GET', '/users/me/settings'], ['PUT', '/users/me/settings', { is_discoverable: true }],
    ['POST', '/users/search', { email: a.email }],
    ['GET', '/avatars/me'], ['PUT', '/avatars/me', { model_id: 'unknown' }],
    ['GET', '/conversations'], ['POST', '/conversations', { other_user_id: a.id }],
    ['GET', '/videos'], ['GET', `/videos/${item.id}`],
    ['POST', '/videos', { title: 'unauthorized', estimated_size_bytes: 1,
      chunk_size_bytes: 5242880 }],
    ['POST', '/metrics/client', { session_type: 'preview', fps: 30,
      timestamp: new Date().toISOString() }],
  ];
  for (const [method, path, body] of routes) denied(await request(method, path, null, body), [401]);
  assert.equal(sql('SELECT count(*) FROM conversations'), before);
  assert.equal(sql(`SELECT deleted_at IS NULL FROM users WHERE id='${a.id}'`), 't');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
});

test('AUTH-009 expired signed JWT is rejected by HTTP and both WebSockets', async t => {
  const a = await user(), expired = expiredToken(a.id);
  denied(await request('GET', '/users/me', expired), [401]);
  const messaging = new Socket(base.replace(/^http/, 'ws') + '/ws/messaging', expired, t);
  try { await messaging.open(); } catch (error) {
    assert.match(error.message, /Unexpected server response: (401|403)/);
  }
  assert.notEqual(messaging.ws.readyState, 1);
  await refusedSocket(signalingUrl, expired, t);
  assert.equal((await ok('GET', '/users/me', a.token)).id, a.id);
});

test('SIG-002 absent, malformed and changed-signature token cannot signal', async t => {
  const a = await user(), parts = a.token.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  for (const token of [null, 'malformed', parts.join('.')]) {
    await refusedSocket(signalingUrl, token, t);
  }
});

test('SIG-003 refresh token cannot authenticate signaling', async t => {
  const a = await user();
  await refusedSocket(signalingUrl, a.refresh, t);
});

test('VID-001 outsider cannot obtain owner download URL or read unsigned object', async () => {
  const a = await user(), b = await user(), prepared = await readyVideo(b);
  denied(await request('GET', `/videos/${prepared.item.id}`, a.token), [403, 404]);
  const direct = new URL(prepared.detail.view_url);
  direct.search = '';
  const storage = await fetch(direct, { signal: AbortSignal.timeout(5000) });
  assert.ok([401, 403, 404].includes(storage.status), `Unsigned object GET returned ${storage.status}`);
  await storage.arrayBuffer();
  assert.equal((await ok('GET', `/videos/${prepared.item.id}`, b.token)).status, 'ready');
});

test('VID-002 outsider cannot reserve a part in owner multipart upload', async () => {
  const a = await user(), b = await user(), item = await video(b);
  const before = redis('HGETALL', `video:upload:${item.id}`);
  denied(await request('POST', `/videos/${item.id}/chunks`, a.token,
    { upload_id: item.upload_id, part_number: 2, etag_previous: 'forged' }), [403]);
  assert.equal(redis('HGETALL', `video:upload:${item.id}`), before);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
});

test('VID-003 outsider cannot finalize owner multipart with actual part metadata', async () => {
  const a = await user(), b = await user(), prepared = await preparedVideo(b);
  const before = redis('HGETALL', `video:upload:${prepared.item.id}`);
  denied(await request('POST', `/videos/${prepared.item.id}/finalize`, a.token, prepared.finalize), [403]);
  assert.equal(redis('HGETALL', `video:upload:${prepared.item.id}`), before);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`), 'recording');
});

test('VID-004 outsider cannot abort owner multipart or remove session', async () => {
  const a = await user(), b = await user(), item = await video(b);
  const before = redis('HGETALL', `video:upload:${item.id}`);
  denied(await request('POST', `/videos/${item.id}/abort`, a.token,
    { upload_id: item.upload_id }), [403]);
  assert.equal(redis('HGETALL', `video:upload:${item.id}`), before);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
});

test('VID-005 changed presigned part signature is rejected without creating a part', async () => {
  const a = await user(), item = await video(a);
  const before = redis('HGETALL', `video:upload:${item.id}`);
  const url = new URL(item.first_chunk_url);
  const signature = url.searchParams.get('X-Amz-Signature');
  assert.ok(signature);
  url.searchParams.set('X-Amz-Signature', (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1));
  const response = await fetch(url, { method: 'PUT', body: Buffer.alloc(1024),
    signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 403);
  await response.arrayBuffer();
  assert.equal(redis('HGETALL', `video:upload:${item.id}`), before);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'recording');
});

test('VID-007 forged completion webhook without secret cannot mark video READY', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  denied(await request('POST', '/internal/videos/webhook', null, webhook(key)), [401]);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('VID-008 wrong shared secret and user JWT cannot mark video READY', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  for (const credential of ['wrong-secret', a.token]) {
    const response = await request('POST', '/internal/videos/webhook', null, webhook(key),
      { headers: { Authorization: `Bearer ${credential}` } });
    denied(response, [401]);
    assert.equal(response.raw.includes(process.env.E2E_WEBHOOK_SECRET), false);
  }
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('VID-009 valid-secret webhook for another or missing object cannot mark READY', async () => {
  const a = await user(), first = await video(a), second = await video(a);
  const firstKey = sql(`SELECT storage_path FROM videos WHERE id='${first.id}'`);
  const secondKey = sql(`SELECT storage_path FROM videos WHERE id='${second.id}'`);
  const before = sql(`SELECT id, status, file_size_bytes FROM videos WHERE id IN ('${first.id}','${second.id}') ORDER BY id`);
  for (const key of [firstKey, secondKey, `videos/${uuid()}/missing.webm`]) {
    const response = await request('POST', '/internal/videos/webhook', null, webhook(key),
      { headers: { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` } });
    assert.ok([204, 400, 404, 409].includes(response.status));
  }
  assert.equal(sql(`SELECT id, status, file_size_bytes FROM videos WHERE id IN ('${first.id}','${second.id}') ORDER BY id`), before);
});

test('VID-011 wrong MinIO ETag cannot finalize or consume owner upload session', async () => {
  const a = await user(), prepared = await preparedVideo(a);
  const before = redis('HGETALL', `video:upload:${prepared.item.id}`);
  const bad = { ...prepared.finalize, parts: prepared.finalize.parts.map((part, index) =>
    index === 1 ? { ...part, etag: 'forged' } : part) };
  denied(await request('POST', `/videos/${prepared.item.id}/finalize`, a.token, bad), [400, 409]);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`), 'recording');
  assert.equal(redis('HGETALL', `video:upload:${prepared.item.id}`), before);
  assert.equal((await ok('POST', `/videos/${prepared.item.id}/finalize`, a.token, prepared.finalize, 202)).status, 'processing');
});

test('VID-012 duplicate, missing or out-of-order parts cannot finalize', async () => {
  const a = await user(), prepared = await preparedVideo(a);
  const original = prepared.finalize.parts;
  const before = redis('HGETALL', `video:upload:${prepared.item.id}`);
  for (const parts of [[original[0]], [original[0], original[0]], [...original].reverse()]) {
    denied(await request('POST', `/videos/${prepared.item.id}/finalize`, a.token,
      { ...prepared.finalize, parts }), [400, 409]);
    assert.equal(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`), 'recording');
  }
  assert.equal(redis('HGETALL', `video:upload:${prepared.item.id}`), before);
  assert.equal((await ok('POST', `/videos/${prepared.item.id}/finalize`, a.token, prepared.finalize, 202)).status, 'processing');
});

test('ABUSE-001 user search is capped at ten requests per minute', async () => {
  const a = await user();
  const seconds = Math.floor(Date.now() / 1000) % 60;
  if (seconds > 48) await wait((62 - seconds) * 1000);
  const body = { email: `${uuid()}@example.com` };
  for (let i = 0; i < 10; i++) {
    const response = await request('POST', '/users/search', a.token, body);
    assert.equal(response.status, 200, `Search ${i + 1} was blocked early`);
  }
  const blocked = await request('POST', '/users/search', a.token, body);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const window = Math.floor(Date.now() / 60000);
  assert.equal(redis('GET', `rate:user-search:${a.id}:${window}`), '11');
});
