const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function writeReport(reportDir = resolve(__dirname, 'results/latest')) {
  const spec = readFileSync(resolve(__dirname, 'VEILTALK_T06_SECURITY_TEST_CASES.md'), 'utf8');
  const xml = readFileSync(resolve(reportDir, 'results.xml'), 'utf8');
  const run = JSON.parse(readFileSync(resolve(reportDir, 'run.json'), 'utf8'));
  const cases = [...spec.matchAll(/^#### ([A-Z]+-\d{3}) — (.+?) \[(P[012])\]$/gm)]
    .map(([, id, title, priority]) => ({ id, title, priority }));
  const tests = [...xml.matchAll(/<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)]
    .map(match => {
      const attributes = match[1] ?? match[2] ?? '';
      const name = attributes.match(/\bname="([^"]+)"/)?.[1];
      if (!name) throw new Error('JUnit testcase is missing its name attribute');
      const body = match[3] ?? '';
      return { name, skipped: /<skipped\b/.test(body),
        passed: !/<failure\b|<error\b/.test(body) };
    });
  const needsContract = require('./needs-contract.cjs');
  const notApplicable = require('./not-applicable.cjs');
  const observed = new Map();
  for (const entry of tests) {
    if (entry.skipped) continue;
    for (const id of entry.name.match(/\b[A-Z]+-\d{3}\b/g) ?? []) {
      if (observed.has(id)) throw new Error(`Duplicate T06 case ID: ${id}`);
      observed.set(id, entry.passed ? 'PASS' : 'REVIEW_REQUIRED');
    }
  }
  if (cases.length !== 206) throw new Error(`Expected 206 T06 cases, found ${cases.length}`);
  const known = new Set(cases.map(item => item.id));
  for (const id of observed.keys()) if (!known.has(id)) throw new Error(`Unknown T06 case ID: ${id}`);
  const status = id => observed.get(id) ?? (needsContract.has(id) ? 'NEEDS_CONTRACT' : notApplicable.has(id) ? 'N/A' : 'NOT RUN');
  const count = value => cases.filter(item => status(item.id) === value).length;
  const lines = [
    '# T06 Security test results', '',
    `- Run ID: ${run.runId}`,
    `- Time (UTC): ${run.date}`,
    `- Stack: ${run.services.join(', ')}`,
    `- Test executions: ${tests.length}; case IDs PASS: ${count('PASS')}; REVIEW_REQUIRED: ${count('REVIEW_REQUIRED')}; NEEDS_CONTRACT: ${count('NEEDS_CONTRACT')}; N/A: ${count('N/A')}; NOT RUN: ${count('NOT RUN')}`,
    '- BOLA-009 contract decision (owner, 2026-10-19): nonowner GET /videos/{id} must be denied entirely.',
    '- ABUSE-006/007, WSM-014 and LOG-010 policies were confirmed on 2026-10-19. A case remains NOT RUN until tested; LOG-010 requires production log retention verification.',
    ...[...needsContract].map(([id, reason]) => `- ${id} NEEDS_CONTRACT: ${reason}`),
    ...[...notApplicable].map(([id, reason]) => `- ${id} N/A: ${reason}`),
    '- PASS applies only to rows marked PASS. This run does not establish T06 acceptance or system-wide security coverage.',
    '', '| Case | Priority | Status | Scenario |', '|---|---|---|---|',
    ...cases.map(item => `| ${item.id} | ${item.priority} | ${status(item.id)} | ${item.title.replaceAll('|', '\\|')} |`),
    '',
  ];
  writeFileSync(resolve(reportDir, 'RESULTS.md'), lines.join('\n'));
  return { executions: tests.length, pass: count('PASS'), review: count('REVIEW_REQUIRED'), needsContract: count('NEEDS_CONTRACT'), notApplicable: count('N/A'), notRun: count('NOT RUN') };
}

if (require.main === module) console.log(writeReport());
module.exports = { writeReport };
