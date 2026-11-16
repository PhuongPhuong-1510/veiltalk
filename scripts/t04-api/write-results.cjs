const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const directory = __dirname;
const resultDir = resolve(directory, 'results/latest');

function writeReport() {
  const spec = readFileSync(resolve(directory, 'VEILTALK_T04_API_CONTRACT_TEST_CASES.md'), 'utf8');
  const ids = [...spec.matchAll(/^\| \*\*([A-Z]+-\d+)\*\*/gm)].map(match => match[1]);
  const xml = readFileSync(resolve(resultDir, 'results.xml'), 'utf8');
  const run = JSON.parse(readFileSync(resolve(resultDir, 'run.json'), 'utf8'));
  const outcomes = new Map();
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const id = /\bname="([A-Z]+-\d+)"/.exec(match[1])?.[1];
    if (id) outcomes.set(id, /\bfailure=/.test(match[1]) || /<failure\b/.test(match[2] ?? '') ? 'FAIL' : 'PASS');
  }
  const passed = ids.filter(id => outcomes.get(id) === 'PASS').length;
  const failed = ids.filter(id => outcomes.get(id) === 'FAIL').length;
  const notRun = ids.length - passed - failed;
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: resolve(directory, '../..'), encoding: 'utf8' }).trim(); } catch {}
  const date = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', dateStyle:'medium', timeStyle:'short' }).format(new Date(run.date));
  const lines = [
    '# T04 API contract test results', '',
    `- Run: \`${run.runId}\``, `- Thời gian (Asia/Bangkok): ${date}`,
    `- Commit nền: \`${commit}\`; source có thể gồm thay đổi chưa commit.`,
    `- Môi trường: ${run.services.join(', ')}; các container có nhãn riêng và đã được dọn sau lượt chạy.`,
    `- Kết quả: **${passed} PASS, ${failed} FAIL, ${notRun} NOT RUN** trên ${ids.length} ID.`,
    '- FAIL được ghi theo kết quả của lượt chạy này; cần xem assertion và log trước khi phân loại nguyên nhân.',
    '',
    '## Case FAIL', '',
    '| ID | Bằng chứng |', '|---|---|',
    ...ids.filter(id => outcomes.get(id) === 'FAIL').map(id => `| ${id} | Xem results.xml và log của lượt chạy này. |`),
    '',
    '## Kết quả từng case', '',
    '| ID | Kết quả |', '|---|---|',
    ...ids.map(id => `| ${id} | ${outcomes.get(id) ?? 'NOT RUN'} |`),
    '',
    '## Bằng chứng và phạm vi', '',
    '- `results/latest/results.xml`: JUnit cho từng ID và assertion thất bại.',
    '- `results/latest/backend.log` và `results/latest/signaling.log`: log dịch vụ của đúng lượt chạy.',
    '- `results/latest/run.json`: run ID, thời gian và exit code.',
    '- Một ID PASS nghĩa là các assertion đã viết cho ID đó PASS trên môi trường cô lập; tài liệu T04 còn các ma trận tham số mở rộng không được tính thành ID riêng.',
    ''
  ];
  writeFileSync(resolve(directory, 'RESULTS.md'), lines.join('\n'), 'utf8');
  return { passed, failed, notRun };
}

if (require.main === module) console.log(writeReport());
module.exports = { writeReport };
