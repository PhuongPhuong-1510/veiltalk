const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, ok, user, video, readyVideo, validVideo, sql, redis, wait } = h;

test('ABUSE-011 caps three active uploads and cleans inactive PostgreSQL Redis and MinIO state', async () => {
  const a = await user(), b = await user();
  const uploads = [await video(a), await video(a), await video(a)];
  const denied = await request('POST', '/videos', a.token, validVideo());
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.equal(sql(`SELECT count(*) FROM videos WHERE user_id='${a.id}' AND status='recording' AND deleted_at IS NULL`), '3');
  const other = await readyVideo(b);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${other.item.id}'`), 'ready');
  const deadline = Date.now() + 20000;
  let cleaned = false;
  while (Date.now() < deadline) {
    cleaned = sql(`SELECT count(*) FROM videos WHERE user_id='${a.id}' AND status='failed' AND deleted_at IS NOT NULL`) === '3';
    if (cleaned) break;
    await wait(300);
  }
  assert.equal(cleaned, true, 'Inactive recording rows were not cleaned after test TTL');
  assert.equal(sql(`SELECT status, deleted_at IS NULL FROM videos WHERE id='${other.item.id}'`), 'ready|t');
  assert.ok((await ok('GET', `/videos/${other.item.id}`, b.token)).view_url);
  for (const item of uploads) assert.equal(redis('EXISTS', `video:upload:${item.id}`), '0');
  const stalePut = await fetch(uploads[0].first_chunk_url, {
    method: 'PUT', body: Buffer.from('late'), signal: AbortSignal.timeout(5000),
  });
  assert.notEqual(stalePut.status, 200, 'Expired MinIO multipart still accepted a part');
  await stalePut.arrayBuffer();
  const reopened = await ok('POST', '/videos', a.token, validVideo(), 201);
  assert.equal(sql(`SELECT status FROM videos WHERE id='${reopened.id}'`), 'recording');
});
