const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, user, pair, uuid, ok, sql, redis, wait,
  password, avatarModel, preparedVideo, readyVideo, uploadPart, video, messaging, message } = h;

test('T05-USR-001', async () => {
  const a = await user(), name = 'Tên T05 👋';
  await ok('PUT', '/users/me', a.token, { display_name: name });
  assert.equal((await ok('GET', '/users/me', a.token)).display_name, name);
  const login = await ok('POST', '/auth/login', null, { email: a.email, password });
  assert.equal((await ok('GET', '/users/me', login.tokens.access_token)).display_name, name);
  assert.equal(sql(`SELECT display_name FROM users WHERE id='${a.id}'`), name);
});

test('T05-USR-002', async () => {
  const a = await user(), before = await ok('GET', '/users/me/settings', a.token);
  await ok('PUT', '/users/me/settings', a.token, { theme: 'dark', discoverable: !before.discoverable,
    email_notifications: !before.email_notifications });
  const after = await ok('GET', '/users/me/settings', a.token);
  assert.equal(after.theme, 'dark');
  assert.equal(after.discoverable, !before.discoverable);
  assert.equal(after.email_notifications, !before.email_notifications);
});

test('T05-USR-003', async () => {
  const a = await user(), b = await user();
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  assert.equal((await ok('POST', '/users/search', a.token, { email: b.email })).user.id, b.id);
  await ok('PUT', '/users/me/settings', b.token, { discoverable: false });
  const hidden = await ok('POST', '/users/search', a.token, { email: b.email });
  assert.equal(hidden.found, false);
  assert.equal(hidden.user, null);
  assert.equal((await ok('GET', '/users/me', b.token)).id, b.id);
  await ok('PUT', '/users/me/settings', b.token, { discoverable: true });
  assert.equal((await ok('POST', '/users/search', a.token, { email: b.email })).user.id, b.id);
});

test('T05-AVA-001', async () => {
  const a = await user(), model = await avatarModel(a.token);
  assert.equal((await ok('POST', '/auth/login', null, { email: a.email, password })).user.has_avatar, false);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id, customizations: {} }, 201);
  assert.equal((await ok('GET', '/avatars/me', a.token)).model_id, model.id);
  assert.equal((await ok('POST', '/auth/login', null, { email: a.email, password })).user.has_avatar, true);
  assert.equal(sql(`SELECT count(*) FROM avatar_profiles WHERE user_id='${a.id}'`), '1');
});

test('T05-AVA-002', async () => {
  const p = await pair(), model = await avatarModel(p.b.token);
  await ok('PUT', '/avatars/me', p.b.token, { model_id: model.id, customizations: {} }, 201);
  assert.equal((await ok('GET', `/avatars/${p.b.id}`, p.a.token)).model_id, model.id);
  await ok('PUT', '/avatars/me', p.b.token, { model_id: model.id, customizations: { hair_color: '#112233' } });
  const publicAvatar = await ok('GET', `/avatars/${p.b.id}`, p.a.token);
  assert.equal(publicAvatar.user_id, p.b.id);
  assert.equal(publicAvatar.customizations.hair_color, '#112233');
  assert.equal(sql(`SELECT count(*) FROM avatar_profiles WHERE user_id='${p.b.id}'`), '1');
});

test('T05-CON-003', async () => {
  const a = await user(), b = await user(), c = await user();
  const ab = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const bc = await ok('POST', '/conversations', b.token, { other_user_id: c.id }, 201);
  const ids = async owner => new Set((await ok('GET', '/conversations', owner.token)).data.map(x => x.id));
  assert.deepEqual(idsFor(await ids(a)), [ab.id]);
  assert.deepEqual(idsFor(await ids(b)), [ab.id, bc.id].sort());
  assert.deepEqual(idsFor(await ids(c)), [bc.id]);
  await ok('GET', `/conversations/${bc.id}`, a.token, undefined, 403);
});

function idsFor(set) { return [...set].sort(); }

test('T05-VID-001', async () => {
  const a = await user(), v = await preparedVideo(a);
  assert.ok(v.etag1 && v.etag2 && v.etag1 !== v.etag2);
  assert.equal(redis('EXISTS', `video:upload:${v.item.id}`), '1');
  assert.equal(sql(`SELECT status FROM videos WHERE id='${v.item.id}' AND user_id='${a.id}'`), 'recording');
});

test('T05-VID-004', async () => {
  const a = await user(), v = await readyVideo(a), renamed = 'Video T05 renamed';
  const before = await fetch(v.detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(before.status, 200);
  const bytesBefore = Buffer.from(await before.arrayBuffer());
  await ok('PUT', `/videos/${v.item.id}`, a.token, { title: renamed });
  const detail = await ok('GET', `/videos/${v.item.id}`, a.token);
  assert.equal(detail.title, renamed);
  assert.equal((await ok('GET', '/videos', a.token)).data.find(x => x.id === v.item.id)?.title, renamed);
  assert.equal(sql(`SELECT title FROM videos WHERE id='${v.item.id}'`), renamed);
  const after = await fetch(detail.view_url, { signal: AbortSignal.timeout(15000) });
  assert.equal(after.status, 200);
  assert.deepEqual(Buffer.from(await after.arrayBuffer()), bytesBefore);
});

test('T05-VID-012', async () => {
  const a = await user(), b = await user(), v = await readyVideo(b);
  await ok('GET', `/videos/${v.item.id}`, a.token, undefined, 403);
  await ok('DELETE', `/videos/${v.item.id}`, a.token, undefined, 403);
  assert.equal((await ok('GET', `/videos/${v.item.id}`, b.token)).status, 'ready');
  assert.equal(sql(`SELECT deleted_at IS NULL FROM videos WHERE id='${v.item.id}'`), 't');
});

test('T05-DEL-002', async () => {
  const a = await user(), b = await user(), v = await video(a), independent = await video(b);
  await uploadPart(v.first_chunk_url, Buffer.alloc(5 * 1024 * 1024, 0x61));
  await ok('DELETE', '/users/me', a.token, { password }, 204);
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM users WHERE id='${a.id}'`), 't');
  const end = Date.now() + 10_000;
  while (redis('EXISTS', `video:upload:${v.id}`) !== '0' && Date.now() < end) await wait(100);
  assert.equal(redis('EXISTS', `video:upload:${v.id}`), '0');
  assert.equal(sql(`SELECT deleted_at IS NOT NULL FROM videos WHERE id='${v.id}'`), 't');
  assert.equal((await ok('GET', `/videos/${independent.id}`, b.token)).status, 'recording');
});

test('T05-CROSS-001', async t => {
  const a = await user(), b = await user();
  await ok('PUT', '/users/me', a.token, { display_name: 'Onboarded A' });
  const model = await avatarModel(a.token);
  await ok('PUT', '/avatars/me', a.token, { model_id: model.id }, 201);
  const conversation = await ok('POST', '/conversations', a.token, { other_user_id: b.id }, 201);
  const inbox = await messaging(b, t);
  const sent = await message(a, conversation.id, 'First T05 chat');
  assert.equal((await inbox.take('NEW_MESSAGE')).data.id, sent.body.id);
  assert.equal((await ok('GET', `/conversations/${conversation.id}/messages`, b.token)).data.find(x => x.id === sent.body.id)?.content, sent.body.content);
});
