'use strict';
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHmac } = require('node:crypto');
const { request: rawHttpRequest } = require('node:http');
const { Readable } = require('node:stream');
const h = require('./support.cjs');
const { assert, caseTest: test, request, ok, user, pair, message, validMessage, parallel,
  sql, redis, messaging, signaling, Socket, wait, uuid, video, preparedVideo, uploadPart,
  abortVideo, password, validVideo } = h;

const path = id => `/videos/${id}`;
const call = (type,target,callId,data={}) => ({type,target_user_id:target,call_id:callId,data});
const offer = (target,callId) => call('CALL_OFFER',target,callId,{sdp:'T07 remaining offer'});
const webhookBody = (key,size) => ({Records:[{eventName:'s3:ObjectCreated:CompleteMultipartUpload',
  s3:{bucket:{name:'veiltalk-e2e'},object:{key,size}}}]});
const webhook = body => request('POST','/internal/videos/webhook',null,body,
  {headers:{Authorization:`Bearer ${process.env.E2E_WEBHOOK_SECRET}`}});
function shortAccessToken(owner,expiresAt) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt=Math.floor(Date.now()/1000)-1;
  const input=`${encode({alg:'HS256',typ:'JWT'})}.${encode({
    type:'access',jti:uuid(),iat:issuedAt,exp:expiresAt,sub:owner.id,role:'user',
  })}`;
  const signature=createHmac('sha256',process.env.E2E_JWT_SECRET).update(input).digest('base64url');
  return `${input}.${signature}`;
}
async function waitUntil(label,predicate,timeout=6000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
    if(predicate()) return;
    await wait(20);
  }
  assert.fail(`Timed out waiting for ${label}`);
}
function rawMessageRequest(owner,conversationId,body,mode) {
  const target=new URL(`/conversations/${conversationId}/messages`,h.base);
  const payload=JSON.stringify(body);
  return new Promise((resolvePromise,rejectPromise)=>{
    let settled=false;
    const finish=value=>{if(!settled){settled=true;clearTimeout(timer);resolvePromise(value);}};
    const req=rawHttpRequest(target,{method:'POST',headers:{
      Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),
    }});
    const timer=setTimeout(()=>{req.destroy();rejectPromise(new Error(`Raw HTTP ${mode} timed out`));},5000);
    req.on('response',response=>{
      const status=response.statusCode;
      response.destroy();
      finish({status,cut:'response-headers'});
    });
    req.on('error',error=>finish({status:0,cut:'client-socket',error:error.code??error.message}));
    req.on('finish',()=>{
      if(mode==='abort-after-body') setImmediate(()=>{
        req.destroy(new Error('intentional T07 client abort'));
        finish({status:0,cut:'after-body'});
      });
    });
    req.end(payload);
  });
}
async function listAllConversations(owner,firstPage) {
  const ids=[];
  let page=firstPage??await ok('GET','/conversations?limit=5',owner.token);
  for(;;) {
    ids.push(...page.data.map(item=>item.id));
    if(!page.has_more) break;
    assert.ok(page.next_cursor,'Conversation page omitted next_cursor');
    page=await ok('GET',`/conversations?limit=5&cursor=${encodeURIComponent(page.next_cursor)}`,owner.token);
  }
  return ids;
}
async function prepareExistingVideo(owner,item,fill) {
  const media=readFileSync(resolve(__dirname,'../t04-api/fixtures/valid.webm'));
  const first=Buffer.alloc(5*1024*1024,fill);
  media.copy(first);
  const last=Buffer.alloc(14,fill);
  const etag1=await uploadPart(item.first_chunk_url,first);
  const next=await ok('POST',`${path(item.id)}/chunks`,owner.token,
    {upload_id:item.upload_id,part_number:2,etag_previous:etag1});
  const etag2=await uploadPart(next.chunk_url,last);
  return {item,finalize:{upload_id:item.upload_id,duration_secs:2,
    parts:[{part_number:1,etag:etag1},{part_number:2,etag:etag2}]}};
}
async function quotaFinalizeRace(label) {
  const owner=await user();
  const limit=2147483648,actualBytes=5*1024*1024+14;
  // reserveNextPart conservatively checks 2 * 5 MiB while the real two-part object
  // is 2 * (5 MiB + 14 bytes). Keep exactly 14 bytes between those boundaries.
  const seedBytes=limit-(2*actualBytes)+14;
  const seedId=uuid();
  sql(`INSERT INTO videos(id,user_id,title,storage_path,file_size_bytes,duration_secs,status,format)
    VALUES ('${seedId}','${owner.id}','${label} quota seed','t07/${seedId}',${seedBytes},1,'ready','webm')`);
  const create=await parallel(index=>request('POST','/videos',owner.token,
    validVideo({title:`${label}-${index}`,estimated_size_bytes:actualBytes})),2);
  assert.deepEqual(create.responses.map(response=>response.status),[201,201],
    `Both individually fitting initiations must succeed: ${create.responses.map(r=>r.status).join(',')}`);
  const uploads=await Promise.all(create.responses.map((response,index)=>prepareExistingVideo(owner,response.data,0x64+index)));
  const finalized=await parallel(index=>request('POST',`${path(uploads[index].item.id)}/finalize`,
    owner.token,uploads[index].finalize),2);
  assert.equal(finalized.responses.filter(response=>response.status===202).length,1,
    `Expected one quota winner: ${finalized.responses.map(r=>r.status).join(',')}`);
  assert.equal(finalized.responses.filter(response=>response.status===507).length,1,
    `Expected one quota rejection: ${finalized.responses.map(r=>r.status).join(',')}`);
  const readyOrReserved=Number(sql(`SELECT COALESCE(SUM(file_size_bytes),0) FROM videos
    WHERE user_id='${owner.id}' AND status IN ('ready','processing') AND deleted_at IS NULL`));
  assert.ok(readyOrReserved<=limit,`Quota overcommitted: ${readyOrReserved} > ${limit}`);
  assert.equal(redis('EXISTS',`video:quota-lock:${owner.id}`),'0','Quota lock remained after finalize race');
  for(const upload of uploads) {
    assert.equal(redis('EXISTS',`video:operation-lock:${upload.item.id}`),'0','Video lock remained after finalize race');
  }
}

const actual = new Map();

actual.set('T07-AUTH-001',async()=>{
  const owner=await user();
  const count=20;
  const {responses,dispatchNs,finishNs}=await parallel(index=>index===count
    ? request('POST','/auth/logout',owner.token,{refresh_token:owner.refresh})
    : request('GET','/users/me',owner.token),count+1);
  const logout=responses[count];
  assert.equal(logout.status,204,`Logout failed at revoke point: ${logout.status}`);
  assert.ok(responses.slice(0,count).every(response=>[200,401].includes(response.status)),
    `A request racing revoke returned an unexpected status: ${responses.slice(0,count).map(r=>r.status).join(',')}`);
  const after=await parallel(()=>request('GET','/users/me',owner.token),10);
  assert.ok(after.responses.every(response=>response.status===401),
    `A request dispatched after logout completion was authenticated: ${after.responses.map(r=>r.status).join(',')}`);
  assert.equal((await request('POST','/auth/refresh',null,{refresh_token:owner.refresh})).status,401);
  assert.equal(sql(`SELECT revoked_at IS NOT NULL FROM refresh_tokens WHERE user_id='${owner.id}'`),'t');
  assert.ok(BigInt(finishNs)>=BigInt(dispatchNs),'Invalid monotonic request timeline');
});

actual.set('T07-AUTH-010',async t=>{
  const p=await pair();
  const expiresAt=Math.floor(Date.now()/1000)+5;
  const token=shortAccessToken(p.b,expiresAt);
  const socket=new Socket(h.base.replace(/^http/,'ws')+'/ws/messaging',token,t);
  let closedAt;
  socket.ws.once('close',()=>{closedAt=Date.now();});
  await socket.open();
  await waitUntil('short-lived token socket PING',()=>socket.seenPing===true,2500);
  await waitUntil('short-lived token socket expiry close',()=>socket.closeCode!==undefined,7000);
  assert.equal(socket.closeCode,4002,`Expired socket closed with ${socket.closeCode}`);
  const expiryMs=expiresAt*1000;
  assert.ok(closedAt>=expiryMs-250&&closedAt<=expiryMs+1500,
    `Expiry close was outside tolerance: expiry=${expiryMs}, close=${closedAt}`);
  const sent=await message(p.a,p.id,'after recipient token expiry');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.body.id}'`),'1');
  assert.equal(socket.events.some(event=>event.type==='NEW_MESSAGE'&&event.data?.id===sent.body.id),false,
    'Expired WebSocket received protected data');
});

actual.set('T07-AUTH-009',async()=>{
  const owner=await user();
  let outage;
  await h.withPausedContainer(process.env.E2E_REDIS_CONTAINER,async()=>{
    try {
      outage=await request('POST','/auth/logout',owner.token,{refresh_token:owner.refresh},{timeout:4000});
    } catch(error) { outage={status:0,error:error.name}; }
  });
  assert.notEqual(outage.status,204,'Logout reported success while Redis revocation was unavailable');
  let usable;
  const deadline=Date.now()+12000;
  while(Date.now()<deadline) {
    try { usable=await request('GET','/users/me',owner.token,undefined,{timeout:2500}); }
    catch { usable=null; }
    if(usable?.status===200) break;
    await wait(150);
  }
  assert.equal(usable?.status,200,'Token did not return to its pre-logout state after failed revoke');
  await ok('POST','/auth/logout',owner.token,{refresh_token:owner.refresh},204);
  assert.equal((await request('GET','/users/me',owner.token)).status,401);
});

actual.set('T07-CONV-005',async()=>{
  const owner=await user(),original=[];
  for(let index=0;index<12;index++) {
    const other=await user();
    original.push((await ok('POST','/conversations',owner.token,{other_user_id:other.id},201)).id);
  }
  const first=await ok('GET','/conversations?limit=5',owner.token);
  const newcomer=await user();
  const added=await ok('POST','/conversations',owner.token,{other_user_id:newcomer.id},201);
  const found=await listAllConversations(owner,first);
  assert.equal(new Set(found).size,found.length,'Moving conversation cursor duplicated a row');
  h.sameElements(found,original,'Moving cursor lost an original conversation');
  assert.ok(!found.includes(added.id),'New head row appeared behind an older cursor');
});

actual.set('T07-CONV-006',async()=>{
  const owner=await user(),ids=[];
  for(let index=0;index<12;index++) {
    const other=await user();
    ids.push((await ok('POST','/conversations',owner.token,{other_user_id:other.id},201)).id);
  }
  sql(`UPDATE conversations SET updated_at=NOW() WHERE id IN (${ids.map(id=>`'${id}'`).join(',')})`);
  const found=await listAllConversations(owner);
  assert.equal(new Set(found).size,found.length);
  h.sameElements(found,ids,'Tuple cursor lost conversations sharing updated_at');
});

actual.set('T07-CONV-007',async()=>{
  const owner=await user(),other=await user();
  await ok('POST','/conversations',owner.token,{other_user_id:other.id},201);
  const {responses}=await parallel(index=>index
    ? request('DELETE','/users/me',owner.token,{password})
    : request('GET','/conversations?limit=5',owner.token),2);
  assert.equal(responses[1].status,204);
  assert.ok([200,401].includes(responses[0].status));
  assert.equal((await request('GET','/conversations?limit=5',owner.token)).status,401);
});

actual.set('T07-MSG-008',async()=>{
  const p=await pair();
  const insidePast={id:uuid(),content:'inside past boundary',client_timestamp:new Date(Date.now()-299000).toISOString()};
  const insideFuture={id:uuid(),content:'inside future boundary',client_timestamp:new Date(Date.now()+299000).toISOString()};
  assert.equal((await request('POST',`/conversations/${p.id}/messages`,p.a.token,insidePast)).status,201);
  assert.equal((await request('POST',`/conversations/${p.id}/messages`,p.a.token,insideFuture)).status,201);
  const outside={id:uuid(),content:'outside boundary',client_timestamp:new Date(Date.now()+301000).toISOString()};
  assert.equal((await request('POST',`/conversations/${p.id}/messages`,p.a.token,outside)).status,400);
});

actual.set('T07-MSG-012',async()=>{
  const p=await pair(),sent=await message(p.a,p.id,'status while recipient deleted');
  const {responses}=await parallel(index=>index
    ? request('DELETE','/users/me',p.b.token,{password})
    : request('PUT',`/conversations/${p.id}/messages/${sent.body.id}`,p.b.token,{status:'read'}),2);
  assert.equal(responses[1].status,204);
  assert.ok([200,401].includes(responses[0].status));
  assert.ok(['sent','read'].includes(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`)));
  assert.equal((await request('GET',`/conversations/${p.id}/messages`,p.b.token)).status,401);
});

actual.set('T07-MSG-005',async t=>{
  const p=await pair(),receiver=await messaging(p.b,t),body=validMessage('response deliberately lost after commit');
  const cut=await rawMessageRequest(p.a,p.id,body,'cut-response');
  assert.equal(cut.status,201,`Server did not commit before response cut: ${JSON.stringify(cut)}`);
  await waitUntil('committed message after response cut',()=>sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`)==='1');
  assert.equal((await receiver.take('NEW_MESSAGE')).data.id,body.id);
  const retry=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  assert.equal(retry.status,200,'Idempotent retry must return the existing message');
  assert.equal(retry.data.id,body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
  await h.noMoreEvents(receiver,'NEW_MESSAGE',body.id,700);
});

actual.set('T07-MSG-016',async()=>{
  const p=await pair(),body=validMessage('client abort after request body');
  await rawMessageRequest(p.a,p.id,body,'abort-after-body');
  await wait(300);
  const before=Number(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`));
  assert.ok(before===0||before===1,`Half-written message count: ${before}`);
  const retry=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  assert.equal(retry.status,before===1?200:201,
    `Retry status ${retry.status} contradicted pre-retry DB count ${before}`);
  assert.equal(retry.data.id,body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
});

actual.set('T07-PUB-012',async t=>{
  const p=await pair(),socketA=await messaging(p.a,t),socketB=await messaging(p.b,t);
  const sent=await message(p.a,p.id,'status fanout');
  await ok('PUT',`/conversations/${p.id}/messages/${sent.body.id}`,p.b.token,{status:'read'});
  const [eventA,eventB]=await Promise.all([socketA.take('MESSAGE_STATUS_UPDATE'),socketB.take('MESSAGE_STATUS_UPDATE')]);
  assert.equal(eventA.data.id,sent.body.id);
  assert.deepEqual(eventB,eventA);
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`),'read');
});

actual.set('T07-PUB-004',async t=>{
  const p=await pair(),receiver=await messaging(p.b,t),body=validMessage('HTTP and WS correlation');
  const started=process.hrtime.bigint();
  const eventPromise=receiver.take('NEW_MESSAGE').then(event=>({event,at:process.hrtime.bigint()}));
  const response=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  const responseAt=process.hrtime.bigint();
  const delivered=await eventPromise;
  assert.equal(response.status,201);
  assert.equal(response.data.id,body.id);
  assert.equal(delivered.event.data.id,body.id);
  assert.equal(delivered.event.data.conversation_id,p.id);
  assert.ok(responseAt>=started&&delivered.at>=started,'Timeline did not use a common monotonic clock');
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}' AND conversation_id='${p.id}'`),'1');
});

actual.set('T07-PUB-008',async t=>{
  const p=await pair(),receiver=await messaging(p.b,t);
  const before=redis('CLIENT','LIST','TYPE','pubsub').split(/\r?\n/).filter(Boolean).length;
  assert.ok(before>=1,'No Redis subscriber connection existed before restart');
  const killed=Number(redis('CLIENT','KILL','TYPE','pubsub'));
  assert.ok(killed>=1,`Redis did not kill a subscriber connection: ${killed}`);
  await waitUntil('Redis subscriber reconnect',()=>
    redis('CLIENT','LIST','TYPE','pubsub').split(/\r?\n/).filter(Boolean).length>=before,10000);
  const body=validMessage('event after subscriber reconnect');
  const response=await request('POST',`/conversations/${p.id}/messages`,p.a.token,body);
  assert.equal(response.status,201);
  assert.equal((await receiver.take('NEW_MESSAGE',6000)).data.id,body.id);
  assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${body.id}'`),'1');
  await h.noMoreEvents(receiver,'NEW_MESSAGE',body.id,700);
});

actual.set('T07-PUB-011',async t=>{
  const p=await pair(),slow=await messaging(p.b,t),healthy=await messaging(p.b,t);
  slow.ws._socket.pause();
  const bodies=Array.from({length:30},(_,index)=>validMessage(`backlog-${index}-${'x'.repeat(3500)}`));
  const sent=await Promise.all(bodies.map(body=>request('POST',`/conversations/${p.id}/messages`,p.a.token,body)));
  assert.ok(sent.every(response=>response.status===201),`Burst HTTP statuses: ${sent.map(r=>r.status).join(',')}`);
  const received=new Set();
  for(let index=0;index<bodies.length;index++) received.add((await healthy.take('NEW_MESSAGE',8000)).data.id);
  assert.equal(received.size,bodies.length,'Healthy receiver lost or duplicated backlog events');
  assert.equal(Number(sql(`SELECT count(*) FROM messages WHERE id IN (${bodies.map(body=>`'${body.id}'`).join(',')})`)),bodies.length);
  slow.ws._socket.resume();
  const control=await message(p.a,p.id,'after slow receiver backlog');
  assert.equal((await healthy.take('NEW_MESSAGE')).data.id,control.body.id);
});

actual.set('T07-WS-009',async t=>{
  const owner=await user();
  let socket;
  const {responses}=await parallel(index=>{
    if(index) return request('POST','/auth/logout',owner.token,{refresh_token:owner.refresh});
    socket=new Socket(h.base.replace(/^http/,'ws')+'/ws/messaging',owner.token,t);
    return socket.open().then(()=>({status:101})).catch(error=>({status:/401|403/.test(error.message)?401:599}));
  },2);
  assert.equal(responses[1].status,204);
  assert.ok([101,401].includes(responses[0].status));
  await waitUntil('racing messaging socket to close',()=>socket.closeCode!==undefined);
});

actual.set('T07-WS-011',async t=>{
  const p=await pair(),sockets=[await messaging(p.b,t),await messaging(p.b,t),await messaging(p.b,t)];
  const body=validMessage('fanout while one socket closes');
  await parallel(index=>index
    ? request('POST',`/conversations/${p.id}/messages`,p.a.token,body)
    : Promise.resolve(sockets[1].ws.terminate()),2);
  assert.equal((await sockets[0].take('NEW_MESSAGE')).data.id,body.id);
  assert.equal((await sockets[2].take('NEW_MESSAGE')).data.id,body.id);
});

actual.set('T07-WS-014',async t=>{
  const p=await pair(),offender=await messaging(p.b,t),control=await messaging(p.b,t);
  offender.send({type:'TYPING',data:{conversation_id:p.id,padding:'x'.repeat(40000)}});
  await waitUntil('oversized WebSocket to close',()=>offender.closeCode!==undefined);
  const sent=await message(p.a,p.id,'control survives oversized frame');
  assert.equal((await control.take('NEW_MESSAGE')).data.id,sent.body.id);
});

actual.set('T07-WS-015',async t=>{
  const owner=await user(),url=h.base.replace(/^http/,'ws')+'/ws/messaging';
  for(let index=0;index<100;index++) {
    const socket=await new Socket(url,owner.token,t).open();
    const closed=new Promise(resolve=>socket.ws.once('close',resolve));
    socket.ws.close();
    await Promise.race([closed,wait(2000).then(()=>assert.fail(`Socket cycle ${index} did not close`))]);
  }
  await wait(300);
  assert.equal(redis('ZCARD',`rate:messaging:user:${owner.id}`),'0','Messaging connection leases grew after 100 close cycles');
  const fresh=await messaging(owner,t);
  assert.equal(fresh.seenPing,true,'Fresh socket failed after 100 connection cycles');
});

actual.set('T07-CALL-008',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const caller=await signaling(a,t),callee=await signaling(b,t),callId=uuid();
  caller.send(offer(b.id,callId));
  await inbox.take('CALL_INCOMING'); await callee.take('CALL_OFFER');
  callee.send(call('CALL_ANSWER',a.id,callId,{sdp:'answer'}));
  await caller.take('CALL_ANSWER');
  callee.ws.terminate();
  const ended=await caller.take('CALL_END');
  assert.equal(ended.data.reason,'peer_disconnected');
});

actual.set('T07-CALL-010',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const caller=await signaling(a,t),callee=await signaling(b,t),callId=uuid();
  caller.send(offer(b.id,callId)); await inbox.take('CALL_INCOMING'); await callee.take('CALL_OFFER');
  await parallel(index=>Promise.resolve(index
    ? callee.send(call('CALL_REJECT',a.id,callId))
    : caller.send(call('CALL_END',b.id,callId))),2);
  await waitUntil('reject/end resolution',()=>[...caller.events,...callee.events].some(event=>event.type==='ERROR'));
  const all=[...caller.events,...callee.events];
  assert.equal(all.filter(event=>event.type==='CALL_REJECT'||event.type==='CALL_END').length,1);
  assert.ok(all.some(event=>event.type==='ERROR'&&event.data?.code==='INVALID_CALL_SESSION'));
});

actual.set('T07-CALL-014',async t=>{
  const a=await user(),b=await user(),inbox=await messaging(b,t);
  const caller=await signaling(a,t),callee=await signaling(b,t),callId=uuid();
  caller.send(offer(b.id,callId)); await inbox.take('CALL_INCOMING'); await callee.take('CALL_OFFER');
  caller.send(call('CALL_END',b.id,callId)); await callee.take('CALL_END');
  caller.send(call('ICE_CANDIDATE',b.id,callId,{candidate:'late'}));
  const error=await caller.take('ERROR');
  assert.equal(error.data.code,'INVALID_CALL_SESSION');
});

actual.set('T07-VID-008',async()=>{
  const owner=await user(),item=await video(owner),key=sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  assert.equal((await abortVideo(owner,item)).status,204);
  assert.equal((await webhook(webhookBody(key,5))).status,204);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`),'t');
});

actual.set('T07-VID-009',async()=>{
  const owner=await user(),item=await video(owner),key=sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  await ok('DELETE',path(item.id),owner.token,undefined,204);
  assert.equal((await webhook(webhookBody(key,5))).status,204);
  assert.equal((await request('GET',path(item.id),owner.token)).status,404);
});

actual.set('T07-VID-014',async()=>{
  const owner=await user(),prepared=await preparedVideo(owner);
  redis('HSET',`video:upload:${prepared.item.id}`,'etag:1','tampered');
  const response=await request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize);
  assert.equal(response.status,400);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`),'recording');
});

actual.set('T07-VID-017',async()=>{
  const owner=await user(),item=await video(owner);
  let started;
  const firstChunkSent=new Promise(resolveStarted=>{started=resolveStarted;});
  async function* slowPart() {
    for(let index=0;index<80;index++) {
      if(index===0) started();
      yield Buffer.alloc(64*1024,0x71);
      await wait(10);
    }
  }
  const putPromise=fetch(item.first_chunk_url,{method:'PUT',body:Readable.from(slowPart()),duplex:'half',
    signal:AbortSignal.timeout(10000)}).then(async response=>{await response.arrayBuffer();return response.status;})
    .catch(error=>({error:error.name}));
  await firstChunkSent;
  await wait(80);
  const aborted=await abortVideo(owner,item);
  assert.equal(aborted.status,204);
  const putOutcome=await putPromise;
  assert.notEqual(putOutcome,200,`Streaming PUT completed successfully after abort: ${JSON.stringify(putOutcome)}`);
  assert.equal(redis('EXISTS',`video:upload:${item.id}`),'0');
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`),'t');
  const finalize=await request('POST',`${path(item.id)}/finalize`,owner.token,
    {upload_id:item.upload_id,duration_secs:1,parts:[{part_number:1,etag:'unusable-after-abort'}]});
  assert.ok([404,409].includes(finalize.status),`Aborted upload was revivable: ${finalize.status}`);
});

actual.set('T07-VID-020',async()=>{
  const owner=await user(),prepared=await preparedVideo(owner),title='renamed during ready transition';
  const {responses}=await parallel(index=>index
    ? request('PUT',path(prepared.item.id),owner.token,{title})
    : request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize),2);
  assert.equal(responses[0].status,202);
  assert.equal(responses[1].status,200);
  const end=Date.now()+10000;
  let detail;
  while(Date.now()<end) {
    detail=await ok('GET',path(prepared.item.id),owner.token);
    if(detail.status==='ready') break;
    await wait(100);
  }
  assert.equal(detail.status,'ready');
  assert.equal(detail.title,title);
});

actual.set('T07-VID-010',()=>quotaFinalizeRace('VID-010'));
actual.set('T07-VID-011',()=>quotaFinalizeRace('VID-011'));

actual.set('T07-LOCK-010',async()=>{
  const owner=await user(),item=await video(owner);
  const etag=await uploadPart(item.first_chunk_url,Buffer.alloc(5*1024*1024,0x63));
  const body={upload_id:item.upload_id,part_number:2,etag_previous:etag};
  const {responses}=await parallel(()=>request('POST',`${path(item.id)}/chunks`,owner.token,body),8);
  assert.ok(responses.every(response=>response.status===200));
  assert.equal(redis('HGET',`video:upload:${item.id}`,'nextPartNumber'),'3');
  assert.equal(await abortVideo(owner,item).then(response=>response.status),204);
});

actual.set('T07-LOCK-011',async()=>{
  const p=await pair(),sent=await message(p.a,p.id,'pessimistic status lock');
  const {responses}=await parallel(index=>request('PUT',`/conversations/${p.id}/messages/${sent.body.id}`,
    p.b.token,{status:index%2?'delivered':'read'}),10);
  assert.ok(responses.every(response=>[200,400].includes(response.status)));
  assert.equal(sql(`SELECT status FROM messages WHERE id='${sent.body.id}'`),'read');
});

actual.set('T07-LOCK-006',async()=>{
  const owner=await user(),prepared=await preparedVideo(owner);
  const key=`video:operation-lock:${prepared.item.id}`,foreignOwner=`t07-foreign-${uuid()}`;
  redis('SET',key,foreignOwner,'PX','15000','NX');
  try {
    const started=process.hrtime.bigint();
    const response=await request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize,
      {timeout:12000});
    const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
    assert.equal(response.status,409,`Contended lock returned ${response.status}`);
    assert.ok(elapsedMs>=4500&&elapsedMs<=7500,`Lock acquire timeout was ${elapsedMs.toFixed(1)}ms, expected about 5000ms`);
    assert.equal(redis('GET',key),foreignOwner,'Waiting contender changed/deleted the current lock owner');
    assert.ok(Number(redis('PTTL',key))>0,'Held lock lost its TTL');
  } finally {
    redis('DEL',key);
    const cleanup=await abortVideo(owner,prepared.item);
    assert.equal(cleanup.status,204,`Fixture cleanup failed: ${cleanup.status}`);
  }
});

actual.set('T07-LOCK-008',()=>quotaFinalizeRace('LOCK-008'));

actual.set('T07-LOCK-009',async()=>{
  const a=await user(),b=await user();
  const [videoA,videoB]=await Promise.all([preparedVideo(a),preparedVideo(b)]);
  const heldKey=`video:quota-lock:${a.id}`,foreignOwner=`t07-held-${uuid()}`;
  redis('SET',heldKey,foreignOwner,'PX','15000','NX');
  try {
    const started=process.hrtime.bigint();
    const {responses}=await parallel(async index=>{
      const prepared=index?videoB:videoA,owner=index?b:a;
      const response=await request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize,
        {timeout:12000});
      return {response,finishedMs:Number(process.hrtime.bigint()-started)/1e6};
    },2);
    assert.equal(responses[0].response.status,409,`User A contention returned ${responses[0].response.status}`);
    assert.equal(responses[1].response.status,202,`User B was blocked by user A lock: ${responses[1].response.status}`);
    assert.ok(responses[1].finishedMs<3500,
      `Different-user finalize was unnecessarily serialized for ${responses[1].finishedMs.toFixed(1)}ms`);
    assert.equal(redis('GET',heldKey),foreignOwner,'User B operation modified user A lock');
    assert.equal(redis('EXISTS',`video:quota-lock:${b.id}`),'0','User B quota lock was not released');
    assert.equal(redis('EXISTS',`video:operation-lock:${videoB.item.id}`),'0','User B video lock was not released');
  } finally {
    redis('DEL',heldKey);
    const cleanup=await abortVideo(a,videoA.item);
    assert.equal(cleanup.status,204,`User A cleanup failed: ${cleanup.status}`);
  }
});

actual.set('T07-LOCK-012',async()=>{
  const owner=await user(),prepared=await preparedVideo(owner);
  const {responses}=await parallel(()=>request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize),10);
  assert.equal(responses.filter(response=>response.status===202).length,1,
    `Expected one finalize winner, got statuses ${responses.map(r=>r.status).join(',')}`);
  assert.ok(responses.filter(response=>response.status!==202).every(response=>[404,409].includes(response.status)),
    `Unexpected contention response: ${responses.map(r=>r.status).join(',')}`);
  assert.equal(redis('EXISTS',`video:operation-lock:${prepared.item.id}`),'0','Video operation lock remained after burst');
  assert.equal(redis('EXISTS',`video:quota-lock:${owner.id}`),'0','Quota lock remained after burst');
  assert.equal(redis('EXISTS',`video:upload:${prepared.item.id}`),'0','Completed upload session remained after burst');
  assert.ok(['processing','ready'].includes(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`)));
});

actual.set('T07-FAIL-001',async()=>{
  const owner=await user();
  await ok('POST','/auth/login',null,{email:owner.email,password:owner.password});
  let unavailable;
  const started=process.hrtime.bigint();
  await h.withPausedContainer(process.env.E2E_PG_CONTAINER,async()=>{
    try {
      unavailable=await request('POST','/auth/login',null,{email:owner.email,password:owner.password},{timeout:4000});
    } catch(error) {
      unavailable={status:0,error:error.name};
    }
  });
  const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
  assert.notEqual(unavailable.status,200,'Login returned a token while PostgreSQL was unavailable');
  assert.ok(elapsedMs<7000,`Database outage response was not bounded: ${elapsedMs.toFixed(1)}ms`);
  let recovered;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    try {
      recovered=await request('POST','/auth/login',null,{email:owner.email,password:owner.password},{timeout:3000});
      if(recovered.status===200) break;
    } catch { /* pool is reconnecting */ }
    await wait(200);
  }
  assert.equal(recovered?.status,200,`Login did not recover after PostgreSQL resumed: ${recovered?.status??'transport error'}`);
  assert.ok(recovered.data?.tokens?.access_token,'Recovered login omitted access token');
});

actual.set('T07-FAIL-003',async()=>{
  const owner=await user();
  let outage;
  const started=process.hrtime.bigint();
  await h.withPausedContainer(process.env.E2E_REDIS_CONTAINER,async()=>{
    try { outage=await request('GET','/users/me',owner.token,undefined,{timeout:4000}); }
    catch(error) { outage={status:0,error:error.name}; }
  });
  const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
  assert.notEqual(outage.status,200,'Protected user data was returned while revoke storage was unavailable');
  assert.ok(elapsedMs<7000,`Redis auth outage was not bounded: ${elapsedMs.toFixed(1)}ms`);
  let recovered;
  const deadline=Date.now()+12000;
  while(Date.now()<deadline) {
    try { recovered=await request('GET','/users/me',owner.token,undefined,{timeout:2500}); }
    catch { recovered=null; }
    if(recovered?.status===200) break;
    await wait(150);
  }
  assert.equal(recovered?.status,200,'JWT authentication did not recover after Redis resumed');
  assert.equal(recovered.data.id,owner.id);
});

actual.set('T07-REC-010',async()=>{
  const owner=await user(),item=await video(owner);
  await ok('DELETE','/users/me',owner.token,{password},204);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${owner.id}'`),'t');
  assert.equal(redis('EXISTS',`video:upload:${item.id}`),'0');
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`),'t');
});

const base=__dirname;
const spec=readFileSync(resolve(base,'VEILTALK_T07_RELIABILITY_CONCURRENCY_TEST_CASES.md'),'utf8');
const all=[...spec.matchAll(/^#### (T07-[A-Z]+-\d{3}) —/gm)].map(match=>match[1]);
const otherSource=readdirSync(base)
  .filter(name=>name.endsWith('.test.cjs')&&name!=='remaining.test.cjs')
  .map(name=>readFileSync(resolve(base,name),'utf8')).join('\n');
const existing=new Set([...otherSource.matchAll(/test\(['"](T07-[A-Z]+-\d{3})['"]/g)].map(match=>match[1]));

for(const id of all) {
  if(existing.has(id)) continue;
  const implementation=actual.get(id);
  // Missing implementations are deliberately not registered as fake failing tests.
  // write-results.cjs reports their absent JUnit evidence as FAIL_TEST/TEST_NOT_EXECUTED.
  if(implementation) test(id,implementation);
}

