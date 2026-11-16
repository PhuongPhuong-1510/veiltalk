const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, request, ok, user, video, sql, redis } = h;

async function put(url, bytes) {
  const response = await fetch(url, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  await response.arrayBuffer();
  return etag;
}

test('VID-010 actual multipart bytes over quota cannot become READY', async () => {
  const a = await user();
  const item = await video(a, { estimated_size_bytes: 5 * 1024 * 1024 + 20 });
  const first = Buffer.alloc(5 * 1024 * 1024, 0x61);
  const second = Buffer.alloc(5 * 1024 * 1024 + 64, 0x62);
  const etag1 = await put(item.first_chunk_url, first);
  const next = await ok('POST', `/videos/${item.id}/chunks`, a.token,
    { upload_id: item.upload_id, part_number: 2, etag_previous: etag1 });
  const etag2 = await put(next.chunk_url, second);
  const before = sql(`SELECT status FROM videos WHERE id='${item.id}'`);
  assert.equal(before, 'recording');
  const result = await request('POST', `/videos/${item.id}/finalize`, a.token,
    { upload_id: item.upload_id, duration_secs: 2,
      parts: [{ part_number: 1, etag: etag1 }, { part_number: 2, etag: etag2 }] });
  assert.equal(result.status, 507, `Expected actual-byte quota rejection, got HTTP ${result.status}`);
  assert.equal(result.data?.error?.code, 'STORAGE_QUOTA_EXCEEDED');
  assert.equal(sql(`SELECT status, deleted_at IS NOT NULL FROM videos WHERE id='${item.id}'`), 'failed|t');
  assert.equal(redis('EXISTS', `video:upload:${item.id}`), '0');
  assert.equal((await ok('GET', '/videos', a.token)).storage_used_bytes, 0);
  assert.notEqual((await request('GET', `/videos/${item.id}`, a.token)).status, 200);
});
