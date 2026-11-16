const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const needsContract = require('./needs-contract.cjs');
const notApplicable = require('./not-applicable.cjs');

const root = __dirname;
const spec = readFileSync(resolve(root, 'VEILTALK_T06_SECURITY_TEST_CASES.md'), 'utf8');
const cases = [...spec.matchAll(/^#### ([A-Z]+-\d{3}) — (.+?) \[(P[012])\]$/gm)]
  .map(([, id, title, priority]) => ({ id, title, priority }));
if (cases.length !== 206) throw new Error(`Expected 206 cases, found ${cases.length}`);
const outcomes = new Map();
const runs = [];
for (const runName of ['latest', 'abuse', 'quota', 'multipart', 'expiry', 'remaining', 'supply']) {
  const dir = resolve(root, 'results', runName);
  const run = JSON.parse(readFileSync(resolve(dir, 'run.json'), 'utf8'));
  if (run.setupError) throw new Error(`Cannot combine setup-failed run ${runName}: ${run.setupError}`);
  const xml = readFileSync(resolve(dir, 'results.xml'), 'utf8');
  runs.push({ name: runName, runId: run.runId, exitCode: run.exitCode });
  for (const match of xml.matchAll(/<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
    const attributes = match[1] ?? match[2] ?? '';
    const testName = attributes.match(/\bname="([^"]+)"/)?.[1];
    if (!testName) throw new Error(`JUnit testcase in ${runName} is missing its name attribute`);
    const body = match[3] ?? '';
    if (/<skipped\b/.test(body)) continue;
    const status = /<failure\b|<error\b/.test(body) ? 'REVIEW_REQUIRED' : 'PASS';
    for (const id of testName.match(/\b[A-Z]+-\d{3}\b/g) ?? []) {
      if (outcomes.has(id)) throw new Error(`Duplicate case across runs: ${id}`);
      outcomes.set(id, { status, run: runName });
    }
  }
}
const known = new Set(cases.map(item => item.id));
for (const id of outcomes.keys()) if (!known.has(id)) throw new Error(`Unknown case ${id}`);
const pass = cases.filter(item => outcomes.get(item.id)?.status === 'PASS').length;
const review = cases.filter(item => outcomes.get(item.id)?.status === 'REVIEW_REQUIRED').length;
const needs = cases.filter(item => !outcomes.has(item.id) && needsContract.has(item.id)).length;
const na = cases.filter(item => !outcomes.has(item.id) && notApplicable.has(item.id)).length;
const lines = [
  '# T06 combined status', '',
  ...runs.map(run => `- ${run.name}: ${run.runId}, exit ${run.exitCode}`),
  `- 206 case IDs: ${pass} PASS, ${review} REVIEW_REQUIRED, ${needs} NEEDS_CONTRACT, ${na} N/A, ${206 - pass - review - needs - na} NOT RUN.`,
  '- PASS covers only the tested assertions. LOG-010 retention remains NOT RUN pending verification on the production-equivalent host.',
  '- CONFIG-003 is REVIEW_REQUIRED: docker-compose.yml publishes PostgreSQL 5432, Redis 6379, and MinIO 9000/9001 on all host interfaces.',
  '- VID-017 is REVIEW_REQUIRED: the compensation regression test confirms a Redis session failure does not abort the MinIO multipart created earlier.',
  ...[...needsContract].filter(([id]) => !outcomes.has(id)).map(([id, reason]) => `- ${id} NEEDS_CONTRACT: ${reason}`),
  ...[...notApplicable].filter(([id]) => !outcomes.has(id)).map(([id, reason]) => `- ${id} N/A: ${reason}`),
  '', '| Case | Priority | Status | Run | Scenario |', '|---|---|---|---|---|',
  ...cases.map(item => {
    const result = outcomes.get(item.id);
    return `| ${item.id} | ${item.priority} | ${result?.status ?? (needsContract.has(item.id) ? 'NEEDS_CONTRACT' : notApplicable.has(item.id) ? 'N/A' : 'NOT RUN')} | ${result?.run ?? ''} | ${item.title.replaceAll('|', '\\|')} |`;
  }), '',
];
writeFileSync(resolve(root, 'results/RESULTS.md'), lines.join('\n'));
console.log({ pass, review, needsContract: needs, notApplicable: na, notRun: 206 - pass - review - needs - na });
