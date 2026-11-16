'use strict';
const h = require('./support.cjs');
const { assert, caseTest: test, user, pair, message, validMessage, request, ok,
  messaging, signaling, Socket, NoPongSocket, signalingUrl, uuid, wait, noMoreEvents, sql, parallel,
  sameElements } = h;
const offer=(target,callId)=>({type:'CALL_OFFER',target_user_id:target,call_id:callId,data:{sdp:'T07 offer'}});
const act=(type,target,callId,data={})=>({type,target_user_id:target,call_id:callId,data});
async function deniedSignaling(owner,t) {
  const socket=new Socket(signalingUrl,owner.token,t);
  try {
    await socket.open();
  } catch (error) {
    assert.match(String(error.message), /Unexpected server response: (401|403)\b/,
      `Handshake should be auth-rejected, not a network failure: ${error.message}`);
    return;
  }
  await closedWith(socket,4001);
}
async function closedWith(socket,code,timeout=6000) {
  const end=Date.now()+timeout;
  while(socket.closeCode===undefined && Date.now()<end) await wait(25);
  assert.equal(socket.closeCode,code,`Expected WS close code ${code}, got ${socket.closeCode??'OPEN'}`);
}
async function waitUntil(label,predicate,timeout=6000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
    if(predicate()) return;
    await wait(20);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

// T07-PUB-003: retry is intentionally sequential; tests duplicate event, not Pub/Sub outage.
test('T07-PUB-003',async t=>{
  const p=await pair(), inbox=await messaging(p.b,t), body=validMessage('T07 no publish on retry');
  const a=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  assert.equal(a.status,201);
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id,body.id);
  const b=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  assert.equal(b.status,200);
  assert.deepEqual(b.data,a.data);
  await noMoreEvents(inbox,'NEW_MESSAGE',body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
});

test('T07-PUB-005',async t=>{
  const p=await pair(), inbox=await messaging(p.b,t);
  const content='Xin chào 👋 — tiếng Việt: ă â ê ô ơ ư đ — 日本語';
  const body=validMessage(content);
  const saved=await ok('POST',`/conversations/${p.id}/messages`,p.a.token,body,201);
  const event=await inbox.take('NEW_MESSAGE');
  assert.deepEqual(event.data,saved);
  assert.equal(event.data.id,body.id);
  assert.equal(event.data.content,content);
  assert.equal(event.data.conversation_id,p.id);
  assert.equal(event.data.sender_id,p.a.id);
});

test('T07-PUB-006',async t=>{
  const p=await pair(), first=await messaging(p.b,t), second=await messaging(p.b,t);
  const sent=await message(p.a,p.id,'T07 multi socket');
  assert.equal((await first.take('NEW_MESSAGE')).data.id,sent.body.id);
  assert.equal((await second.take('NEW_MESSAGE')).data.id,sent.body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`),'1');
});

test('T07-PUB-009',async t=>{
  const first=await pair(), second=await pair();
  const inboxB=await messaging(first.b,t), inboxD=await messaging(second.b,t);
  const firstBodies=Array.from({length:10},(_,index)=>validMessage(`fanout AB ${index}`));
  const secondBodies=Array.from({length:10},(_,index)=>validMessage(`fanout CD ${index}`));
  const jobs=[
    ...firstBodies.map(body=>()=>request('POST',`/conversations/${first.id}/messages`,first.a.token,body)),
    ...secondBodies.map(body=>()=>request('POST',`/conversations/${second.id}/messages`,second.a.token,body)),
  ];
  const {responses}=await parallel(index=>jobs[index](),jobs.length);
  assert.ok(responses.every(response=>response.status===201));
  const receivedB=[],receivedD=[];
  for(let index=0;index<10;index++) receivedB.push((await inboxB.take('NEW_MESSAGE')).data.id);
  for(let index=0;index<10;index++) receivedD.push((await inboxD.take('NEW_MESSAGE')).data.id);
  sameElements(receivedB,firstBodies.map(body=>body.id),'A/B channel IDs');
  sameElements(receivedD,secondBodies.map(body=>body.id),'C/D channel IDs');
  assert.ok(receivedB.every(id=>!receivedD.includes(id)),'Redis user channels crossed recipients');
});

test('T07-PUB-010',async t=>{
  const p=await pair(), inbox=await messaging(p.b,t);
  h.redis('PUBLISH',`messaging:user:${p.b.id}`,'{not-json');
  await wait(200);
  assert.equal(inbox.ws.readyState,1,'Invalid Pub/Sub payload closed a healthy WebSocket');
  const sent=await message(p.a,p.id,'valid event after malformed Redis payload');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id,sent.body.id);
});

test('T07-WS-001',async t=>{
  const p=await pair(), first=await messaging(p.b,t), second=await messaging(p.b,t);
  first.ws.terminate();
  const end=Date.now()+3000;
  while(first.closeCode===undefined&&Date.now()<end)await wait(20);
  assert.notEqual(first.closeCode,undefined,'First socket was not observed closed');
  const sent=await message(p.a,p.id,'second socket must still receive');
  assert.equal((await second.take('NEW_MESSAGE')).data.id,sent.body.id);
  assert.equal(second.ws.readyState,1);
});

test('T07-WS-002',async t=>{
  const p=await pair(), killed=await messaging(p.b,t), survivor=await messaging(p.b,t);
  killed.ws.terminate();
  const sent=await message(p.a,p.id,'WS abrupt disconnect');
  assert.equal((await survivor.take('NEW_MESSAGE')).data.id,sent.body.id);
  assert.equal(survivor.ws.readyState,1);
  // A registry-leak proof needs a registry gauge/hook, hence PARTIAL, not PASS.
});

test('T07-WS-003',async t=>{
  const p=await pair(), socket=await messaging(p.b,t);
  await ok('POST','/auth/logout',p.b.token,{refresh_token:p.b.refresh},204);
  await closedWith(socket,4002,6000);
  const sent=await message(p.a,p.id,'must persist after peer logout');
  await wait(300);
  assert.equal(socket.events.filter(event=>event.type==='NEW_MESSAGE'&&event.data?.id===sent.body.id).length,0,
    'Revoked messaging socket received protected data');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`),'1');
});

test('T07-WS-005',async t=>{
  const p=await pair(), socket=await messaging(p.b,t);
  await waitUntil('three heartbeat PING/PONG cycles',()=>socket.pingCount>=3,6000);
  assert.equal(socket.ws.readyState,1,'Healthy PONG client was closed');
  const sent=await message(p.a,p.id,'delivery after heartbeat cycles');
  assert.equal((await socket.take('NEW_MESSAGE')).data.id,sent.body.id);
});

test('T07-WS-006',async t=>{
  const owner=await user();
  const socket=await new NoPongSocket(h.base.replace(/^http/,'ws')+'/ws/messaging',owner.token,t).open();
  await closedWith(socket,4003,6000);
});

test('T07-WS-008',async t=>{
  const p=await pair(), oldSockets=[];
  for(let index=0;index<10;index++) oldSockets.push(await messaging(p.b,t));
  oldSockets.forEach(socket=>socket.ws.terminate());
  await Promise.all(oldSockets.map(socket=>waitUntil('terminated socket close',()=>socket.closeCode!==undefined)));
  const replacements=[];
  for(let index=0;index<10;index++) replacements.push(await messaging(p.b,t));
  const sent=await message(p.a,p.id,'delivery after reconnect fanout');
  for(const socket of replacements) assert.equal((await socket.take('NEW_MESSAGE')).data.id,sent.body.id);
});

test('T07-WS-010',async t=>{
  const p=await pair(), outsider=await user();
  const tab1=await messaging(p.a,t),tab2=await messaging(p.a,t);
  const receiver=await messaging(p.b,t),unrelated=await messaging(outsider,t);
  const typing={type:'TYPING',data:{conversation_id:p.id}};
  const stopped={type:'TYPING_STOP',data:{conversation_id:p.id}};
  await parallel(index=>Promise.resolve((index?tab2:tab1).send(index?stopped:typing)),2);
  const events=[await receiver.take('TYPING'),await receiver.take('TYPING_STOP')];
  assert.ok(events.every(event=>event.data.conversation_id===p.id));
  await noMoreEvents(unrelated,'TYPING',undefined,500);
  await noMoreEvents(unrelated,'TYPING_STOP',undefined,100);
});

test('T07-WS-016',async t=>{
  const a=await user(),b=await user(),c=await user();
  const ab=await ok('POST','/conversations',a.token,{other_user_id:b.id},201);
  const ac=await ok('POST','/conversations',a.token,{other_user_id:c.id},201);
  const oldB=await messaging(b,t);
  oldB.ws.terminate();
  await waitUntil('old B socket close',()=>oldB.closeCode!==undefined);
  const socketC=await messaging(c,t);
  const bodyB=validMessage('only B'),bodyC=validMessage('only C');
  await parallel(index=>request('POST',`/conversations/${index?ac.id:ab.id}/messages`,a.token,index?bodyC:bodyB),2);
  assert.equal((await socketC.take('NEW_MESSAGE')).data.id,bodyC.id);
  await noMoreEvents(socketC,'NEW_MESSAGE',bodyB.id);
  const newB=await messaging(b,t);
  await noMoreEvents(newB,'NEW_MESSAGE',bodyC.id);
  const history=await ok('GET',`/conversations/${ab.id}/messages?limit=10`,b.token);
  assert.ok(history.data.some(item=>item.id===bodyB.id),'B history lost while B was reconnecting');
});

// Regression oracle from T05/T07: must deliver the FIRST offer, no second dial.
test('T07-CALL-001',async t=>{
  const a=await user(),b=await user(),callId=uuid();
  const inbox=await messaging(b,t),caller=await signaling(a,t);
  caller.send(offer(b.id,callId));
  assert.equal((await inbox.take('CALL_INCOMING')).data.call_id,callId);
  const receiver=await signaling(b,t);
  const received=await receiver.take('CALL_OFFER',4000);
  assert.equal(received.call_id,callId);
  assert.equal(received.from_user_id,a.id);
  receiver.send(act('CALL_ANSWER',a.id,callId,{sdp:'T07 answer'}));
  assert.equal((await caller.take('CALL_ANSWER')).call_id,callId);
  receiver.send(act('CALL_END',a.id,callId));
  assert.equal((await caller.take('CALL_END')).call_id,callId);
});

test('T07-CALL-002',async t=>{
  const a=await user();
  await ok('POST','/auth/logout',a.token,{refresh_token:a.refresh},204);
  await ok('GET','/users/me',a.token,undefined,401);
  // Authentication must be denied either at HTTP Upgrade (401/403) or WS close (4001).
  await deniedSignaling(a,t);
});

test('T07-CALL-003',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const callers=[await signaling(a,t),await signaling(a,t)],receiver=await signaling(b,t);
  const callIds=[uuid(),uuid()];
  await parallel(index=>Promise.resolve(callers[index].send(offer(b.id,callIds[index]))),2);
  const incoming=await inbox.take('CALL_INCOMING');
  const relayed=await receiver.take('CALL_OFFER');
  assert.equal(relayed.call_id,incoming.data.call_id);
  assert.ok(callIds.includes(relayed.call_id));
  await waitUntil('losing duplicate offer error',()=>callers.some(socket=>socket.events.some(event=>event.type==='ERROR')));
  const errors=callers.flatMap(socket=>socket.events.filter(event=>event.type==='ERROR'));
  assert.ok(errors.some(event=>event.data?.code==='TARGET_BUSY'));
  await wait(300);
  assert.equal(inbox.events.filter(event=>event.type==='CALL_INCOMING').length,0,'Losing offer emitted CALL_INCOMING');
  receiver.send(act('CALL_END',a.id,relayed.call_id));
});

test('T07-CALL-004',async t=>{
  const a=await user(),b=await user();
  const inboxA=await messaging(a,t),inboxB=await messaging(b,t);
  const socketA=await signaling(a,t),socketB=await signaling(b,t);
  const idA=uuid(),idB=uuid();
  await parallel(index=>Promise.resolve(index
    ? socketB.send(offer(a.id,idB))
    : socketA.send(offer(b.id,idA))),2);
  await waitUntil('one glare offer and one busy error',()=>{
    const events=[...socketA.events,...socketB.events];
    return events.some(event=>event.type==='CALL_OFFER')&&events.some(event=>event.type==='ERROR');
  });
  const offers=[...socketA.events,...socketB.events].filter(event=>event.type==='CALL_OFFER');
  const errors=[...socketA.events,...socketB.events].filter(event=>event.type==='ERROR');
  assert.equal(offers.length,1,'Glare created more than one relayed offer');
  assert.ok(errors.some(event=>event.data?.code==='TARGET_BUSY'));
  await wait(200);
  const incoming=[...inboxA.events,...inboxB.events].filter(event=>event.type==='CALL_INCOMING');
  assert.equal(incoming.length,1,'Glare emitted more than one incoming call');
  const winner=offers[0];
  const calleeSocket=winner.from_user_id===a.id?socketB:socketA;
  calleeSocket.send(act('CALL_END',winner.from_user_id,winner.call_id));
});

test('T07-CALL-005',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const socketA=await signaling(a,t),socketB=await signaling(b,t),callId=uuid();
  socketA.send(offer(b.id,callId));
  await inbox.take('CALL_INCOMING');
  await socketB.take('CALL_OFFER');
  socketB.send(act('CALL_ANSWER',a.id,callId,{sdp:'answer'}));
  await socketA.take('CALL_ANSWER');
  await parallel(index=>Promise.resolve(index
    ? socketB.send(act('CALL_END',a.id,callId))
    : socketA.send(act('CALL_END',b.id,callId))),2);
  await waitUntil('one end relay and one stale-session error',()=>{
    const events=[...socketA.events,...socketB.events];
    return events.some(event=>event.type==='CALL_END')&&events.some(event=>event.type==='ERROR');
  });
  const all=[...socketA.events,...socketB.events];
  assert.equal(all.filter(event=>event.type==='CALL_END').length,1);
  assert.ok(all.some(event=>event.type==='ERROR'&&event.data?.code==='INVALID_CALL_SESSION'));
});

test('T07-CALL-007',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const caller=await signaling(a,t),callee=await signaling(b,t),callId=uuid();
  caller.send(offer(b.id,callId));
  await inbox.take('CALL_INCOMING');
  await callee.take('CALL_OFFER');
  caller.ws.terminate();
  const ended=await callee.take('CALL_END',4000);
  assert.equal(ended.call_id,callId);
  assert.equal(ended.data?.reason,'peer_disconnected');
});

test('T07-CALL-013',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const caller=await signaling(a,t),callee1=await signaling(b,t),callee2=await signaling(b,t),callId=uuid();
  caller.send(offer(b.id,callId));
  await inbox.take('CALL_INCOMING');
  assert.equal((await callee1.take('CALL_OFFER')).call_id,callId);
  assert.equal((await callee2.take('CALL_OFFER')).call_id,callId);
  callee1.send(act('CALL_ANSWER',a.id,callId,{sdp:'first device answer'}));
  assert.equal((await caller.take('CALL_ANSWER')).call_id,callId);
  const siblingState=await callee2.take('CALL_ANSWER');
  assert.equal(siblingState.call_id,callId,'Sibling signaling socket was not synchronized after answer');
  callee1.send(act('CALL_END',a.id,callId));
});

// Widening variants beyond T05: they are not a proof of a server transaction barrier.
test('T07-AUTH-002',async t=>{
  const a=await user();
  await ok('POST','/auth/logout',a.token,{refresh_token:a.refresh},204);
  await ok('GET','/users/me',a.token,undefined,401);
  const socket=new Socket(h.base.replace(/^http/,'ws')+'/ws/messaging',a.token,t);
  // Server may reject during handshake or open then close. It must not stay usable.
  try { await socket.open(); } catch (err) {
    assert.match(String(err.message), /Unexpected server response: (401|403)\b/,
      `Expected authentication rejection, not network failure: ${err.message}`);
    return;
  }
  const end=Date.now()+6000;
  while(socket.closeCode===undefined&&Date.now()<end)await wait(25);
  assert.notEqual(socket.closeCode,undefined,'Revoked messaging WS remained open');
});

test('T07-AUTH-003',async t=>{
  const a=await user();
  await ok('POST','/auth/logout',a.token,{refresh_token:a.refresh},204);
  await deniedSignaling(a,t);
});
