'use strict';
const h = require('./support.cjs');
const { assert, caseTest: test, request, ok, user, pair, message, validMessage,
  parallel, uuid, sql, messaging, dbMessage, sameElements, noMoreEvents } = h;
const path = id => `/conversations/${id}/messages`;
const statusPath = (id, mid) => `${path(id)}/${mid}`;

// Client gate tests require future test-only transaction barriers for proven internal races.
test('T07-MSG-001', async t => {
  const p = await pair(), receiver = await messaging(p.b,t), body = validMessage('T07 same UUID');
  const {responses} = await parallel(() => request('POST',path(p.id),p.a.token,body),4);
  assert.deepEqual(responses.map(r => r.status).sort(), [200,200,200,201]);
  assert.ok(responses.every(r => r.data?.id === body.id));
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
  assert.equal((await receiver.take('NEW_MESSAGE')).data.id, body.id);
  await noMoreEvents(receiver,'NEW_MESSAGE',body.id);
  assert.deepEqual(dbMessage(body.id).slice(0,2),[p.id,p.a.id]);
});

test('T07-MSG-002', async t => {
  const p = await pair(), receiver = await messaging(p.b,t);
  const bodies = Array.from({length:10},(_,i)=>validMessage(`T07 distinct ${i}`));
  const {responses} = await parallel(i => request('POST',path(p.id),p.a.token,bodies[i]),10);
  assert.ok(responses.every(r => r.status === 201),JSON.stringify(responses.map(x=>x.status)));
  sameElements(responses.map(r=>r.data.id),bodies.map(b=>b.id),'10 persisted response UUIDs');
  const received = [];
  for(let i=0;i<10;i++) received.push((await receiver.take('NEW_MESSAGE')).data.id);
  sameElements(received,bodies.map(b=>b.id),'10 WS UUIDs');
  assert.equal(Number(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}' AND id IN (${bodies.map(b=>`'${b.id}'`).join(',')})`)),10);
});

test('T07-MSG-003', async () => {
  const p = await pair(), body = validMessage('T07 owner-bound id');
  const {responses} = await parallel(i=>request('POST',path(p.id),i?p.b.token:p.a.token,body),2);
  assert.deepEqual(responses.map(r=>r.status).sort(), [201,409]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
  const [, sender] = dbMessage(body.id);
  assert.equal(sender, responses[0].status === 201 ? p.a.id : p.b.id);
});

test('T07-MSG-004', async () => {
  const a=await user(), b=await user(), c=await user();
  const ab=await ok('POST','/conversations',a.token,{other_user_id:b.id},201);
  const ac=await ok('POST','/conversations',a.token,{other_user_id:c.id},201);
  const body=validMessage('T07 conversation scoped id');
  const {responses}=await parallel(i=>request('POST',path(i?ac.id:ab.id),a.token,body),2);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
  assert.ok([ab.id,ac.id].includes(dbMessage(body.id)[0]));
});

test('T07-MSG-007', async () => {
  const p=await pair(), timestamp=new Date().toISOString();
  const bodies=Array.from({length:10},(_,i)=>({id:uuid(),content:`same clock ${i}`,client_timestamp:timestamp}));
  const {responses}=await parallel(i=>request('POST',path(p.id),p.a.token,bodies[i]),10);
  assert.ok(responses.every(r=>r.status===201),`received=${responses.map(r=>r.status)}`);
  assert.equal(Number(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}' AND client_timestamp='${timestamp}'`)),10);
});

test('T07-MSG-009', async () => {
  const p=await pair(), sent=await message(p.a,p.id,'read delivered race');
  const {responses}=await parallel(i=>request('PUT',statusPath(p.id,sent.body.id),p.b.token,
    { status: i?'delivered':'read'}),2);
  assert.equal(responses[0].status,200,'read must always be accepted');
  assert.ok(responses[1].status===200||responses[1].status===400,
    `delivered can precede read or be rejected as downgrade; got ${responses[1].status}`);
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`),'read');
});

test('T07-MSG-010', async t => {
  const p=await pair(), socketA=await messaging(p.a,t),socketB=await messaging(p.b,t);
  const sent=await message(p.a,p.id,'parallel read');
  await ok('PUT',statusPath(p.id,sent.body.id),p.b.token,{status:'delivered'});
  await socketA.take('MESSAGE_STATUS_UPDATE'); await socketB.take('MESSAGE_STATUS_UPDATE');
  const {responses}=await parallel(()=>request('PUT',statusPath(p.id,sent.body.id),p.b.token,{status:'read'}),5);
  assert.ok(responses.every(r=>r.status===200 && r.data?.status==='read'));
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`),'read');
  for(const socket of [socketA,socketB]) {
    assert.equal((await socket.take('MESSAGE_STATUS_UPDATE')).data.id,sent.body.id);
    await noMoreEvents(socket,'MESSAGE_STATUS_UPDATE',sent.body.id);
  }
});

test('T07-MSG-011', async () => {
  const p=await pair(), sent=await message(p.a,p.id,'privilege race');
  const {responses}=await parallel(i=>request('PUT',statusPath(p.id,sent.body.id),i?p.b.token:p.a.token,{status:'read'}),2);
  assert.deepEqual(responses.map(r=>r.status),[403,200]);
  assert.equal(dbMessage(sent.body.id)[2],'read');
});

test('T07-MSG-013', async () => {
  const p = await pair();
  const originals = [];
  for (let index = 0; index < 12; index++) {
    const body = validMessage(`stable history ${index}`);
    originals.push(body);
    await ok('POST', path(p.id), p.a.token, body, 201);
  }
  const first = await ok('GET', `${path(p.id)}?limit=5`, p.a.token);
  assert.equal(first.data.length, 5);
  assert.equal(first.has_more, true);
  assert.ok(first.prev_cursor);

  const newcomer = validMessage('arrived after first page');
  await ok('POST', path(p.id), p.b.token, newcomer, 201);

  const found = first.data.map(item => item.id);
  let cursor = first.prev_cursor;
  while (cursor) {
    const page = await ok('GET', `${path(p.id)}?limit=5&cursor=${encodeURIComponent(cursor)}`, p.a.token);
    found.push(...page.data.map(item => item.id));
    cursor = page.has_more ? page.prev_cursor : null;
  }
  assert.equal(new Set(found).size, found.length, 'A moving history cursor duplicated a message');
  sameElements(found, originals.map(body => body.id), 'Cursor must retain the original snapshot tail');
  assert.ok(!found.includes(newcomer.id), 'A newer message was injected behind an older cursor');
  const newest = await ok('GET', `${path(p.id)}?limit=5`, p.a.token);
  assert.ok(newest.data.some(item => item.id === newcomer.id), 'New message missing from a fresh first page');
});

test('T07-MSG-014', async () => {
  const p=await pair(), timestamp=new Date().toISOString();
  const bodies=Array.from({length:12},(_,i)=>({id:uuid(),content:`cursor-tie-${i}`,client_timestamp:timestamp}));
  for(const body of bodies) await ok('POST',path(p.id),p.a.token,body,201);
  let cursor=null, found=[];
  for(let i=0;i<6;i++) {
    const result=await ok('GET',path(p.id)+`?limit=5${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,p.a.token);
    found.push(...result.data.map(m=>m.id));
    if(!result.has_more) break;
    assert.ok(result.prev_cursor, 'Missing pagination cursor');
    cursor=result.prev_cursor;
  }
  assert.equal(new Set(found).size, found.length,'Cursor duplicated a message');
  sameElements(found,bodies.map(b=>b.id),'Cursor lost messages with tied timestamps');
});

test('T07-MSG-015', async () => {
  const a=await user(), b=await user(), c=await user();
  const ab=await ok('POST','/conversations',a.token,{other_user_id:b.id},201);
  const ac=await ok('POST','/conversations',a.token,{other_user_id:c.id},201);
  const bodies=[validMessage('concurrency A/B'),validMessage('concurrency A/C')];
  const {responses}=await parallel(i=>request('POST',path(i?ac.id:ab.id),a.token,bodies[i]),2);
  assert.deepEqual(responses.map(r=>r.status),[201,201]);
  assert.deepEqual(bodies.map(b=>dbMessage(b.id)[0]),[ab.id,ac.id]);
});

test('T07-TX-006', async () => {
  const p = await pair();
  const before = Date.parse(sql(`SELECT updated_at FROM conversations WHERE id='${p.id}'`));
  const body = validMessage('message and conversation touch are one transaction');
  const response = await request('POST', path(p.id), p.a.token, body);
  assert.equal(response.status, 201);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`), '1');
  const conversationUpdatedAt = Date.parse(sql(`SELECT updated_at FROM conversations WHERE id='${p.id}'`));
  assert.ok(conversationUpdatedAt >= before, 'Committed message did not touch its conversation');
});
