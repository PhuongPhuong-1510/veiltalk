'use strict';
// Shared T04 helpers are intentionally not changed by T07.
const h = require('../t04-api/support.cjs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function sameElements(actual, expected, label) {
  h.assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}
function parallel(factory, count) {
  // Client start gate only. Does NOT prove overlap inside server critical section.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tasks = Array.from({length: count}, (_, i) => (async () => { await gate; return factory(i); })());
  const start = process.hrtime.bigint();
  release();
  return Promise.all(tasks).then(responses => ({responses, dispatchNs: String(start),
    finishNs: String(process.hrtime.bigint())}));
}
function countEvents(socket, type, id) {
  return socket.events.filter(event => event.type === type && (id === undefined || event.data?.id === id)).length;
}
async function noMoreEvents(socket, type, id, duration = 600) {
  await h.wait(duration);
  h.assert.equal(countEvents(socket, type, id), 0,
    `Observed duplicate ${type} for ${id} during ${duration}ms observation window`);
}
function dbMessage(id) {
  const value = h.sql(`SELECT conversation_id || '|' || sender_id || '|' || status FROM messages WHERE id='${id}'`);
  h.assert.ok(value, `Expected persisted message id=${id}`);
  return value.split('|');
}
function pairCount(a, b) {
  return Number(h.sql(`SELECT count(*) FROM conversations WHERE deleted_at IS NULL AND
   ((user_a_id='${a}' AND user_b_id='${b}') OR (user_a_id='${b}' AND user_b_id='${a}'))`));
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
class NoPongSocket extends h.Socket {
  send(event) {
    if (event?.type !== 'PONG') super.send(event);
  }
}
function ownedContainerAction(container,action) {
  h.assert.match(container??'',/^veiltalk-e2e-[a-z0-9-]+-(?:postgres|redis|minio)$/);
  const label=execFileSync('docker',['inspect','-f','{{index .Config.Labels "veiltalk.e2e"}}',container],
    {encoding:'utf8',timeout:10000}).trim();
  h.assert.ok(label&&container.startsWith(`${label}-`),'Refusing to control a container not owned by this T07 run');
  execFileSync('docker',[action,container],{encoding:'utf8',timeout:15000});
}
async function withPausedContainer(container,work) {
  ownedContainerAction(container,'pause');
  try { return await work(); }
  finally { ownedContainerAction(container,'unpause'); }
}
module.exports = { ...h, sameElements, parallel, countEvents, noMoreEvents, dbMessage, pairCount, hash,
  NoPongSocket, ownedContainerAction, withPausedContainer };
