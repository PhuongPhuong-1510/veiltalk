const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');

const base = process.env.E2E_BACKEND_URL;
const signalUrl = process.env.E2E_SIGNALING_URL;
assert.ok(base && signalUrl && process.env.E2E_PG_CONTAINER?.startsWith('veiltalk-e2e-'),
  'Run node scripts/e2e/run.cjs to create an isolated environment');
const options = { timeout: 30000 };
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = 'E2eStrong123!';
async function api(method, path, token, body, expected = 200) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(10000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  // Do not put response bodies into errors: auth responses contain tokens.
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}, error=${data?.error?.code ?? 'none'}`);
  return data;
}
async function user() {
  const email = `e2e-${randomUUID()}@example.com`;
  const username = `u${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const r = await api('POST', '/auth/register', null, { email, password, display_name: 'E2E User', username }, 201);
  assert.ok(r.tokens.access_token && r.tokens.refresh_token);
  return { id: r.user.id, email, token: r.tokens.access_token, refresh: r.tokens.refresh_token };
}
async function pair() {
  const a = await user(), b = await user();
  const c = await api('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  return { a, b, conversation: c.id };
}
const message = content => ({ id: randomUUID(), content, client_timestamp: new Date().toISOString() });
function uuid(value) { assert.match(value, /^[a-f0-9-]{36}$/i); return value; }
function sql(query) {
  return execFileSync('docker', ['exec', process.env.E2E_PG_CONTAINER, 'psql', '-U', 'e2e', '-d', 'veiltalk_e2e', '-At', '-c', query],
    { encoding: 'utf8', timeout: 10000 }).trim();
}
function redis(...args) {
  return execFileSync('docker', ['exec', process.env.E2E_REDIS_CONTAINER, 'redis-cli', '--raw', ...args],
    { encoding: 'utf8', timeout: 10000 }).trim();
}
class Client {
  constructor(url, token, t) {
    this.messages = [];
    this.ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    this.ws.on('error', () => {});
    this.ws.on('close', code => { this.closeCode = code; });
    this.ws.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type === 'PING') this.send({ type: 'PONG' });
      else this.messages.push(event);
    });
    t.after(() => this.close());
  }
  async open() {
    await new Promise((ok, no) => {
      const timer = setTimeout(() => no(new Error('WebSocket open timeout')), 5000);
      this.ws.once('open', () => { clearTimeout(timer); ok(); });
      this.ws.once('error', error => { clearTimeout(timer); no(error); });
    });
    return this;
  }
  send(data) { this.ws.send(JSON.stringify(data)); }
  async take(type, predicate = () => true, timeout = 5000) {
    const end = Date.now() + timeout;
    do {
      const index = this.messages.findIndex(m => m.type === type && predicate(m));
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(20);
    } while (Date.now() < end);
    throw new Error(`Missing ${type}; received types=${this.messages.map(m => m.type).join(',')}; closeCode=${this.closeCode ?? 'open'}`);
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise(ok => {
      const timer = setTimeout(() => { this.ws.terminate(); ok(); }, 1000);
      this.ws.once('close', () => { clearTimeout(timer); ok(); });
      if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
      else this.ws.close();
    });
  }
}
const messaging = (u, t) => new Client(base.replace('http:', 'ws:') + '/ws/messaging', u.token, t).open();
const signaling = (u, t) => new Client(signalUrl, u.token, t).open();

test('E01 auth: registration, validation, login, refresh and logout revoke access', options, async () => {
  const u = await user();
  await api('GET', '/users/me', null, null, 401);
  await api('POST', '/auth/register', null, {
    email: u.email, password, display_name: 'Duplicate', username: `u${randomUUID().replaceAll('-', '').slice(0, 20)}`,
  }, 409);
  await api('POST', '/auth/login', null, { email: u.email, password: 'Wrong123!' }, 401);
  const login = await api('POST', '/auth/login', null, { email: u.email, password });
  assert.equal((await api('GET', '/users/me', login.tokens.access_token)).id, u.id);
  const fresh = await api('POST', '/auth/refresh', null, { refresh_token: login.tokens.refresh_token });
  assert.equal((await api('GET', '/users/me', fresh.access_token)).id, u.id);
  await api('POST', '/auth/logout', fresh.access_token, { refresh_token: login.tokens.refresh_token }, 204);
  await api('GET', '/users/me', fresh.access_token, null, 401);
  await api('POST', '/auth/refresh', null, { refresh_token: login.tokens.refresh_token }, 401);
  assert.equal(sql(`SELECT count(*) FROM users WHERE id='${uuid(u.id)}' AND password_hash NOT LIKE 'E2eStrong%'`), '1');
});

test('E02 profile/settings: update survives a new HTTP read and is persisted', options, async () => {
  const u = await user();
  await api('PUT', '/users/me', u.token, { display_name: 'Người dùng kiểm thử' });
  assert.equal((await api('GET', '/users/me', u.token)).display_name, 'Người dùng kiểm thử');
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${uuid(u.id)}'`), 'Người dùng kiểm thử');
  await api('PUT', '/users/me/settings', u.token, { discoverable: false, theme: 'dark', email_notifications: false });
  const settings = await api('GET', '/users/me/settings', u.token);
  assert.equal(settings.discoverable, false); assert.equal(settings.theme, 'dark');
  await api('PUT', '/users/me/settings', u.token, { theme: 'invalid' }, 400);
});

test('E03 avatar: catalog, save, read own and public profile', options, async () => {
  const u = await user();
  const catalog = await api('GET', '/avatars/models', u.token);
  assert.ok(catalog.models.length > 0);
  const model = catalog.models[0];
  await api('PUT', '/avatars/me', u.token, { model_id: model.id, customizations: {} }, 201);
  assert.equal((await api('GET', '/avatars/me', u.token)).model_id, model.id);
  assert.equal((await api('GET', `/avatars/${u.id}`, u.token)).model_id, model.id);
});

test('E04 messaging: HTTP send reaches two real recipient sockets and PostgreSQL', options, async t => {
  const { a, b, conversation: id } = await pair();
  const first = await messaging(b, t), second = await messaging(b, t);
  const body = message('Xin chào 👋');
  const result = await api('POST', `/conversations/${id}/messages`, a.token, body, 201);
  assert.deepEqual((await first.take('NEW_MESSAGE')).data, result);
  assert.deepEqual((await second.take('NEW_MESSAGE')).data, result);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${uuid(body.id)}' AND sender_id='${uuid(a.id)}'`), '1');
});

test('E05 messaging: concurrent retries of one message ID create exactly one record', options, async () => {
  const { a, b, conversation: id } = await pair();
  const body = message('Retry-safe');
  const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}/conversations/${id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })));
  const statuses = responses.map(r => r.status).sort();
  await Promise.all(responses.map(r => r.arrayBuffer()));
  assert.deepEqual(statuses, [200, 200, 200, 201]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${uuid(body.id)}'`), '1');
  const history = await api('GET', `/conversations/${id}/messages`, b.token);
  assert.equal(history.data.filter(m => m.id === body.id).length, 1);
});

test('E06 messaging: read receipt, typing, and outsider authorization', options, async t => {
  const { a, b, conversation: id } = await pair(), outsider = await user();
  const receiver = await messaging(b, t), sender = await messaging(a, t);
  sender.send({ type: 'TYPING', data: { conversation_id: id } });
  assert.equal((await receiver.take('TYPING')).data.conversation_id, id);
  const body = message('Read me');
  await api('POST', `/conversations/${id}/messages`, a.token, body, 201);
  await receiver.take('NEW_MESSAGE');
  await api('PUT', `/conversations/${id}/messages/${body.id}`, b.token, { status: 'read' });
  assert.deepEqual((await sender.take('MESSAGE_STATUS_UPDATE')).data, { id: body.id, status: 'read' });
  assert.equal(sql(`SELECT status FROM messages WHERE id='${uuid(body.id)}'`), 'read');
  await api('GET', `/conversations/${id}/messages`, outsider.token, null, 403);
  await api('POST', `/conversations/${id}/messages`, outsider.token, message('Intrusion'), 403);
});

test('E07 messaging: offline messages recovered from history after reconnect', options, async t => {
  const { a, b, conversation: id } = await pair();
  const socket = await messaging(b, t); await socket.close();
  const body = message('While offline');
  await api('POST', `/conversations/${id}/messages`, a.token, body, 201);
  const reconnected = await messaging(b, t);
  const history = await api('GET', `/conversations/${id}/messages`, b.token);
  assert.equal(history.data.find(m => m.id === body.id)?.content, body.content);
  const next = message('After reconnect');
  await api('POST', `/conversations/${id}/messages`, a.token, next, 201);
  assert.equal((await reconnected.take('NEW_MESSAGE')).data.id, next.id);
});

test('E08 call: signaling -> backend -> Redis -> messaging; offer/answer/ICE/end', options, async t => {
  const a = await user(), b = await user();
  const callId = randomUUID();
  const inbox = await messaging(b, t), sa = await signaling(a, t), sb = await signaling(b, t);
  sa.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id, data: { sdp: 'protocol-test-offer' } });
  assert.equal((await inbox.take('CALL_INCOMING')).data.caller_id, a.id);
  assert.equal((await sb.take('CALL_OFFER')).from_user_id, a.id);
  sb.send({ type: 'CALL_ANSWER', call_id: callId, target_user_id: a.id, data: { sdp: 'protocol-test-answer' } });
  assert.equal((await sa.take('CALL_ANSWER')).from_user_id, b.id);
  sa.send({ type: 'ICE_CANDIDATE', call_id: callId, target_user_id: b.id, data: { candidate: 'protocol-test-candidate' } });
  assert.equal((await sb.take('ICE_CANDIDATE')).from_user_id, a.id);
  sb.send({ type: 'CALL_END', call_id: callId, target_user_id: a.id, data: {} });
  assert.equal((await sa.take('CALL_END')).from_user_id, b.id);
});

test('E09 call acceptance: callee connects signaling after CALL_INCOMING and receives offer', options, async t => {
  const a = await user(), b = await user();
  const callId = randomUUID();
  const inbox = await messaging(b, t), sa = await signaling(a, t);
  sa.send({ type: 'CALL_OFFER', call_id: callId, target_user_id: b.id, data: { sdp: 'protocol-test-offer' } });
  assert.equal((await inbox.take('CALL_INCOMING')).data.caller_id, a.id);
  const sb = await signaling(b, t);
  // Expected user journey: caller does not need to click Call a second time.
  const received = await sb.take('CALL_OFFER', () => true, 3000).catch(() => null);
  assert.ok(received, `Offer lost after callee joins; caller events=${JSON.stringify(sa.messages.map(m => ({ type: m.type, code: m.data?.code })))}`);
  assert.equal(received.from_user_id, a.id);
});

test('E10 auth acceptance: logged-out access token cannot reconnect to signaling', options, async t => {
  const u = await user();
  await api('POST', '/auth/logout', u.token, { refresh_token: u.refresh }, 204);
  await api('GET', '/users/me', u.token, null, 401);
  const socket = new Client(signalUrl, u.token, t);
  await socket.open();
  const end = Date.now() + 1500;
  while (!socket.closeCode && Date.now() < end) await delay(25);
  assert.equal(socket.closeCode, 4001, 'Signaling accepted a token already revoked by backend logout');
});

test('E11 video: real multipart -> real MinIO webhook -> ready -> byte-exact download -> delete', options, async () => {
  const u = await user(), outsider = await user();
  // Storage transport fixture, not a playable media file.
  const first = Buffer.alloc(5 * 1024 * 1024, 0x61), last = Buffer.from('E2E final part');
  const video = await api('POST', '/videos', u.token, {
    title: 'E2E multipart', estimated_size_bytes: first.length + last.length, chunk_size_bytes: first.length, format: 'webm',
  }, 201);
  assert.equal(redis('EXISTS', `video:upload:${video.id}`), '1');
  const upload = async (url, bytes) => {
    const r = await fetch(url, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(10000) });
    assert.equal(r.status, 200); await r.arrayBuffer();
    const etag = r.headers.get('etag'); assert.ok(etag); return etag;
  };
  const etag1 = await upload(video.first_chunk_url, first);
  const chunk = await api('POST', `/videos/${video.id}/chunks`, u.token,
    { upload_id: video.upload_id, part_number: 2, etag_previous: etag1 });
  const etag2 = await upload(chunk.chunk_url, last);
  await api('POST', `/videos/${video.id}/finalize`, u.token, {
    upload_id: video.upload_id, duration_secs: 2,
    parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }],
  }, 202);
  let detail;
  const end = Date.now() + 10000;
  do {
    detail = await api('GET', `/videos/${video.id}`, u.token);
    if (detail.status === 'ready') break;
    await delay(100);
  } while (Date.now() < end);
  assert.equal(detail.status, 'ready', 'Real MinIO webhook did not make video ready');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${uuid(video.id)}'`), 'ready');
  assert.equal(redis('EXISTS', `video:upload:${video.id}`), '0');
  const downloaded = await fetch(detail.view_url, { signal: AbortSignal.timeout(10000) });
  assert.equal(downloaded.status, 200);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(Buffer.from(await downloaded.arrayBuffer())), digest(Buffer.concat([first, last])));
  assert.equal(detail.file_size_bytes, first.length + last.length);
  // docs/04_API.md section 7.7 explicitly specifies 403 for another owner.
  await api('GET', `/videos/${video.id}`, outsider.token, null, 403);
  await api('DELETE', `/videos/${video.id}`, u.token, null, 204);
  await api('GET', `/videos/${video.id}`, u.token, null, 404);
  assert.equal((await api('GET', '/videos', u.token)).storage_used_bytes, 0);
});

test('E12 video: abort invalidates the real MinIO upload and clears Redis', options, async () => {
  const u = await user();
  const video = await api('POST', '/videos', u.token, {
    title: 'Abort', estimated_size_bytes: 1024, chunk_size_bytes: 5242880, format: 'webm',
  }, 201);
  await api('POST', `/videos/${video.id}/abort`, u.token, { upload_id: video.upload_id }, 204);
  assert.equal(redis('EXISTS', `video:upload:${video.id}`), '0');
  const response = await fetch(video.first_chunk_url, { method: 'PUT', body: 'late part', signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 404); await response.arrayBuffer();
});

test('E13 account deletion revokes HTTP access and prevents login', options, async () => {
  const u = await user();
  await api('DELETE', '/users/me', u.token, { password }, 204);
  await api('GET', '/users/me', u.token, null, 401);
  await api('POST', '/auth/login', null, { email: u.email, password }, 401);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${uuid(u.id)}'`), 't');
});

test('E14 telemetry accepts authenticated data and rejects invalid session type', options, async () => {
  const u = await user();
  const body = { session_type: 'preview', fps: 30, tracking_latency_ms: 12, timestamp: new Date().toISOString() };
  await api('POST', '/metrics/client', u.token, body, 204);
  await api('POST', '/metrics/client', u.token, { ...body, session_type: 'invalid' }, 400);
});
