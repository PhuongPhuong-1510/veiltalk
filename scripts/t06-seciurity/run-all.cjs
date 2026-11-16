const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');

function run(label, script, extraEnv = {}, allowTestFailures = false) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowTestFailures) throw new Error(`${label} failed with exit code ${result.status}`);
  if (result.status !== 0) process.stdout.write(`${label}: test findings recorded (exit ${result.status})\n`);
}

try {
  run('T06 main security pack', 'scripts/t06-seciurity/run.cjs');
  run('T06 auth abuse policy', 'scripts/t06-seciurity/run.cjs', { T06_ABUSE_MODE: '1' });
  run('T06 actual-byte quota boundary', 'scripts/t06-seciurity/run.cjs', { T06_QUOTA_MODE: '1' });
  run('T06 multipart admission and cleanup', 'scripts/t06-seciurity/run.cjs', { T06_MULTIPART_MODE: '1' });
  run('T06 presigned URL expiry', 'scripts/t06-seciurity/run.cjs', { T06_EXPIRY_MODE: '1' });
  run('T06 remaining local and deployment gates', 'scripts/t06-seciurity/run.cjs',
    { T06_REMAINING_MODE: '1' }, true);
  run('T06 supply-chain checks', 'scripts/t06-seciurity/run-supply.cjs', {}, true);
  run('T06 combined report', 'scripts/t06-seciurity/write-combined.cjs');
  process.stdout.write('\nT06 complete: scripts/t06-seciurity/results/RESULTS.md\n');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
