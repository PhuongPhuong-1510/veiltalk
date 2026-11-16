const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '../..');
const packageDir = resolve(root, 'signaling');
const evidenceDir = resolve(__dirname, 'results/supply');
const backendDir = resolve(root, 'backend');
mkdirSync(evidenceDir, { recursive: true });

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runMaven(args, options = {}) {
  if (process.platform !== 'win32') {
    return execFileSync('mvn', args, { cwd: backendDir, encoding: 'utf8', ...options });
  }
  assert.ok(args.every(value => !/[\s&|<>^"]/u.test(String(value))),
    'Unsafe Maven command argument in the supply runner');
  return execFileSync('cmd.exe', ['/d', '/s', '/c', `mvn.cmd ${args.join(' ')}`],
    { cwd: backendDir, encoding: 'utf8', ...options });
}

test('SUPPLY-001 Java dependency SCA has no unaccepted High or Critical finding',
  { timeout: 20 * 60 * 1000, skip: !process.env.NVD_API_KEY && 'Set NVD_API_KEY to run the Java SCA gate' }, () => {
  const reportPath = resolve(evidenceDir, 'dependency-check-report.json');
  const args = [
    'org.owasp:dependency-check-maven:13.0.0:check',
    '-DskipTests', '-Dformat=JSON', '-DfailBuildOnCVSS=11',
    `-DoutputDirectory=${evidenceDir}`,
  ];
  args.push('-DnvdApiKeyEnvironmentVariable=NVD_API_KEY');
  runMaven(args, { timeout: 19 * 60 * 1000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NVD_API_KEY: process.env.NVD_API_KEY ?? '' } });
  assert.equal(existsSync(reportPath), true, 'Dependency-Check did not produce its JSON report');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const severe = (report.dependencies ?? []).flatMap(dependency =>
    (dependency.vulnerabilities ?? []).filter(item => {
      const cvss = item.cvssv4?.baseScore ?? item.cvssv3?.baseScore ?? item.cvssv2?.score ?? 0;
      return cvss >= 7;
    }).map(item => ({ dependency: dependency.fileName, name: item.name })));
  writeFileSync(resolve(evidenceDir, 'java-audit-summary.json'), JSON.stringify({
    caseId: 'SUPPLY-001', checkedAt: new Date().toISOString(),
    dependencyCount: (report.dependencies ?? []).length,
    highOrCriticalCount: severe.length,
    findings: severe,
  }, null, 2));
  assert.equal(severe.length, 0,
    `${severe.length} Java High/Critical finding(s) require remediation or accepted-risk evidence`);
});

test('SUPPLY-002 signaling production dependency audit has no High or Critical advisory', () => {
  let output;
  try {
    output = execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd audit --omit=dev --json'] : ['audit', '--omit=dev', '--json'],
      { cwd: packageDir, encoding: 'utf8', timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
  } catch (error) {
    output = error.stdout?.toString();
    if (!output) throw new Error(`npm audit unavailable: ${error.message}`);
  }
  const audit = JSON.parse(output);
  assert.equal(audit.auditReportVersion, 2, 'npm audit did not return a valid report');
  const severity = audit.metadata?.vulnerabilities;
  assert.ok(severity && Number.isInteger(severity.high) && Number.isInteger(severity.critical));
  const lock = readFileSync(resolve(packageDir, 'package-lock.json'));
  const evidence = {
    caseId: 'SUPPLY-002',
    checkedAt: new Date().toISOString(),
    packageLockSha256: createHash('sha256').update(lock).digest('hex'),
    productionDependencies: audit.metadata.dependencies?.prod,
    vulnerabilities: severity,
  };
  writeFileSync(resolve(evidenceDir, 'audit-summary.json'), JSON.stringify(evidence, null, 2));
  assert.equal(severity.high, 0, 'High severity advisory requires remediation or accepted-risk evidence');
  assert.equal(severity.critical, 0, 'Critical severity advisory requires remediation or accepted-risk evidence');
});

test('SUPPLY-003 dependency manifests and resolved graphs are stable', { timeout: 180000 }, () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'veiltalk-supply-'));
  try {
    const first = resolve(temp, 'tree-1.json');
    const second = resolve(temp, 'tree-2.json');
    for (const output of [first, second]) {
      runMaven(['org.apache.maven.plugins:maven-dependency-plugin:3.9.0:tree',
        '-DoutputType=json', `-DoutputFile=${output}`], { timeout: 90000 });
    }
    const firstTree = readFileSync(first, 'utf8');
    const secondTree = readFileSync(second, 'utf8');
    assert.equal(firstTree, secondTree, 'Maven resolved a different dependency graph on the second run');
    for (const directory of ['frontend', 'signaling']) {
      const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(resolve(root, directory, 'package-lock.json'), 'utf8'));
      assert.ok(lock.lockfileVersion >= 2, `${directory} package-lock.json is not a modern lockfile`);
      assert.equal(lock.packages?.['']?.name, manifest.name);
    }
    writeFileSync(resolve(evidenceDir, 'dependency-lock-summary.json'), JSON.stringify({
      caseId: 'SUPPLY-003', checkedAt: new Date().toISOString(),
      pomSha256: sha256(readFileSync(resolve(backendDir, 'pom.xml'))),
      mavenTreeSha256: sha256(firstTree),
      frontendLockSha256: sha256(readFileSync(resolve(root, 'frontend/package-lock.json'))),
      signalingLockSha256: sha256(readFileSync(resolve(root, 'signaling/package-lock.json'))),
    }, null, 2));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('SUPPLY-004 release container images are pinned and pass the High Critical CVE gate',
  { timeout: 15 * 60 * 1000 }, () => {
    const manifests = ['docker-compose.yml', 'backend/Dockerfile',
      'frontend/Dockerfile', 'signaling/Dockerfile'];
    const imageReferences = [];
    for (const relative of manifests) {
      const path = resolve(root, relative);
      assert.equal(existsSync(path), true, `${relative} is missing; release image provenance is incomplete`);
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/^\s*(?:image:\s*|FROM\s+)([^\s#]+)/gmi)) {
        const reference = match[1];
        imageReferences.push({ relative, reference });
        assert.match(reference, /@sha256:[a-f0-9]{64}$/i,
          `${relative} image is not pinned by immutable sha256 digest: ${reference}`);
        assert.doesNotMatch(reference, /:latest(?:@|$)/i, `${relative} uses a latest tag`);
      }
    }
    assert.ok(imageReferences.length > 0, 'No release image references were discovered');

    const scannerImage = process.env.T06_TRIVY_IMAGE;
    assert.match(scannerImage ?? '', /@sha256:[a-f0-9]{64}$/i,
      'Set T06_TRIVY_IMAGE to an approved Trivy image pinned by sha256 digest');
    const uniqueImages = [...new Set(imageReferences.map(item => item.reference))];
    const scans = [];
    for (const image of uniqueImages) {
      const result = spawnSync('docker', ['run', '--rm', scannerImage, 'image',
        '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--ignore-unfixed',
        '--exit-code', '42', '--format', 'json', image], {
        cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 30 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      assert.notEqual(result.status, 42, `${image} has unaccepted High/Critical CVEs`);
      assert.equal(result.status, 0, `Trivy could not scan ${image}: ${result.stderr}`);
      scans.push({ image, reportSha256: sha256(result.stdout) });
    }
    writeFileSync(resolve(evidenceDir, 'container-scan-summary.json'), JSON.stringify({
      caseId: 'SUPPLY-004', checkedAt: new Date().toISOString(), scannerImage, scans,
    }, null, 2));
  });

test('SUPPLY-005 git history contains no detected secret or private key', { timeout: 5 * 60 * 1000 }, () => {
  const image = 'ghcr.io/gitleaks/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9';
  const mount = `${root}:/repo:ro`;
  const evidenceMount = `${evidenceDir}:/evidence`;
  const reportPath = resolve(evidenceDir, 'gitleaks-report.json');
  const result = spawnSync('docker', ['run', '--rm', '-v', mount, '-v', evidenceMount, image,
    'git', '/repo', '--config', '/repo/scripts/t06-seciurity/gitleaks.toml',
    '--no-banner', '--redact', '--report-format', 'json',
    '--report-path', '/evidence/gitleaks-report.json', '--exit-code', '42'],
  { cwd: root, encoding: 'utf8', timeout: 4 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  const findings = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
  writeFileSync(resolve(evidenceDir, 'secret-scan-summary.json'), JSON.stringify({
    caseId: 'SUPPLY-005', checkedAt: new Date().toISOString(), scannerImage: image,
    clean: result.status === 0, findingCount: findings.length,
    findings: findings.map(item => ({ ruleId: item.RuleID, file: item.File, commit: item.Commit })),
  }, null, 2));
  assert.notEqual(result.status, 42,
    'Gitleaks detected credential material in Git history; inspect locally and rotate any real secret');
  assert.equal(result.status, 0, 'Gitleaks could not complete the Git-history scan');
});

test('SUPPLY-007 build manifests do not download and execute uncontrolled scripts', () => {
  const candidates = [
    'backend/pom.xml', 'frontend/package.json', 'signaling/package.json',
    'signaling/Dockerfile', 'docker-compose.yml',
  ];
  const forbidden = [
    /(?:curl|wget)[^\r\n|]*\|\s*(?:sh|bash)/i,
    /Invoke-(?:Expression|WebRequest)[^\r\n]*(?:iex|Invoke-Expression)/i,
    /powershell[^\r\n]*(?:-enc|-encodedcommand)/i,
    /(?:preinstall|postinstall)"\s*:\s*"[^"]*(?:curl|wget|powershell|node\s+-e)/i,
  ];
  for (const relative of candidates) {
    if (!existsSync(resolve(root, relative))) continue;
    const source = readFileSync(resolve(root, relative), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relative} downloads or executes an uncontrolled build script`);
    }
  }
});

test('SUPPLY-008 backend and signaling SBOMs are generated and tied to the revision',
  { timeout: 5 * 60 * 1000 }, () => {
    runMaven(['org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom',
      '-DoutputFormat=json', '-DoutputName=veiltalk-backend-sbom',
      '-Dcyclonedx.skipAttach=true'], { timeout: 180000 });
    const backendSbomPath = resolve(backendDir, 'target/veiltalk-backend-sbom.json');
    assert.equal(existsSync(backendSbomPath), true, 'Backend CycloneDX SBOM was not generated');
    const backendSbom = JSON.parse(readFileSync(backendSbomPath, 'utf8'));

    const npmResult = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd sbom --omit=dev --sbom-format cyclonedx'],
        { cwd: packageDir, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
      : spawnSync('npm', ['sbom', '--omit=dev', '--sbom-format', 'cyclonedx'],
      { cwd: packageDir, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024,
      });
    assert.equal(npmResult.status, 0, 'npm could not generate the signaling SBOM');
    const signalingSbom = JSON.parse(npmResult.stdout);
    for (const [name, bom] of [['backend', backendSbom], ['signaling', signalingSbom]]) {
      assert.match(bom.bomFormat ?? '', /CycloneDX/i, `${name} SBOM is not CycloneDX`);
      assert.ok((bom.components ?? []).length > 0, `${name} SBOM has no dependency components`);
    }
    let revision = null;
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { /* evidence still records null in an unversioned source tree */ }
    writeFileSync(resolve(evidenceDir, 'backend-sbom.json'), JSON.stringify({ revision, bom: backendSbom }, null, 2));
    writeFileSync(resolve(evidenceDir, 'signaling-sbom.json'), JSON.stringify({ revision, bom: signalingSbom }, null, 2));
  });
