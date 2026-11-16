const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const directory = __dirname;
const runName = process.env.T05_RUN_NAME || 'latest';
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runName)) throw new Error('Invalid T05_RUN_NAME');
const resultDir = resolve(directory, 'results', runName);
function writeReport() {
  const spec = readFileSync(resolve(directory, 'VEILTALK_T05_END_TO_END_TEST_CASES.md'), 'utf8');
  const ids = [...spec.matchAll(/^#### (T05-[A-Z]+-\d+)/gm)].map(match => match[1]);
  const xml = readFileSync(resolve(resultDir, 'results.xml'), 'utf8');
  const run = JSON.parse(readFileSync(resolve(resultDir, 'run.json'), 'utf8'));
  const pending = JSON.parse(readFileSync(resolve(directory, 'pending-cases.json'), 'utf8'));
  const outcomes = new Map();
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const id = /\bname="(T05-[A-Z]+-\d+)"/.exec(match[1])?.[1];
    if (id) outcomes.set(id, /<failure\b|<error\b/.test(match[2] ?? '') ? 'FAIL (chưa phân loại)' : 'PASS');
  }
  const unexpected = [...outcomes.keys()].filter(id => !ids.includes(id));
  if (unexpected.length) throw new Error(`Test IDs missing from specification: ${unexpected.join(', ')}`);
  const statusFor = id => outcomes.get(id) ?? pending[id]?.status ?? 'NOT RUN';
  const passed = ids.filter(id => statusFor(id) === 'PASS').length;
  const failed = ids.filter(id => statusFor(id).startsWith('FAIL')).length;
  const needsContract = ids.filter(id => statusFor(id) === 'NEEDS_CONTRACT').length;
  const notRun = ids.filter(id => statusFor(id) === 'NOT RUN').length;
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: resolve(directory, '../..'), encoding: 'utf8' }).trim(); } catch {}
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.date));
  const evidence = `results/${runName}`;
  const lines = [
    '# Kết quả T05 E2E backend', '',
    `- Run: \`${run.runId}\``,
    `- Thời gian (Asia/Bangkok): ${date}`,
    `- Commit nền: \`${commit}\`; source có thể gồm thay đổi chưa commit.`,
    `- Môi trường: ${run.services.join(', ')}; container riêng đã được dọn.`,
    `- Kết quả: **${passed} PASS, ${failed} FAIL, ${needsContract} NEEDS_CONTRACT, ${notRun} NOT RUN** trên ${ids.length} ID.`,
    '- Phạm vi DEL-004: lịch sử và ẩn danh hiển thị trước mốc 30 ngày. Dọn/ẩn danh dữ liệu sau 30 ngày chưa được triển khai và chưa nghiệm thu.',
    '- FAIL cần đối chiếu assertion và log trước khi phân loại FAIL_PRODUCT, FAIL_TEST hay FAIL_ENV.',
    '', '## Kết quả từng case', '', '| ID | Kết quả | Ghi chú |', '|---|---|---|',
    ...ids.map(id => `| ${id} | ${statusFor(id)} | ${outcomes.has(id) ? '' : pending[id]?.reason ?? ''} |`),
    '', '## Bằng chứng', '',
    `- \`${evidence}/results.xml\`: assertion theo từng case đã chạy.`,
    `- \`${evidence}/backend.log\` và \`${evidence}/signaling.log\`: log tiến trình.`,
    `- \`${evidence}/run.json\`: run ID và exit code.`,
    '- `pending-cases.json`: lý do cho case NEEDS_CONTRACT và các kiểm tra runner chưa chạy.',
    '- PASS chỉ áp dụng cho assertion của ID đã chạy; không suy ra độ bao phủ toàn hệ thống.', ''
  ];
  writeFileSync(runName === 'latest' ? resolve(directory, 'RESULTS.md') : resolve(resultDir, 'RESULTS.md'), lines.join('\n'), 'utf8');
  return { passed, failed, needsContract, notRun };
}
if (require.main === module) console.log(writeReport());
module.exports = { writeReport };
