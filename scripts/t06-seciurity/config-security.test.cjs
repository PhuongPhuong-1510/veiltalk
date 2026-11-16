const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');

async function startupWith(overrides) {
  const baseline = JSON.parse(process.env.E2E_BACKEND_START_ENV);
  const child = spawn('java', ['-jar', 'backend/target/backend-0.0.1-SNAPSHOT.jar'], {
    cwd: root, env: { ...process.env, ...baseline, SERVER_PORT: '0', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const timer = setTimeout(() => child.kill(), 30000);
  const code = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', value => done(value));
  });
  clearTimeout(timer);
  return { code, output };
}

test('CONFIG-004 weak internal shared secrets prevent backend startup', async () => {
  for (const [variable, secret] of [
    ['INTERNAL_CALL_NOTIFY_SECRET', 'too-short'],
    ['MINIO_WEBHOOK_SECRET', 'too-short'],
  ]) {
    const result = await startupWith({ [variable]: secret });
    assert.notEqual(result.code, 0, `${variable} unexpectedly started backend`);
    assert.equal(result.output.includes(`${variable} must contain at least 32 UTF-8 bytes`), true,
      `${variable} did not fail for the required policy`);
    assert.equal(result.output.includes(secret), false, 'Startup logs echoed a weak secret');
  }
});
