/**
 * The gate command: the part of the six-gate discipline that does not depend
 * on a model choosing to follow it.
 *
 * A finding that lacks the evidence its verdict claims, or whose gates
 * contradict its verdict, is downgraded to an observation with a process exit
 * code behind it. --verify goes further and re-runs the reproduce command.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseGateReport, parseEvidence, validateFindings, splitCommand, verifyFinding, GATE_NAMES } from '../src/gate.js';
import { EXIT } from '../src/cli.js';
import { makeRepo, commitFiles } from './helpers.js';

const TP = [
  'BUG #1 TRUE POSITIVE — 命令注入：数据集名拼进 exec',
  '  门禁全部通过。证据：src/archive.js:42 (abc1234)',
  '  复现：node bench/exploits.js p3',
  '  可利用性：EASY',
  '  影响：以服务账号执行任意命令',
  ''
].join('\n');

const FP = [
  'BUG #2 FALSE POSITIVE — 整数下溢',
  '  门禁 5（数学边界）FAIL：第 98 行校验保证 packet_size >= 16，下溢在数学上不可能',
  ''
].join('\n');

const INCONCLUSIVE = [
  'BUG #3 INCONCLUSIVE — 依赖是否被利用无法判定',
  '  门禁 6（环境）未评估：生产环境是否为该依赖版本未知',
  ''
].join('\n');

const VALID_REPORT = `${TP}\n${FP}\n${INCONCLUSIVE}\n`;

describe('parseGateReport', () => {
  test('parses a report with all three verdict shapes', () => {
    const { findings, unparseable } = parseGateReport(VALID_REPORT);
    assert.equal(findings.length, 3);
    assert.equal(unparseable.length, 0);

    assert.equal(findings[0].number, 1);
    assert.equal(findings[0].verdict, 'TRUE POSITIVE');
    assert.match(findings[0].claim, /命令注入/);
    assert.ok(findings[0].allPass);
    assert.equal(findings[0].evidence.line, 42);
    assert.equal(findings[0].evidence.file, 'src/archive.js');
    assert.equal(findings[0].evidence.commit, 'abc1234');
    assert.equal(findings[0].reproduce, 'node bench/exploits.js p3');
    assert.equal(findings[0].impact, '以服务账号执行任意命令');

    assert.equal(findings[1].verdict, 'FALSE POSITIVE');
    assert.equal(findings[1].gates.length, 1);
    assert.equal(findings[1].gates[0].number, 5);
    assert.equal(findings[1].gates[0].status, 'FAIL');
    assert.match(findings[1].gates[0].reason, /packet_size/);

    assert.equal(findings[2].verdict, 'INCONCLUSIVE');
    assert.equal(findings[2].gates[0].status, '未评估');
  });

  test('tolerates a hyphen instead of the em dash and per-gate PASS lines', () => {
    const text = [
      'BUG 7 TRUE POSITIVE - X',
      '  门禁 1（流程）PASS：完整走过',
      '  门禁 2（可达性）PASS：攻击者可控',
      '  门禁 3（真实影响）PASS：信息泄露',
      '  门禁 4（PoC 验证）PASS：真实 payload',
      '  门禁 5（数学边界）PASS：成立',
      '  门禁 6（环境）PASS：无防护',
      '  证据: src/a.js:3',
      '  复现: node p.js',
      '  影响: 泄露内部文件'
    ].join('\n');
    const { findings } = parseGateReport(text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].number, 7);
    assert.equal(findings[0].gates.filter(g => g.status === 'PASS').length, 6);
  });

  test('a BUG-like line that does not parse is reported, not dropped', () => {
    const { findings, unparseable } = parseGateReport('BUG #9 MAYBE TRUE POSITIVE — who knows\n');
    assert.equal(findings.length, 0);
    assert.equal(unparseable.length, 1);
    assert.match(unparseable[0], /MAYBE/);
  });
});

describe('parseEvidence', () => {
  test('reads file:line and an optional commit', () => {
    assert.deepEqual(parseEvidence('src/a.js:123 (abc1234)'), {
      file: 'src/a.js', line: 123, commit: 'abc1234', raw: 'src/a.js:123 (abc1234)'
    });
  });

  test('the skill-documented path:L123 form is accepted too', () => {
    // The skill states the evidence form as `path:L123`; a validator that only
    // took the bare numeric form downgraded every report written to spec.
    const e = parseEvidence('src/a.js:L123 (abc1234)');
    assert.equal(e.file, 'src/a.js');
    assert.equal(e.line, 123);
    assert.equal(e.commit, 'abc1234');
  });

  test('a Windows drive path keeps its colons', () => {
    const e = parseEvidence('D:\\axe-core\\src\\handler.js:42');
    assert.equal(e.file, 'D:\\axe-core\\src\\handler.js');
    assert.equal(e.line, 42);
  });

  test('a file without a line number has line null (a violation later)', () => {
    const e = parseEvidence('src/a.js');
    assert.equal(e.line, null);
  });
});

describe('validateFindings', () => {
  test('a complete TRUE POSITIVE passes', () => {
    const [entry] = validateFindings(parseGateReport(TP).findings);
    assert.deepEqual(entry.violations, []);
    assert.equal(entry.downgraded, false);
  });

  test('a TRUE POSITIVE without a reproduce command is downgraded', () => {
    const text = TP.replace('  复现：node bench/exploits.js p3\n', '');
    const [entry] = validateFindings(parseGateReport(text).findings);
    assert.ok(entry.downgraded);
    assert.ok(entry.violations.some(v => /复现/.test(v)));
  });

  test('a TRUE POSITIVE whose evidence lacks a line number is downgraded', () => {
    const text = TP.replace('src/archive.js:42', 'src/archive.js');
    const [entry] = validateFindings(parseGateReport(text).findings);
    assert.ok(entry.downgraded);
    assert.ok(entry.violations.some(v => /行号/.test(v)));
  });

  test('a TRUE POSITIVE carrying a FAIL gate contradicts its verdict', () => {
    const text = TP + '  门禁 5（数学边界）FAIL：下溢不可能\n';
    const [entry] = validateFindings(parseGateReport(text).findings);
    assert.ok(entry.downgraded);
    assert.ok(entry.violations.some(v => /应裁定为 FALSE POSITIVE/.test(v)));
  });

  test('a FALSE POSITIVE needs at least one FAIL with a reason', () => {
    const [ok] = validateFindings(parseGateReport(FP).findings);
    assert.deepEqual(ok.violations, []);

    const bare = FP.replace('  门禁 5（数学边界）FAIL：第 98 行校验保证 packet_size >= 16，下溢在数学上不可能\n', '');
    const [bad] = validateFindings(parseGateReport(bare).findings);
    assert.ok(bad.downgraded);
    assert.ok(bad.violations.some(v => /FAIL/.test(v)));

    const noReason = FP.replace('：第 98 行校验保证 packet_size >= 16，下溢在数学上不可能', '：');
    const [empty] = validateFindings(parseGateReport(noReason).findings);
    assert.ok(empty.downgraded);
  });

  test('an INCONCLUSIVE needs a not-evaluated gate and no FAIL', () => {
    const [ok] = validateFindings(parseGateReport(INCONCLUSIVE).findings);
    assert.deepEqual(ok.violations, []);

    const noReason = INCONCLUSIVE.replace('：生产环境是否为该依赖版本未知', '：');
    const [bad] = validateFindings(parseGateReport(noReason).findings);
    assert.ok(bad.downgraded);

    const withFail = INCONCLUSIVE + '  门禁 2（可达性）FAIL：不可达\n';
    const [contradicts] = validateFindings(parseGateReport(withFail).findings);
    assert.ok(contradicts.downgraded);
    assert.ok(contradicts.violations.some(v => /FALSE POSITIVE/.test(v)));
  });

  test('a gate number outside 1..6 is a violation', () => {
    const text = FP.replace('门禁 5', '门禁 9');
    const [entry] = validateFindings(parseGateReport(text).findings);
    assert.ok(entry.downgraded);
    assert.ok(entry.violations.some(v => /不在 1\.\.6/.test(v)));
  });

  test('an empty claim is a violation', () => {
    const [entry] = validateFindings(parseGateReport('BUG #1 FALSE POSITIVE\n  门禁 1（流程）FAIL：缺步骤\n').findings);
    assert.ok(entry.downgraded);
    assert.ok(entry.violations.some(v => /结论描述/.test(v)));
  });

  test('the six gate names are fixed and public', () => {
    assert.deepEqual(Object.values(GATE_NAMES), ['流程', '可达性', '真实影响', 'PoC 验证', '数学边界', '环境']);
  });
});

describe('splitCommand', () => {
  test('splits plain argv', () => {
    assert.deepEqual(splitCommand('git blame -L 1,1 HEAD -- src/a.js'), ['git', 'blame', '-L', '1,1', 'HEAD', '--', 'src/a.js']);
  });

  test('single-quoted fields stay one argv element, including the escape idiom', () => {
    assert.deepEqual(splitCommand("git show 'src/a b.js'"), ['git', 'show', 'src/a b.js']);
    // The '\'' idiom is one literal quote inside a single-quoted token.
    assert.deepEqual(splitCommand("git log -S'it'\\''s here' -- f"), ['git', 'log', "-Sit's here", '--', 'f']);
    // Quoted spaces inside a token stay inside that token (shell concatenation).
    assert.deepEqual(splitCommand("-S'a b c'"), ['-Sa b c']);
  });

  test('an unterminated quote throws instead of mis-splitting', () => {
    assert.throws(() => splitCommand("git show 'x"), /引号/);
  });
});

describe('verifyFinding', () => {
  test('a git command that exits 0 is verified', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: init', { 'src/a.js': 'export const a = 1;\n' });
    const result = await verifyFinding({ reproduce: 'git rev-parse HEAD' }, { cwd: repo });
    assert.equal(result.status, 'verified');
    assert.equal(result.tool, 'git');
  });

  test('a git command that exits non-zero is failed', async () => {
    const repo = await makeRepo();
    const result = await verifyFinding({ reproduce: 'git rev-parse no-such-ref' }, { cwd: repo });
    assert.equal(result.status, 'failed');
    assert.notEqual(result.exitCode, 0);
  });

  test('a tool outside the allowlist is refused, not run', async () => {
    const result = await verifyFinding({ reproduce: 'rm -rf .' });
    assert.equal(result.status, 'refused');
    assert.equal(result.tool, 'rm');
  });

  test('a finding with no reproduce command reports no-command', async () => {
    const result = await verifyFinding({ reproduce: null });
    assert.equal(result.status, 'no-command');
  });
});

describe('gate CLI', () => {
  async function runGateCli(args) {
    const chunks = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
    const { main } = await import('../src/cli.js');
    let code;
    try {
      code = await main(args);
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    return { code, output: chunks.join('') };
  }

  test('a fully gated report exits 0', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    await writeFile(file, VALID_REPORT, 'utf8');
    const { code, output } = await runGateCli(['gate', file]);
    assert.equal(code, EXIT.CLEAN);
    assert.match(output, /通过门禁契约/);
  });

  test('a finding missing its reproduce command exits 10 (downgraded)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    await writeFile(file, TP.replace('  复现：node bench/exploits.js p3\n', ''), 'utf8');
    const { code, output } = await runGateCli(['gate', file]);
    assert.equal(code, EXIT.FLAGGED);
    assert.match(output, /降级为「观察」/);
    assert.match(output, /复现/);
  });

  test('an unreadable report exits 2, never 0', async () => {
    const missing = path.join(await mkdtemp(path.join(tmpdir(), 'euthyna-gate-')), 'nope.md');
    const { code } = await runGateCli(['gate', missing]);
    assert.equal(code, EXIT.UNMEASURED);
  });

  test('a report with no findings exits 2', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'empty.md');
    await writeFile(file, '# 审计报告\n\n没有结论。\n', 'utf8');
    const { code } = await runGateCli(['gate', file]);
    assert.equal(code, EXIT.UNMEASURED);
  });

  test('--verify runs the reproduce command and downgrades a failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    // The reproduce command exits 0 in the repo (which has a commit), so it must verify.
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: init', { 'src/a.js': 'export const a = 1;\n' });
    const good = TP.replace('node bench/exploits.js p3', 'git rev-parse HEAD');
    const goodFile = path.join(dir, 'good.md');
    await writeFile(goodFile, good, 'utf8');
    const goodRun = await runGateCli(['gate', goodFile, '--verify', '--cwd', repo]);
    assert.equal(goodRun.code, EXIT.CLEAN);
    assert.match(goodRun.output, /复现核验 ✓/);

    // A reproduce command that fails is a downgrade, and the report says so.
    const bad = TP.replace('node bench/exploits.js p3', 'git rev-parse no-such-ref');
    const badFile = path.join(dir, 'bad.md');
    await writeFile(badFile, bad, 'utf8');
    const badRun = await runGateCli(['gate', badFile, '--verify', '--cwd', repo]);
    assert.equal(badRun.code, EXIT.FLAGGED);
    assert.match(badRun.output, /复现命令未通过/);
  });

  test('--verify downgrades a refused or unparseable reproduce command too', async () => {
    // Sourcery finding: only a "failed" run was downgraded, so a TRUE POSITIVE
    // whose reproduce command was refused (tool outside the allowlist) or could
    // not be split into argv exited cleanly even though its reproduction was
    // never verified. Every status other than "verified" is a downgrade.
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: init', { 'src/a.js': 'export const a = 1;\n' });

    const refused = TP.replace('node bench/exploits.js p3', 'rm -rf .');
    const refusedFile = path.join(dir, 'refused.md');
    await writeFile(refusedFile, refused, 'utf8');
    const refusedRun = await runGateCli(['gate', refusedFile, '--verify', '--cwd', repo]);
    assert.equal(refusedRun.code, EXIT.FLAGGED, 'a refused tool must downgrade');
    assert.match(refusedRun.output, /复现命令被拒绝/);
    assert.match(refusedRun.output, /rm 不在白名单/);

    const unparseable = TP.replace('node bench/exploits.js p3', "git show 'x");
    const unparseableFile = path.join(dir, 'unparseable.md');
    await writeFile(unparseableFile, unparseable, 'utf8');
    const unparseableRun = await runGateCli(['gate', unparseableFile, '--verify', '--cwd', repo]);
    assert.equal(unparseableRun.code, EXIT.FLAGGED, 'an unparseable command must downgrade');
    assert.match(unparseableRun.output, /无法拆分为 argv/);
  });

  test('--verify prints the trust warning instead of pretending to be a sandbox', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    await writeFile(file, VALID_REPORT, 'utf8');
    const { output } = await runGateCli(['gate', file, '--verify']);
    assert.match(output, /以当前用户权限执行报告中的复现命令/, 'the boundary is stated, not hidden');
    assert.match(output, /只对你自己信任的报告使用/);
    assert.match(output, /默认只执行 git 命令/, 'the default blast radius is stated');
  });

  test('an interpreter reproduce command is not executed without --allow-exec', async () => {
    // Sourcery finding: the allowlist permitted node/npm/python, so a hostile
    // report reached arbitrary code execution. Interpreters are now behind an
    // explicit consent flag; without it the command is reported, not run.
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: init', { 'src/a.js': 'export const a = 1;\n' });

    const report = TP.replace(
      'node bench/exploits.js p3',
      'node -e "require(\'node:fs\').writeFileSync(\'evidence-of-execution.txt\', \'ran\')"'
    );
    const file = path.join(dir, 'report.md');
    await writeFile(file, report, 'utf8');

    const gated = await runGateCli(['gate', file, '--verify', '--cwd', repo]);
    assert.equal(gated.code, EXIT.FLAGGED, 'an unverified reproduction is a downgrade');
    assert.match(gated.output, /解释器命令/);
    assert.match(gated.output, /--allow-exec/);
    assert.equal(
      existsSync(path.join(repo, 'evidence-of-execution.txt')),
      false,
      'without --allow-exec the command must not have run'
    );

    // With explicit consent the same command runs and verifies.
    const consented = await runGateCli(['gate', file, '--verify', '--allow-exec', '--cwd', repo]);
    assert.equal(consented.code, EXIT.CLEAN, 'a consented, succeeding command verifies');
    assert.equal(existsSync(path.join(repo, 'evidence-of-execution.txt')), true);
  });

  test('a missing report path is a usage error', async () => {
    const { code } = await runGateCli(['gate']);
    assert.equal(code, EXIT.USAGE);
  });

  test('--json emits the machine-readable validation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    await writeFile(file, VALID_REPORT, 'utf8');
    const { code, output } = await runGateCli(['gate', file, '--json']);
    assert.equal(code, EXIT.CLEAN);
    const parsed = JSON.parse(output);
    assert.equal(parsed.command, 'gate');
    assert.equal(parsed.findings.length, 3);
    assert.equal(parsed.findings.filter(f => f.downgraded).length, 0);
    assert.equal(parsed.findings[0].verdict, 'TRUE POSITIVE');
    assert.equal(parsed.findings[0].evidence.line, 42);
  });

  test('report text reaching the terminal is render-boundary sanitized', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-gate-'));
    const file = path.join(dir, 'report.md');
    const hostile = 'BUG #1 TRUE POSITIVE — \u001b]0;pwned\u0007ring\n' +
      '  门禁全部通过。证据：src/a.js:1\n  复现：git rev-parse HEAD\n  影响：x\n';
    await writeFile(file, hostile, 'utf8');
    const { output } = await runGateCli(['gate', file]);
    assert.doesNotMatch(output, /\u001b|\u0007/, 'no escape byte may reach the writer');
    assert.match(output, /ring/, 'the readable text survives');
  });
});
