const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, user, uuid, ok, wait, messaging, signaling } = h;

const offer = (target, callId) => ({ type: 'CALL_OFFER', call_id: callId, target_user_id: target, data: { sdp: 'T05 offer' } });
const action = (type, target, callId, data = {}) => ({ type, call_id: callId, target_user_id: target, data });
async function closed(socket, code, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!socket.closeCode && Date.now() < deadline) await wait(20);
  assert.equal(socket.closeCode, code, `Expected signaling close ${code}`);
}

test('T05-CALL-001', async t => {
  const a = await user(), b = await user(), callId = uuid();
  const incoming = await messaging(b, t), sa = await signaling(a, t), sb = await signaling(b, t);
  sa.send(offer(b.id, callId));
  const notice = await incoming.take('CALL_INCOMING');
  const relayed = await sb.take('CALL_OFFER');
  assert.equal(notice.data.call_id, callId);
  assert.equal(notice.data.caller_id, a.id);
  assert.equal(relayed.call_id, callId);
  assert.equal(relayed.from_user_id, a.id);
  sb.send(action('CALL_ANSWER', a.id, callId, { sdp: 'T05 answer' }));
  assert.equal((await sa.take('CALL_ANSWER')).call_id, callId);
  sa.send(action('ICE_CANDIDATE', b.id, callId, { candidate: 'T05 candidate' }));
  assert.equal((await sb.take('ICE_CANDIDATE')).call_id, callId);
  sb.send(action('CALL_END', a.id, callId));
  assert.equal((await sa.take('CALL_END')).call_id, callId);
  assert.equal(sa.events.some(x => x.type === 'ERROR'), false);
});

test('T05-CALL-002', async t => {
  const a = await user(), b = await user(), callId = uuid();
  const incoming = await messaging(b, t), sa = await signaling(a, t);
  sa.send(offer(b.id, callId));
  assert.equal((await incoming.take('CALL_INCOMING')).data.call_id, callId);
  const sb = await signaling(b, t);
  assert.equal((await sb.take('CALL_OFFER')).call_id, callId);
  sb.send(action('CALL_ANSWER', a.id, callId, { sdp: 'T05 answer' }));
  assert.equal((await sa.take('CALL_ANSWER')).call_id, callId);
  assert.equal(sa.events.some(x => x.data?.code === 'TARGET_OFFLINE'), false);
});

test('T05-CALL-003', async t => {
  const a = await user(), b = await user(), first = uuid(), second = uuid();
  const sa = await signaling(a, t), sb = await signaling(b, t);
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  sb.send(action('CALL_REJECT', a.id, first, { reason: 'declined' }));
  assert.equal((await sa.take('CALL_REJECT')).call_id, first);
  sa.send(offer(b.id, second));
  assert.equal((await sb.take('CALL_OFFER')).call_id, second);
});

test('T05-CALL-009', async t => {
  const a = await user(), b = await user(), c = await user();
  const incoming = await messaging(b, t), sa = await signaling(a, t), sb = await signaling(b, t), sc = await signaling(c, t);
  const first = uuid(), blocked = uuid(), later = uuid();
  sa.send(offer(b.id, first));
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  assert.equal((await incoming.take('CALL_INCOMING')).data.call_id, first);
  sc.send(offer(b.id, blocked));
  assert.equal((await sc.take('ERROR')).data.code, 'TARGET_BUSY');
  await wait(300);
  assert.equal(incoming.events.some(e => e.type === 'CALL_INCOMING' && e.data.call_id === blocked), false);
  assert.equal(sb.events.some(e => e.call_id === blocked), false);
  sb.send(action('CALL_ANSWER', a.id, first, { sdp: 'accepted' }));
  assert.equal((await sa.take('CALL_ANSWER')).call_id, first);
  sc.send(offer(a.id, uuid()));
  assert.equal((await sc.take('ERROR')).data.code, 'TARGET_BUSY');
  sa.send(action('CALL_END', b.id, first));
  assert.equal((await sb.take('CALL_END')).call_id, first);
  sc.send(offer(b.id, later));
  assert.equal((await sb.take('CALL_OFFER')).call_id, later);
});

test('T05-CALL-011', async t => {
  const a = await user();
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  await ok('GET', '/users/me', a.token, undefined, 401);
  const socket = await new h.Socket(h.signalingUrl, a.token, t).open();
  await closed(socket, 4001);
});

test('T05-CALL-012', async t => {
  const a = await user(), b = await user(), callId = uuid();
  const sa = await signaling(a, t), sb = await signaling(b, t);
  await ok('POST', '/auth/logout', a.token, { refresh_token: a.refresh }, 204);
  if (sa.ws.readyState === 1) sa.send(offer(b.id, callId));
  await closed(sa, 4001);
  assert.equal(sb.events.some(e => e.type === 'CALL_OFFER' && e.call_id === callId), false);
  const idle = await user(), idleSocket = await signaling(idle, t);
  await ok('POST', '/auth/logout', idle.token, { refresh_token: idle.refresh }, 204);
  await closed(idleSocket, 4001);
});

test('T05-CALL-013', async t => {
  const a = await user(), b = await user();
  const incoming = await messaging(b, t), sa = await signaling(a, t), sb = await signaling(b, t);
  const first = uuid(), second = uuid();
  sa.send(offer(b.id, first));
  const notice1 = await incoming.take('CALL_INCOMING');
  assert.equal((await sb.take('CALL_OFFER')).call_id, first);
  assert.equal(notice1.data.call_id, first);
  assert.equal(notice1.data.caller_id, a.id);
  assert.ok(notice1.data.caller_display_name);
  assert.match(notice1.data.call_session_id, /^[0-9a-f-]{36}$/i);
  sb.send(action('CALL_REJECT', a.id, first));
  await sa.take('CALL_REJECT');
  sa.send(offer(b.id, second));
  const notice2 = await incoming.take('CALL_INCOMING');
  assert.equal((await sb.take('CALL_OFFER')).call_id, second);
  assert.equal(notice2.data.call_id, second);
  assert.notEqual(second, first);
  assert.equal(notice2.data.call_session_id, notice1.data.call_session_id);
});
