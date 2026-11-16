const { spawnSync, execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');

const root = resolve(__dirname, '../..');
const output = resolve(__dirname, 'results/supply');
mkdirSync(output, { recursive: true });
const runId = `veiltalk-supply-${Date.now()}-${randomBytes(3).toString('hex')}`;
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
  ...(process.env.T06_SUPPLY_PATTERN ? [`--test-name-pattern=${process.env.T06_SUPPLY_PATTERN}`] : []),
  '--test-reporter=junit', `--test-reporter-destination=${resolve(output, 'results.xml')}`,
  'scripts/t06-seciurity/supply.test.cjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
let revision = null;
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* unversioned source */ }
writeFileSync(resolve(output, 'run.json'), JSON.stringify({ runId, date: new Date().toISOString(),
  exitCode: result.status ?? 1, revision, services: ['npm registry audit of signaling production dependencies'] }, null, 2));
process.exitCode = result.status ?? 1;
