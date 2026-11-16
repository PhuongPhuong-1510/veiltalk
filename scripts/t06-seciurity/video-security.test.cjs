const h = require('../t04-api/support.cjs');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { assert, caseTest: test, request, ok, user, video, readyVideo,
  validVideo, sql, redis, uuid, wait, uploadPart } = h;

function deny(response, statuses = [400, 401, 403, 404, 409]) {
  assert.ok(statuses.includes(response.status), `Expected denial; HTTP ${response.status}`);
  assert.equal(response.data?.view_url, undefined);
}
const webhook = key => ({ Records: [{ eventName: 's3:ObjectCreated:CompleteMultipartUpload',
  s3: { bucket: { name: 'veiltalk-e2e' }, object: { key, size: 12 } } }] });
const internal = body => request('POST', '/internal/videos/webhook', null, body,
  { headers: { Authorization: `Bearer ${process.env.E2E_WEBHOOK_SECRET}` } });

test('VID-013 outsider responses contain no owner download URL, key or upload ID', async () => {
  const a = await user(), b = await user(), ready = await readyVideo(b);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  const responses = [
    await request('GET', `/videos/${ready.item.id}`, a.token),
    await request('GET', '/videos', a.token),
    await request('GET', '/users/me', a.token),
  ];
  deny(responses[0], [403, 404]);
  for (const response of responses) {
    assert.equal(response.raw.includes(ready.detail.view_url), false);
    assert.equal(response.raw.includes(ready.item.upload_id), false);
    assert.equal(response.raw.includes(key), false);
    assert.equal(response.raw.includes('X-Amz-Signature'), false);
  }
});

test('VID-014 aborted upload rejects its old presigned PUT URL', async () => {
  const a = await user(), item = await video(a);
  await ok('POST', `/videos/${item.id}/abort`, a.token, { upload_id: item.upload_id }, 204);
  const response = await fetch(item.first_chunk_url, { method: 'PUT', body: Buffer.from('late'),
    signal: AbortSignal.timeout(5000) });
  assert.notEqual(response.status, 200);
  await response.arrayBuffer();
  assert.equal(redis('EXISTS', `video:upload:${item.id}`), '0');
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`), 't');
});

test('VID-015 presigned URL cannot be retargeted to another object or part', async () => {
  const a = await user(), b = await user(), first = await video(a), second = await video(b);
  const firstKey = sql(`SELECT storage_path FROM videos WHERE id='${first.id}'`);
  const secondKey = sql(`SELECT storage_path FROM videos WHERE id='${second.id}'`);
  const variants = [];
  const changedKey = new URL(first.first_chunk_url);
  changedKey.pathname = changedKey.pathname.replace(firstKey, secondKey);
  variants.push(changedKey);
  const changedPart = new URL(first.first_chunk_url);
  changedPart.searchParams.set('partNumber', '2');
  variants.push(changedPart);
  const changedUpload = new URL(first.first_chunk_url);
  changedUpload.searchParams.set('uploadId', second.upload_id);
  variants.push(changedUpload);
  const secondBefore = redis('HGETALL', `video:upload:${second.id}`);
  for (const url of variants) {
    const response = await fetch(url, { method: 'PUT', body: Buffer.alloc(1024),
      signal: AbortSignal.timeout(5000) });
    assert.notEqual(response.status, 200, `Retargeted URL succeeded: ${url.pathname}`);
    await response.arrayBuffer();
  }
  assert.equal(redis('HGETALL', `video:upload:${second.id}`), secondBefore);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${second.id}'`), 'recording');
});

test('VID-016 independently created video sessions use distinct object keys', async () => {
  const a = await user(), b = await user(), av = await video(a), bv = await video(b);
  const aKey = sql(`SELECT storage_path FROM videos WHERE id='${av.id}'`);
  const bKey = sql(`SELECT storage_path FROM videos WHERE id='${bv.id}'`);
  assert.notEqual(aKey, bKey);
  assert.match(aKey, /^videos\/[0-9a-f-]+\/source\.[a-z0-9]+$/);
  assert.match(bKey, /^videos\/[0-9a-f-]+\/source\.[a-z0-9]+$/);
  assert.equal(new URL(av.first_chunk_url).pathname.includes(aKey), true);
  assert.equal(new URL(bv.first_chunk_url).pathname.includes(bKey), true);
  assert.equal(new URL(av.first_chunk_url).pathname.includes(bKey), false);
});

test('VID-018 duplicate completion webhook is idempotent for quota and status', async () => {
  const a = await user(), ready = await readyVideo(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${ready.item.id}'`);
  const quota = (await ok('GET', '/videos', a.token)).storage_used_bytes;
  for (let i = 0; i < 3; i++) assert.equal((await internal(webhook(key))).status, 204);
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${ready.item.id}'`), before);
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, quota);
});

test('VID-019 delayed webhook after deletion cannot resurrect video or quota', async () => {
  const a = await user(), ready = await readyVideo(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${ready.item.id}'`);
  await ok('DELETE', `/videos/${ready.item.id}`, a.token, undefined, 204);
  const before = sql(`SELECT status, deleted_at IS NOT NULL FROM videos WHERE id='${ready.item.id}'`);
  assert.equal((await internal(webhook(key))).status, 204);
  assert.equal(sql(`SELECT status, deleted_at IS NOT NULL FROM videos WHERE id='${ready.item.id}'`), before);
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
  deny(await request('GET', `/videos/${ready.item.id}`, a.token), [404]);
});

test('VID-021 MinIO credentials are absent from video JSON, errors and service logs', async () => {
  const a = await user(), item = await video(a);
  const responses = [
    await request('GET', `/videos/${item.id}`, a.token),
    await request('POST', `/videos/${item.id}/finalize`, a.token,
      { upload_id: 'invalid', duration_secs: 1,
        parts: [{ part_number: 1, etag: 'invalid' }] }),
  ];
  const log = readFileSync(resolve(process.env.E2E_RESULT_DIR, 'backend.log'), 'utf8');
  for (const content of [...responses.map(response => response.raw), log]) {
    assert.equal(content.includes('e2eadmin'), false);
    assert.equal(content.includes('MINIO_SECRET_KEY'), false);
    assert.doesNotMatch(content, /AKIA[0-9A-Z]{16}|SecretAccessKey|stacktrace/i);
  }
});

test('VID-022 outsider delete cannot remove owner object or metadata', async () => {
  const a = await user(), b = await user(), ready = await readyVideo(b);
  const before = sql(`SELECT status, deleted_at IS NULL FROM videos WHERE id='${ready.item.id}'`);
  deny(await request('DELETE', `/videos/${ready.item.id}`, a.token), [403]);
  assert.equal(sql(`SELECT status, deleted_at IS NULL FROM videos WHERE id='${ready.item.id}'`), before);
  const owner = await ok('GET', `/videos/${ready.item.id}`, b.token);
  assert.ok(owner.view_url);
  const object = await fetch(owner.view_url, { signal: AbortSignal.timeout(5000) });
  assert.equal(object.status, 200);
  await object.arrayBuffer();
});

test('VID-023 recording video has no downloadable view URL', async () => {
  const a = await user(), item = await video(a);
  const detail = await ok('GET', `/videos/${item.id}`, a.token);
  assert.equal(detail.status, 'recording');
  assert.equal(detail.view_url, null);
  assert.equal(JSON.stringify(detail).includes('X-Amz-Signature'), false);
});

test('VID-020 false container or codec never becomes READY', async () => {
  const owner = await user();
  const realWebm = readFileSync(resolve(__dirname, '../t04-api/fixtures/valid.webm'));
  for (const [declaredFormat, first] of [
    ['webm', Buffer.alloc(5 * 1024 * 1024, 0x61)],
    ['mp4', Buffer.concat([realWebm, Buffer.alloc(5 * 1024 * 1024 - realWebm.length)])],
  ]) {
    const item = await video(owner, { format: declaredFormat });
    const etag1 = await uploadPart(item.first_chunk_url, first);
    const next = await ok('POST', `/videos/${item.id}/chunks`, owner.token,
      { upload_id: item.upload_id, part_number: 2, etag_previous: etag1 });
    const last = Buffer.alloc(20);
    const etag2 = await uploadPart(next.chunk_url, last);
    await ok('POST', `/videos/${item.id}/finalize`, owner.token, {
      upload_id: item.upload_id, duration_secs: 2,
      parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }],
    }, 202);
    const deadline = Date.now() + 15000;
    while (sql(`SELECT status FROM videos WHERE id='${item.id}'`) === 'processing'
      && Date.now() < deadline) await wait(150);
    assert.equal(sql(`SELECT status FROM videos WHERE id='${item.id}'`), 'failed', declaredFormat);
    const detail = await ok('GET', `/videos/${item.id}`, owner.token);
    assert.equal(detail.view_url, null);
    assert.equal(sql(`SELECT count(*) FROM videos WHERE id='${item.id}' AND status='ready'`), '0');
  }
  assert.equal(sql(`SELECT COALESCE(SUM(file_size_bytes),0) FROM videos WHERE user_id='${owner.id}' AND status='ready'`), '0');
  assert.equal((await readyVideo(await user())).detail.status, 'ready');
});

test('VID-024 client cannot set video size, status or storage path in JSON', async () => {
  const a = await user(), fakeKey = `videos/${uuid()}/source.mp4`;
  const create = await request('POST', '/videos', a.token, validVideo({
    file_size_bytes: 0, status: 'ready', storage_path: fakeKey,
  }));
  assert.equal(create.status, 201);
  const before = sql(`SELECT status, storage_path, file_size_bytes FROM videos WHERE id='${create.data.id}'`);
  assert.match(before, /^recording\|videos\//);
  assert.equal(before.includes(fakeKey), false);
  const update = await request('PUT', `/videos/${create.data.id}`, a.token,
    { title: 'safe rename', file_size_bytes: 0, status: 'ready', storage_path: fakeKey });
  assert.ok([200, 400].includes(update.status));
  assert.equal(sql(`SELECT status, storage_path, file_size_bytes FROM videos WHERE id='${create.data.id}'`), before);
});

test('VID-025 Origin header does not replace webhook shared secret', async () => {
  const a = await user(), item = await video(a);
  const key = sql(`SELECT storage_path FROM videos WHERE id='${item.id}'`);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`);
  for (const origin of ['http://localhost:5173', 'https://foreign.example']) {
    deny(await request('POST', '/internal/videos/webhook', null, webhook(key),
      { headers: { Origin: origin } }), [401, 403]);
  }
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${item.id}'`), before);
});

test('VID-026 test service logs do not persist full presigned query signatures', async () => {
  const a = await user(), item = await video(a);
  assert.ok(item.first_chunk_url.includes('X-Amz-Signature'));
  for (const filename of ['backend.log', 'signaling.log', 'build.log']) {
    const content = readFileSync(resolve(process.env.E2E_RESULT_DIR, filename), 'utf8');
    assert.equal(content.includes(item.first_chunk_url), false, `${filename} contains full URL`);
    assert.doesNotMatch(content, /[?&]X-Amz-Signature=[A-Fa-f0-9]{32,}/);
  }
});
