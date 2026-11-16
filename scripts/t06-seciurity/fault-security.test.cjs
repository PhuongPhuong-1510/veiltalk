const h = require('../t04-api/support.cjs');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const WebSocket = createRequire(resolve(__dirname, '../../signaling/package.json'))('ws');
const { assert, caseTest: test, request, user, wait, base, signalingUrl } = h;

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
}

async function waitForRedis(container) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (docker('exec', container, 'redis-cli', 'ping') === 'PONG') return;
    } catch { /* retry until the disposable Redis is ready */ }
    await wait(250);
  }
  throw new Error('Disposable Redis did not recover after fault injection');
}

async function socketMustNotRemainAuthorized(url, token) {
  const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`,
    { headers: { 'X-Forwarded-For': `10.250.${Math.floor(Math.random() * 200) + 1}.1` } });
  socket.on('error', () => {});
  const outcome = await new Promise(resolveOutcome => {
    const timer = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
      resolveOutcome({ openedAndStayedOpen: socket.readyState === WebSocket.OPEN });
    }, 2500);
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer); response.resume(); resolveOutcome({ status: response.statusCode });
    });
    socket.once('close', code => {
      clearTimeout(timer); resolveOutcome({ closeCode: code });
    });
  });
  assert.notEqual(outcome.openedAndStayedOpen, true,
    `Security dependency failure left ${url} authorized`);
}

test('CROSS-010 authentication and realtime channels fail closed while Redis is unavailable', async () => {
  const redis = process.env.E2E_REDIS_CONTAINER;
  assert.match(redis ?? '', /^veiltalk-e2e-/);
  const a = await user();
  // The runner owns --rm containers, so stopping Redis would delete the fixture.
  // Pausing simulates an unavailable dependency while preserving the exact data
  // and container identity for recovery after this isolated fault window.
  docker('pause', redis);
  try {
    const protectedResponse = await request('GET', '/users/me', a.token,
      undefined, { timeout: 8000 });
    assert.notEqual(protectedResponse.status, 200,
      'Protected HTTP request was authorized while revocation state was unavailable');
    await socketMustNotRemainAuthorized(base.replace(/^http/, 'ws') + '/ws/messaging', a.token);
    await socketMustNotRemainAuthorized(signalingUrl, a.token);
  } finally {
    docker('unpause', redis);
    await waitForRedis(redis);
    await wait(1000);
  }
  const recovered = await request('GET', '/users/me', a.token, undefined, { timeout: 8000 });
  assert.equal(recovered.status, 200, 'Backend did not recover after disposable Redis restarted');
});
