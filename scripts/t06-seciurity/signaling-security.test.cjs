const h = require('../t04-api/support.cjs');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');
const { assert, caseTest: test, user, uuid, wait, Socket, signaling,
  messaging, ok, signalingUrl } = h;

const offer = (target, callId, sdp = `private-sdp-${uuid()}`) => ({
  type: 'CALL_OFFER', call_id: callId, target_user_id: target,
  data: { sdp },
});
const followup = (type, target, callId, data = {}) => ({
  type, call_id: callId, target_user_id: target, data,
});
async function quiet(socket, types, duration = 450) {
  await wait(duration);
  assert.equal(socket.events.some(event => types.includes(event.type)), false,
    `Unexpected ${types.join('/')} relay`);
}
async function closedWith(socket, code) {
  const deadline = Date.now() + 5000;
  while (!socket.closeCode && Date.now() < deadline) await wait(25);
  assert.equal(socket.closeCode, code);
}

test('SIG-008 pending offer is delivered only to its intended callee', async t => {
  const a = await user(), b = await user(), c = await user();
  const caller = await signaling(a, t), outsider = await signaling(c, t);
  const callId = uuid(), privateSdp = `sdp-${uuid()}`;
  caller.send(offer(b.id, callId, privateSdp));
  await quiet(outsider, ['CALL_OFFER', 'ICE_CANDIDATE']);
  const callee = await signaling(b, t);
  const received = await callee.take('CALL_OFFER');
  assert.equal(received.call_id, callId);
  assert.equal(received.data.sdp, privateSdp);
  assert.equal(received.from_user_id, a.id);
  assert.equal(outsider.events.some(event => JSON.stringify(event).includes(privateSdp)), false);
});

test('SIG-009 ICE for outsider target is not relayed outside active call', async t => {
  const a = await user(), b = await user(), c = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t), sc = await signaling(c, t);
  const callId = uuid();
  sa.send(offer(b.id, callId));
  await sb.take('CALL_OFFER');
  sb.send(followup('CALL_ANSWER', a.id, callId, { sdp: 'answer' }));
  await sa.take('CALL_ANSWER');
  const candidate = `candidate-${uuid()}`;
  sa.send(followup('ICE_CANDIDATE', c.id, callId, { candidate }));
  assert.equal((await sa.take('ERROR')).data.code, 'INVALID_CALL_SESSION');
  await quiet(sc, ['ICE_CANDIDATE']);
  assert.equal(sc.events.some(event => JSON.stringify(event).includes(candidate)), false);
});

test('SIG-010 second offer while pending does not start another call', async t => {
  const a = await user(), b = await user(), c = await user();
  const sa = await signaling(a, t), sc = await signaling(c, t);
  const firstId = uuid(), secondId = uuid();
  sa.send(offer(b.id, firstId));
  sa.send(offer(c.id, secondId));
  const error = await sa.take('ERROR');
  assert.equal(error.data.code, 'TARGET_BUSY');
  await quiet(sc, ['CALL_OFFER']);
  const sb = await signaling(b, t);
  assert.equal((await sb.take('CALL_OFFER')).call_id, firstId);
});

test('SIG-011 answer before offer cannot create a call session', async t => {
  const a = await user(), b = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t);
  sb.send(followup('CALL_ANSWER', a.id, uuid(), { sdp: 'forged-answer' }));
  assert.equal((await sb.take('ERROR')).data.code, 'INVALID_CALL_SESSION');
  await quiet(sa, ['CALL_ANSWER']);
});

test('SIG-012 ICE and answer after call end cannot revive the old session', async t => {
  const a = await user(), b = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t), callId = uuid();
  sa.send(offer(b.id, callId));
  await sb.take('CALL_OFFER');
  sb.send(followup('CALL_ANSWER', a.id, callId, { sdp: 'answer' }));
  await sa.take('CALL_ANSWER');
  sa.send(followup('CALL_END', b.id, callId));
  await sb.take('CALL_END');
  for (const type of ['ICE_CANDIDATE', 'CALL_ANSWER']) {
    sa.send(followup(type, b.id, callId, { candidate: 'late' }));
    assert.equal((await sa.take('ERROR')).data.code, 'INVALID_CALL_SESSION');
  }
  await quiet(sb, ['ICE_CANDIDATE', 'CALL_ANSWER']);
});

test('SIG-013 outsider with known call ID cannot end or hijack session', async t => {
  const a = await user(), b = await user(), c = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t), sc = await signaling(c, t);
  const callId = uuid();
  sa.send(offer(b.id, callId));
  await sb.take('CALL_OFFER');
  sc.send(followup('CALL_END', b.id, callId));
  assert.equal((await sc.take('ERROR')).data.code, 'INVALID_CALL_SESSION');
  await quiet(sb, ['CALL_END']);
  sb.send(followup('CALL_ANSWER', a.id, callId, { sdp: 'valid-answer' }));
  assert.equal((await sa.take('CALL_ANSWER')).from_user_id, b.id);
});

test('SIG-014 deleted account loses open and new signaling access', async t => {
  const a = await user(), b = await user(), sa = await signaling(a, t), sb = await signaling(b, t);
  await ok('DELETE', '/users/me', a.token, { password: a.password }, 204);
  await closedWith(sa, 4001);
  const reconnect = new Socket(signalingUrl, a.token, t);
  await reconnect.open();
  await closedWith(reconnect, 4001);
  await quiet(sb, ['CALL_OFFER', 'ICE_CANDIDATE']);
});

test('SIG-015 signaling caps connection attempts per IP without blocking another IP', async t => {
  const a = await user(), b = await user();
  const urlA = `${signalingUrl}?token=${encodeURIComponent(a.token)}`;
  const make = (url, ip) => new WebSocket(url, { headers: { 'X-Forwarded-For': ip } });
  for (let i = 0; i < 20; i++) {
    const socket = make(urlA, '198.51.100.240');
    await new Promise((done, fail) => {
      socket.once('open', done);
      socket.once('error', fail);
    });
    socket.close();
  }
  const limited = make(urlA, '198.51.100.240');
  t.after(() => limited.close());
  const code = await new Promise((done, fail) => {
    limited.once('close', done);
    limited.once('error', fail);
  });
  assert.equal(code, 4029);
  const other = make(`${signalingUrl}?token=${encodeURIComponent(b.token)}`, '198.51.100.241');
  t.after(() => other.close());
  await new Promise((done, fail) => {
    other.once('open', done);
    other.once('error', fail);
  });
  await wait(300);
  assert.equal(other.readyState, WebSocket.OPEN);
});

test('SIG-016 token signed with another key is rejected by signaling', async t => {
  const a = await user(), parts = a.token.split('.');
  const input = `${parts[0]}.${parts[1]}`;
  const forged = `${input}.${createHmac('sha256', 'different-e2e-signing-key')
    .update(input).digest('base64url')}`;
  const socket = new Socket(signalingUrl, forged, t);
  await socket.open();
  await closedWith(socket, 4001);
});

test('SIG-017 signaling log does not contain JWT from failed or successful sockets', async t => {
  const a = await user(), socket = await signaling(a, t);
  socket.send({ type: 'INVALID_T06' });
  await wait(100);
  const log = readFileSync(resolve(process.env.E2E_RESULT_DIR, 'signaling.log'), 'utf8');
  assert.equal(log.includes(a.token), false);
  assert.equal(log.includes(process.env.E2E_JWT_SECRET), false);
  assert.doesNotMatch(log, /[?&]token=eyJ/);
});

test('SIG-018 expired pending offer is not replayed to a late callee', async t => {
  const a = await user(), b = await user(), caller = await signaling(a, t);
  const inbox = await messaging(b, t), callId = uuid();
  caller.send(offer(b.id, callId, `expired-sdp-${uuid()}`));
  assert.equal((await inbox.take('CALL_INCOMING')).data.call_id, callId);
  const deadline = Date.now() + 39000;
  while (Date.now() < deadline) await wait(250);
  const callee = await signaling(b, t);
  await quiet(callee, ['CALL_OFFER'], 750);
  assert.equal(callee.events.some(event => event.call_id === callId), false);
});

test('SIG-019 simultaneous calls do not exchange SDP or ICE across pairs', async t => {
  const a = await user(), b = await user(), c = await user(), d = await user();
  const sa = await signaling(a, t), sb = await signaling(b, t);
  const sc = await signaling(c, t), sd = await signaling(d, t);
  const abId = uuid(), cdId = uuid();
  sa.send(offer(b.id, abId, 'sdp-ab-secret'));
  sc.send(offer(d.id, cdId, 'sdp-cd-secret'));
  assert.equal((await sb.take('CALL_OFFER')).data.sdp, 'sdp-ab-secret');
  assert.equal((await sd.take('CALL_OFFER')).data.sdp, 'sdp-cd-secret');
  sb.send(followup('CALL_ANSWER', a.id, abId, { sdp: 'answer-ab' }));
  sd.send(followup('CALL_ANSWER', c.id, cdId, { sdp: 'answer-cd' }));
  assert.equal((await sa.take('CALL_ANSWER')).data.sdp, 'answer-ab');
  assert.equal((await sc.take('CALL_ANSWER')).data.sdp, 'answer-cd');
  sa.send(followup('ICE_CANDIDATE', b.id, abId, { candidate: 'ice-ab' }));
  sc.send(followup('ICE_CANDIDATE', d.id, cdId, { candidate: 'ice-cd' }));
  assert.equal((await sb.take('ICE_CANDIDATE')).data.candidate, 'ice-ab');
  assert.equal((await sd.take('ICE_CANDIDATE')).data.candidate, 'ice-cd');
  assert.equal(sb.events.some(event => JSON.stringify(event).includes('cd-secret')), false);
  assert.equal(sd.events.some(event => JSON.stringify(event).includes('ab-secret')), false);
});

test('SIG-020 call notify reveals metadata only to callee, never SDP to outsider', async t => {
  const a = await user(), b = await user(), c = await user();
  const inboxB = await messaging(b, t), inboxC = await messaging(c, t);
  const caller = await signaling(a, t), privateSdp = `notify-sdp-${uuid()}`, callId = uuid();
  caller.send(offer(b.id, callId, privateSdp));
  const incoming = await inboxB.take('CALL_INCOMING');
  assert.equal(incoming.data.caller_id, a.id);
  assert.equal(incoming.data.call_id, callId);
  assert.equal(JSON.stringify(incoming).includes(privateSdp), false);
  await quiet(inboxC, ['CALL_INCOMING']);
  assert.equal(inboxC.events.some(event => JSON.stringify(event).includes(privateSdp)), false);
});
