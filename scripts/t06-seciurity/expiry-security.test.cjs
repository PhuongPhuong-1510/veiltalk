const { assert, caseTest: test, user, video, readyVideo, ok, sql, redis, wait } =
  require('../t04-api/support.cjs');

async function pastExpiry(signedUrl) {
  const url = new URL(signedUrl);
  const date = url.searchParams.get('X-Amz-Date');
  const seconds = Number(url.searchParams.get('X-Amz-Expires'));
  assert.match(date, /^\d{8}T\d{6}Z$/);
  assert.equal(seconds, 3);
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
  await wait(Math.max(0, Date.parse(iso) + seconds * 1000 + 2000 - Date.now()));
}

test('VID-006 expired presigned PUT and GET URLs are refused without metadata mutation', async () => {
  const owner = await user();
  const recording = await video(owner);
  const before = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${recording.id}'`);
  const session = redis('HGETALL', `video:upload:${recording.id}`);
  await pastExpiry(recording.first_chunk_url);
  const stalePut = await fetch(recording.first_chunk_url, {
    method: 'PUT', body: Buffer.alloc(16), signal: AbortSignal.timeout(5000),
  });
  assert.equal(stalePut.status, 403);
  await stalePut.arrayBuffer();
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${recording.id}'`), before);
  assert.equal(redis('HGETALL', `video:upload:${recording.id}`), session);
  await ok('POST', `/videos/${recording.id}/abort`, owner.token,
    { upload_id: recording.upload_id }, 204);

  const ready = await readyVideo(await user());
  const used = sql(`SELECT status, file_size_bytes FROM videos WHERE id='${ready.item.id}'`);
  await pastExpiry(ready.detail.view_url);
  const staleGet = await fetch(ready.detail.view_url, { signal: AbortSignal.timeout(5000) });
  assert.equal(staleGet.status, 403);
  await staleGet.arrayBuffer();
  assert.equal(sql(`SELECT status, file_size_bytes FROM videos WHERE id='${ready.item.id}'`), used);
  assert.equal(used.startsWith('ready|'), true);
});
