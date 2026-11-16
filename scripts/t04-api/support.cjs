const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');

const base = process.env.E2E_BACKEND_URL;
const signalingUrl = process.env.E2E_SIGNALING_URL;
const password = 'T04Strong123!';
const timeout = { timeout: 60000 };
const wait = ms => new Promise(done => setTimeout(done, ms));
const uuid = () => randomUUID();
const iso = () => new Date().toISOString();
const validVideo = (extra = {}) => ({ title: 'T04 video', estimated_size_bytes: 5242900, chunk_size_bytes: 5242880, format: 'webm', ...extra });
const validMessage = (content = 'T04 message') => ({ id: uuid(), content, client_timestamp: iso() });

async function request(method, path, token, body, options = {}) {
  assert.ok(base, 'E2E_BACKEND_URL missing: use scripts/t04-api/run.cjs');
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  if (body !== undefined && !options.raw && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout ?? 15000),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { status: response.status, data, raw, headers: response.headers };
}
function expect(response, status, code) {
  assert.equal(response.status, status, `HTTP expected ${status}, got ${response.status}, error=${response.data?.error?.code ?? 'none'}`);
  if (code) assert.equal(response.data?.error?.code, code);
  if (status === 204) assert.equal(response.raw, '');
  return response.data;
}
async function ok(method, path, token, body, status = 200, code) {
  return expect(await request(method, path, token, body), status, code);
}
function isUuid(value) { assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); }
function isTime(value) { assert.ok(Number.isFinite(Date.parse(value)), `Invalid ISO time: ${value}`); }
function noLeak(response) { assert.doesNotMatch(response.raw, /password_hash|stacktrace|stack_trace|jwt_secret|internal_call_notify_secret/i); }
function unchanged(before, after, keys) { for (const key of keys) assert.deepEqual(after[key], before[key], key); }
async function user(extra = {}) {
  const email = `t04-${uuid()}@example.com`;
  const username = `u${uuid().replaceAll('-', '').slice(0, 20)}`;
  const body = { email, password, display_name: 'T04 User', username, ...extra };
  const response = await ok('POST', '/auth/register', null, body, 201);
  isUuid(response.user.id);
  return { id: response.user.id, email: body.email, username: body.username, password: body.password, token: response.tokens.access_token, refresh: response.tokens.refresh_token };
}
async function pair() {
  const a = await user(), b = await user();
  const conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  return { a, b, id: conversation.id };
}
async function avatarModel(token) {
  const data = await ok('GET', '/avatars/models', token);
  assert.ok(data.models.length > 0);
  return data.models[0];
}
async function video(owner, extra) {
  const data = await ok('POST', '/videos', owner.token, validVideo(extra), 201);
  isUuid(data.id);
  return data;
}
async function abortVideo(owner, item) {
  return request('POST', `/videos/${item.id}/abort`, owner.token, { upload_id: item.upload_id });
}
async function message(sender, id, content) {
  const body = validMessage(content);
  const data = await ok('POST', `/conversations/${id}/messages`, sender.token, body, 201);
  return { body, data };
}
async function uploadPart(url, bytes) {
  const response = await fetch(url, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  await response.arrayBuffer();
  return etag;
}
async function preparedVideo(owner) {
  const item = await video(owner);
  // A small decodable VP8/WebM stream followed by padding to meet S3's 5 MiB
  // minimum for nonfinal parts. ffprobe verifies the complete object.
  const media = readFileSync(resolve(__dirname, 'fixtures/valid.webm'));
  const first = Buffer.alloc(5 * 1024 * 1024);
  media.copy(first);
  const last = Buffer.alloc(14);
  const etag1 = await uploadPart(item.first_chunk_url, first);
  const next = await ok('POST', `/videos/${item.id}/chunks`, owner.token,
    { upload_id: item.upload_id, part_number: 2, etag_previous: etag1 });
  const etag2 = await uploadPart(next.chunk_url, last);
  const finalize = { upload_id: item.upload_id, duration_secs: 2,
    parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }] };
  return { item, first, last, etag1, etag2, next, finalize };
}
async function readyVideo(owner) {
  const prepared = await preparedVideo(owner);
  await ok('POST', `/videos/${prepared.item.id}/finalize`, owner.token, prepared.finalize, 202);
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const detail = await ok('GET', `/videos/${prepared.item.id}`, owner.token);
    if (detail.status === 'ready') return { ...prepared, detail };
    await wait(150);
  }
  throw new Error('Video did not become ready after MinIO webhook');
}
function sql(query) {
  const container = process.env.E2E_PG_CONTAINER;
  assert.match(container ?? '', /^veiltalk-e2e-/);
  return execFileSync('docker', ['exec', container, 'psql', '-U', 'e2e', '-d', 'veiltalk_e2e', '-At', '-c', query],
    { encoding: 'utf8', timeout: 10000 }).trim();
}
function redis(...args) {
  const container = process.env.E2E_REDIS_CONTAINER;
  assert.match(container ?? '', /^veiltalk-e2e-/);
  return execFileSync('docker', ['exec', container, 'redis-cli', '--raw', ...args],
    { encoding: 'utf8', timeout: 10000 }).trim();
}
class Socket {
  constructor(url, token, t) {
    this.events = [];
    const testIp = `10.${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*200)+1}`;
    this.ws = new WebSocket(`${url}?token=${encodeURIComponent(token ?? '')}`, { headers: { 'X-Forwarded-For': testIp } });
    this.ws.on('error', () => {});
    this.ws.on('close', code => { this.closeCode = code; });
    this.ws.on('message', raw => {
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      if (event.type === 'PING') { this.seenPing = true; this.pingCount = (this.pingCount ?? 0) + 1; this.send({ type: 'PONG' }); }
      else this.events.push(event);
    });
    t.after(() => this.close());
  }
  async open() {
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('WebSocket open timeout')), 5000);
      this.ws.once('open', () => { clearTimeout(timer); done(); });
      this.ws.once('error', error => { clearTimeout(timer); fail(error); });
    });
    return this;
  }
  send(event) { this.ws.send(JSON.stringify(event)); }
  async take(type, timeoutMs = 4000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const i = this.events.findIndex(event => event.type === type);
      if (i >= 0) return this.events.splice(i, 1)[0];
      await wait(20);
    }
    throw new Error(`Missing WS ${type}; received ${this.events.map(x => x.type).join(',')}; close=${this.closeCode ?? 'open'}`);
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    else this.ws.close();
  }
}
const messaging = async (owner, t) => {
  const socket = await new Socket(base.replace(/^http/, 'ws') + '/ws/messaging', owner.token, t).open();
  const deadline = Date.now() + 5000;
  while (!socket.seenPing && Date.now() < deadline) await wait(20);
  assert.equal(socket.seenPing, true, 'Messaging WebSocket did not become ready');
  return socket;
};
const signaling = (owner, t) => new Socket(signalingUrl, owner.token, t).open();

function caseTest(id, fn) { test(id, timeout, fn); }
module.exports = { assert, caseTest, request, expect, ok, uuid, iso, isUuid, isTime, noLeak, unchanged,
  user, pair, password, avatarModel, video, validVideo, abortVideo, validMessage, message,
  preparedVideo, readyVideo, uploadPart, sql, redis, wait, Socket, messaging, signaling, base, signalingUrl };
