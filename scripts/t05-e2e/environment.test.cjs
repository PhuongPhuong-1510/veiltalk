const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('../t04-api/support.cjs');
const { assert, caseTest: test, user, sql, redis, messaging, signaling } = h;

test('T05-ENV-001', async t => {
  const runId = process.env.E2E_PG_CONTAINER?.replace(/-postgres$/, '');
  assert.match(runId ?? '', /^veiltalk-e2e-\d+-[a-f0-9]+$/);
  const label = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "veiltalk.e2e"}}', process.env.E2E_PG_CONTAINER], { encoding: 'utf8' }).trim();
  assert.equal(label, runId);
  assert.equal(sql('SELECT 1'), '1');
  assert.equal(redis('PING'), 'PONG');
  const health = await fetch(`${h.base}/actuator/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'UP');
  const a = await user(), messenger = await messaging(a, t), signal = await signaling(a, t);
  assert.equal(messenger.seenPing, true);
  assert.equal(signal.ws.readyState, 1);
  const result = process.env.E2E_RESULT_DIR || resolve(__dirname, 'results/latest');
  for (const name of ['build.log', 'backend.log', 'signaling.log']) assert.equal(existsSync(resolve(result, name)), true);
});

if (process.env.T05_PROBE_FAILURE === '1') {
  test('T05-ENV-005', async () => {
    assert.fail('Intentional T05 runner failure probe');
  });
} else {
  test('T05-ENV-005', async () => {
    const probe = resolve(__dirname, 'results/probe-env-005');
    const metadata = JSON.parse(readFileSync(resolve(probe, 'run.json'), 'utf8'));
    const junit = readFileSync(resolve(probe, 'results.xml'), 'utf8');
    assert.notEqual(metadata.exitCode, 0);
    assert.equal(metadata.cleanup?.verified, true);
    assert.match(junit, /T05-ENV-005/);
    assert.match(junit, /<failure\b/);
    assert.match(junit, /Intentional T05 runner failure probe/);
    for (const name of ['build.log', 'backend.log', 'signaling.log']) {
      assert.equal(existsSync(resolve(probe, name)), true);
    }
    const owned = execFileSync('docker', ['ps', '-aq', '--filter', `label=veiltalk.e2e=${metadata.runId}`], { encoding: 'utf8' }).trim();
    assert.equal(owned, '');
  });
}

if (process.env.T05_PREVIOUS_RUN_NAME) {
  test('T05-ENV-003', async () => {
    const name = process.env.T05_PREVIOUS_RUN_NAME;
    assert.match(name, /^[a-z0-9][a-z0-9-]{0,63}$/);
    const prior = resolve(__dirname, 'results', name);
    const metadata = JSON.parse(readFileSync(resolve(prior, 'run.json'), 'utf8'));
    const junit = readFileSync(resolve(prior, 'results.xml'), 'utf8');
    const currentRunId = process.env.E2E_PG_CONTAINER.replace(/-postgres$/, '');
    assert.equal(metadata.exitCode, 0);
    assert.notEqual(metadata.runId, currentRunId);
    assert.match(junit, /T05-ENV-001/);
    assert.equal(metadata.cleanup?.verified, true);
    assert.equal(sql(`SELECT count(*) FROM e2e_run_markers WHERE marker='${metadata.runId}'`), '0');
    assert.equal(sql(`SELECT count(*) FROM e2e_run_markers WHERE marker='${currentRunId}'`), '1');
    const owned = execFileSync('docker', ['ps', '-aq', '--filter', `label=veiltalk.e2e=${metadata.runId}`], { encoding: 'utf8' }).trim();
    assert.equal(owned, '');
  });
}
