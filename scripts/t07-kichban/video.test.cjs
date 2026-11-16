'use strict';
const h=require('./support.cjs');
const {assert,caseTest:test,user,video,uploadPart,request,redis,parallel,abortVideo,preparedVideo,
  readyVideo,ok,sql,wait}=h;
const path=id=>`/videos/${id}`;
const webhookBody=(key,size)=>({Records:[{eventName:'s3:ObjectCreated:CompleteMultipartUpload',
  s3:{bucket:{name:'veiltalk-e2e'},object:{key,size}}}]});
const webhook=body=>request('POST','/internal/videos/webhook',null,body,
  {headers:{Authorization:`Bearer ${process.env.E2E_WEBHOOK_SECRET}`}});

test('T07-VID-001',async()=>{
  const owner=await user(), prepared=await preparedVideo(owner);
  const {responses}=await parallel(()=>request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize),2);
  assert.deepEqual(responses.map(response=>response.status).sort(),[202,409]);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${prepared.item.id}'`),'1');
  assert.ok(['processing','ready'].includes(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`)));
  assert.equal(redis('EXISTS',`video:upload:${prepared.item.id}`),'0');
});

test('T07-VID-002',async()=>{
  const owner=await user(), prepared=await preparedVideo(owner);
  const {responses}=await parallel(index=>index
    ? request('POST',`${path(prepared.item.id)}/abort`,owner.token,{upload_id:prepared.item.upload_id})
    : request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize),2);
  const statuses=responses.map(response=>response.status);
  assert.equal(statuses.filter(status=>status===202||status===204).length,1,'Exactly one terminal operation must win');
  assert.equal(statuses.filter(status=>status===409).length,1,
    `The losing terminal operation must return 409; statuses=${statuses.join(',')}`);
  const row=sql(`SELECT status || '|' || (deleted_at IS NOT NULL) FROM videos WHERE id='${prepared.item.id}'`);
  assert.ok(['processing|false','ready|false','failed|true'].includes(row),`Contradictory final video row: ${row}`);
  assert.equal(redis('EXISTS',`video:upload:${prepared.item.id}`),'0');
});

test('T07-VID-003',async()=>{
  const owner=await user(), prepared=await preparedVideo(owner);
  const {responses}=await parallel(index=>index
    ? request('DELETE',path(prepared.item.id),owner.token)
    : request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize),2);
  assert.equal(responses[1].status,204,'Delete is valid for recording/processing videos');
  assert.ok([202,409].includes(responses[0].status),`Finalize race returned ${responses[0].status}`);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${prepared.item.id}'`),'t');
  assert.equal(redis('EXISTS',`video:upload:${prepared.item.id}`),'0',
    'Deleting a recording/processing video leaked its upload session');
  assert.equal((await request('GET',path(prepared.item.id),owner.token)).status,404);
});

test('T07-VID-004',async()=>{
  const owner=await user(), item=await video(owner);
  try {
    const first=Buffer.alloc(5*1024*1024,0x61);
    const etag=await uploadPart(item.first_chunk_url,first);
    const body={upload_id:item.upload_id,part_number:2,etag_previous:etag};
    const {responses}=await parallel(()=>request('POST',`/videos/${item.id}/chunks`,owner.token,body),2);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,200]);
    assert.ok(responses.every(r=>r.data?.part_number===2&&typeof r.data?.chunk_url==='string'));
    const key=`video:upload:${item.id}`;
    assert.equal(redis('HGET',key,'nextPartNumber'),'3');
    assert.equal(redis('HGET',key,'etag:1'),etag);
  } finally {
    // Isolated lab fixture, never abort another user's upload.
    const outcome=await abortVideo(owner,item);
    assert.equal(outcome.status,204,`Fixture cleanup failed: ${outcome.status}`);
  }
});

test('T07-VID-005',async()=>{
  const owner=await user(),item=await video(owner);
  try {
    const etag1=await uploadPart(item.first_chunk_url,Buffer.alloc(5*1024*1024,0x62));
    const {responses}=await parallel(index=>request('POST',`${path(item.id)}/chunks`,owner.token,index
      ? {upload_id:item.upload_id,part_number:3,etag_previous:'etag-without-uploaded-part-2'}
      : {upload_id:item.upload_id,part_number:2,etag_previous:etag1}),2);
    assert.equal(responses[0].status,200,`Part 2 reservation failed with ${responses[0].status}`);
    const part3=responses[1].status===400
      ? await request('POST',`${path(item.id)}/chunks`,owner.token,
        {upload_id:item.upload_id,part_number:3,etag_previous:'etag-without-uploaded-part-2'})
      : responses[1];
    assert.equal(part3.status,400,
      `Part 3 was reserved before part 2 bytes and its real ETag existed in MinIO; initial statuses=${responses.map(r=>r.status).join(',')}, final=${part3.status}`);
    assert.equal(redis('HGET',`video:upload:${item.id}`,'nextPartNumber'),'3');
  } finally {
    const outcome=await abortVideo(owner,item);
    assert.equal(outcome.status,204,`Fixture cleanup failed: ${outcome.status}`);
  }
});

test('T07-VID-006',async()=>{
  const owner=await user(),ready=await readyVideo(owner);
  const key=sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  const size=ready.first.length+ready.last.length;
  const before=await ok('GET',path(ready.item.id),owner.token);
  assert.equal((await webhook(webhookBody(key,size))).status,204);
  assert.equal((await webhook(webhookBody(key,size))).status,204);
  const after=await ok('GET',path(ready.item.id),owner.token);
  assert.equal(after.status,'ready');
  assert.equal(after.file_size_bytes,before.file_size_bytes);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${ready.item.id}' AND status='ready'`),'1');
});

test('T07-VID-012',async()=>{
  const firstOwner=await user(),secondOwner=await user();
  const first=await preparedVideo(firstOwner),second=await preparedVideo(secondOwner);
  const {responses}=await parallel(index=>index
    ? request('POST',`${path(second.item.id)}/finalize`,secondOwner.token,second.finalize)
    : request('POST',`${path(first.item.id)}/finalize`,firstOwner.token,first.finalize),2);
  assert.deepEqual(responses.map(response=>response.status),[202,202]);
  assert.ok(['processing','ready'].includes(sql(`SELECT status FROM videos WHERE id='${first.item.id}'`)));
  assert.ok(['processing','ready'].includes(sql(`SELECT status FROM videos WHERE id='${second.item.id}'`)));
});

test('T07-VID-013',async()=>{
  const owner=await user(),prepared=await preparedVideo(owner);
  redis('DEL',`video:upload:${prepared.item.id}`);
  const response=await request('POST',`${path(prepared.item.id)}/finalize`,owner.token,prepared.finalize);
  assert.equal(response.status,404);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${prepared.item.id}'`),'recording');
});

test('T07-VID-018',async()=>{
  const owner=await user(),ready=await readyVideo(owner);
  const {responses}=await parallel(index=>index
    ? request('DELETE',path(ready.item.id),owner.token)
    : request('GET',path(ready.item.id),owner.token),2);
  assert.equal(responses[1].status,204);
  assert.ok([200,404].includes(responses[0].status),`Concurrent GET returned ${responses[0].status}`);
  assert.equal((await request('GET',path(ready.item.id),owner.token)).status,404);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${ready.item.id}'`),'t');
});

test('T07-VID-022',async()=>{
  const owner=await user();
  for(let index=0;index<12;index++) {
    const item=await video(owner,{title:`create-abort-${index}`,estimated_size_bytes:1});
    assert.equal((await abortVideo(owner,item)).status,204);
    assert.equal(redis('EXISTS',`video:upload:${item.id}`),'0');
  }
  assert.equal(sql(`SELECT count(*) FROM videos WHERE user_id='${owner.id}' AND deleted_at IS NULL`),'0');
});
