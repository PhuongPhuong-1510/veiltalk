const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const publicBase = process.env.T06_PUBLIC_BASE_URL;
const publicFrontend = process.env.T06_PUBLIC_FRONTEND_URL;
const retentionDays = Number(process.env.T06_LOG_RETENTION_DAYS || 0);
const retentionRoot = process.env.T06_LOG_RETENTION_ROOT;

async function publicFetch(path, options = {}) {
  return fetch(new URL(path, publicBase), { ...options, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
}

test('INT-011 public network cannot directly reach internal service routes',
  { skip: !publicBase && 'Set T06_PUBLIC_BASE_URL to a production-equivalent proxy URL' }, async () => {
  for (const path of ['/internal/call/notify', '/internal/videos/webhook']) {
    const response = await publicFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok([403, 404].includes(response.status), `${path} is reachable publicly: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
});

test('CONFIG-005 public deployment enforces HTTPS',
  { skip: !publicBase && 'Set T06_PUBLIC_BASE_URL to a production-equivalent proxy URL' }, async () => {
  const url = new URL(publicBase);
  assert.equal(url.protocol, 'https:', 'Public test URL is not HTTPS');
  const clear = new URL(url); clear.protocol = 'http:';
  const response = await fetch(clear, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.ok([301, 302, 307, 308, 403].includes(response.status), `Cleartext HTTP was accepted: ${response.status}`);
  if (response.status !== 403) assert.match(response.headers.get('location') ?? '', /^https:/i);
  await response.arrayBuffer();
});

test('CONFIG-006 production HTTPS path preserves required security headers',
  { skip: !publicBase && 'Set T06_PUBLIC_BASE_URL to a production-equivalent proxy URL' }, async () => {
  const response = await publicFetch('/actuator/health');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=\d+/i);
  assert.match(response.headers.get('x-frame-options') ?? '', /DENY|SAMEORIGIN/i);
  await response.arrayBuffer();
});

test('CONFIG-009 release images and public artifacts contain no supplied secret sentinels',
  { skip: !process.env.T06_RELEASE_IMAGES && 'Set T06_RELEASE_IMAGES to comma-separated release image references' }, () => {
  const secrets = (process.env.T06_SECRET_SENTINELS ?? '').split(',').filter(Boolean);
  assert.ok(secrets.length > 0, 'Set T06_SECRET_SENTINELS to non-production sentinel values');
  for (const image of process.env.T06_RELEASE_IMAGES.split(',').map(value => value.trim()).filter(Boolean)) {
    const history = execFileSync('docker', ['history', '--no-trunc', image], { encoding: 'utf8', timeout: 60_000 });
    const inspect = execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8', timeout: 60_000 });
    for (const secret of secrets) {
      assert.equal(history.includes(secret), false, `${image} history contains a secret sentinel`);
      assert.equal(inspect.includes(secret), false, `${image} metadata contains a secret sentinel`);
    }
  }
});

test('CONFIG-011 proxy normalization cannot route encoded public paths into internal APIs',
  { skip: !publicBase && 'Set T06_PUBLIC_BASE_URL to a production-equivalent proxy URL' }, async () => {
  for (const path of ['//internal/call/notify', '/%69nternal/call/notify', '/api/../internal/call/notify']) {
    const response = await publicFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok([400, 403, 404].includes(response.status), `${path}: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
});

test('CONFIG-012 untrusted forwarding headers do not alter public trust decisions',
  { skip: !publicBase && 'Set T06_PUBLIC_BASE_URL to a production-equivalent proxy URL' }, async () => {
  const response = await publicFetch('/internal/call/notify', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1',
      'x-forwarded-proto': 'https', 'x-forwarded-host': 'localhost' }, body: '{}',
  });
  assert.ok([403, 404].includes(response.status), `Spoofed forwarding headers changed access: ${response.status}`);
  await response.arrayBuffer();
});

test('CONFIG-014 deployed frontend sends a restrictive Content Security Policy',
  { skip: !publicFrontend && 'Set T06_PUBLIC_FRONTEND_URL to the deployed frontend URL' }, async () => {
  const response = await fetch(publicFrontend, { signal: AbortSignal.timeout(10_000) });
  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src\s+'self'/i);
  assert.match(csp, /frame-ancestors\s+(?:'none'|'self')/i);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/i);
  await response.arrayBuffer();
});

test('LOG-010 retained logs comply with the configured maximum age',
  { skip: !(retentionDays > 0 && retentionRoot) && 'Set T06_LOG_RETENTION_DAYS and T06_LOG_RETENTION_ROOT from the approved policy' }, () => {
  assert.equal(existsSync(retentionRoot), true, 'Configured log root does not exist');
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const oldFiles = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && statSync(path).mtimeMs < cutoff) oldFiles.push(path);
    }
  };
  visit(retentionRoot);
  assert.deepEqual(oldFiles, [], `Logs exceed ${retentionDays}-day retention: ${oldFiles.join(', ')}`);
});
