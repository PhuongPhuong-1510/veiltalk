// Read-only source inventory for this review. Indexing is not a claim that every line was audited.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const xrRoot = 'C:/project/SystemAnimatorOnline';
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(file);
  }
}
for (const dir of ['frontend/src/lib/avatar-motion', 'frontend/src/lib/avatar-renderer', 'frontend/src/lib/tracking']) {
  walk(path.join(root, dir));
}
for (const file of ['frontend/src/App.tsx', 'frontend/src/components/dev/AvatarRendererDevHarness.tsx', 'frontend/src/components/avatar/AvatarCanvas.tsx']) {
  files.push(path.join(root, file));
}
function indexFile(file, base, project) {
  const bytes = fs.readFileSync(file);
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const declarations = [];
  const imports = [];
  lines.forEach((line, index) => {
    if (/^\s*export\s+(?:(?:default|async|declare|abstract)\s+)?(?:function|class|interface|type|const|enum)\b/.test(line)) {
      declarations.push({ line: index + 1, text: line.trim() });
    }
    if (/\bfrom\s+["']|^\s*import\s+["']/.test(line)) imports.push({ line: index + 1, text: line.trim() });
  });
  return { project, path: path.relative(base, file).replaceAll('\\', '/'), bytes: bytes.length,
    lines: lines.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    test: /\.test\./.test(file), indexingMeaning: 'inventory only; audit coverage is described in the review', declarations, imports };
}
const xrFiles = ['js/mocap_lib_module.js', 'js/SA_system_emulation.readable.js', 'jThree/MMDplugin/v2.1.2_jThree.MMD.js',
  'js/one_euro_filter.js', 'jThree/index.js', 'MMD.js/MMD_SA.js', 'images/XR Animator/animate.js', 'js/core_extra.js'];
const sourceFiles = files.sort().map(file => indexFile(file, root, 'VeilTalk'))
  .concat(xrFiles.map(file => indexFile(path.join(xrRoot, file), xrRoot, 'XR')));
const head = base => cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim();
const manifest = { createdAt: new Date().toISOString(), veilTalkHead: head(root), xrHead: head(xrRoot),
  auditReport: '../XR_VEILTALK_MOTION_REVIEW.vi.md',
  caveat: 'Hashes and declaration inventory do not imply full manual review. See report for reviewed scope and limitations.',
  verification: { frontendBuild: 'PASS', fullFrontendTests: { passed: 906, failed: 8, total: 914, filesPassed: 105, filesFailed: 2 },
    failedFileRerun: { passed: 85, failed: 8, total: 93 }, webcamBenchmark: 'NOT RUN' }, sourceFiles };
fs.writeFileSync(path.join(__dirname, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const md = ['# Source inventory — XR / VeilTalk motion review', '',
  'Đây là index tự động, không phải tuyên bố đã đọc từng dòng mọi file. Phạm vi khảo sát và kết luận ở [báo cáo](../XR_VEILTALK_MOTION_REVIEW.vi.md).', '',
  '| Project | File | Lines | Bytes | Kind |', '|---|---|---:|---:|---|'];
for (const file of sourceFiles) md.push(`| ${file.project} | ${file.path} | ${file.lines} | ${file.bytes} | ${file.test ? 'test' : 'source'} |`);
md.push('', 'SHA-256 và imports/exports nằm trong `source-manifest.json`. Tạo lại bằng `node docs/motion-review/build-index.cjs` từ VeilTalk root.', '');
fs.writeFileSync(path.join(__dirname, 'SOURCE-INDEX.md'), md.join('\n'));
for (const [source, target] of [['veiltalk-motion-review-tests.txt', 'failed-tests.log'], ['veiltalk-motion-review-build.txt', 'build.log']]) {
  const file = path.join(process.env.TEMP || process.env.TMP || '.', source);
  if (fs.existsSync(file)) fs.writeFileSync(path.join(__dirname, target), fs.readFileSync(file, 'utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''));
}
console.log(JSON.stringify({ indexedFiles: sourceFiles.length, veilTalkSourceFiles: sourceFiles.filter(f => f.project === 'VeilTalk' && !f.test).length,
  veilTalkTestFiles: sourceFiles.filter(f => f.project === 'VeilTalk' && f.test).length, xrFiles: xrFiles.length }));
