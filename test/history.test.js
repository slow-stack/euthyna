/**
 * History facts, exercised against real repositories.
 *
 * The load-bearing claim is that a deleted line is attributed to the commit
 * that actually introduced it, and that the commit is classified from its own
 * message. Both are checked end to end here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeRepo, commitFiles, git } from './helpers.js';
import {
  parseDeletedRanges,
  parseDeletedLines,
  securityRelevantLines,
  classifySubject,
  classifyCommit,
  collectHistoryFacts
} from '../src/facts/history.js';
import { STATUS, KIND } from '../src/contract.js';

/**
 * Split a command line into argv the way a POSIX shell would for the subset
 * euthyna emits: bare words and single-quoted fields. The emitted command is
 * quoted precisely so that pasting it into a shell is safe; a reader who
 * instead wants to replay it as argv needs this inverse.
 */
function splitShellWords(line) {
  const words = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") {
      quoted = true;
      // The '\'' idiom: close, escaped quote, reopen.
      if (line.slice(i, i + 4) === "'\\''") {
        current += "'";
        i += 3;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (quoted) {
        current += ch;
        continue;
      }
      if (current !== '') words.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '' || quoted) words.push(current);
  return words;
}

describe('parseDeletedRanges', () => {
  test('reads the deleted range out of a zero-context hunk header', () => {
    const diff = [
      'diff --git a/x.js b/x.js',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -10,3 +10,2 @@',
      '-a',
      '-b',
      '-c',
      '+z'
    ].join('\n');
    assert.deepEqual(parseDeletedRanges(diff), [{ start: 10, count: 3 }]);
  });

  test('a count of zero means a pure insertion, so nothing was deleted', () => {
    const diff = '@@ -10,0 +11,4 @@\n+one\n+two\n+three\n+four';
    assert.deepEqual(parseDeletedRanges(diff), []);
  });

  test('an omitted count means one line', () => {
    assert.deepEqual(parseDeletedRanges('@@ -7 +7 @@'), [{ start: 7, count: 1 }]);
  });

  test('multiple hunks in one file are all collected', () => {
    const diff = '@@ -1,2 +1,1 @@\n@@ -40,1 +39,0 @@';
    assert.deepEqual(parseDeletedRanges(diff), [
      { start: 1, count: 2 },
      { start: 40, count: 1 }
    ]);
  });
});

describe('classifySubject', () => {
  test('a CVE identifier is a strong signal', () => {
    assert.equal(classifySubject('fix: bound the packet size (CVE-2024-1234)'), 'security');
  });

  test('security vocabulary is a strong signal', () => {
    assert.equal(classifySubject('patch sanitization of the filename field'), 'security');
    assert.equal(classifySubject('修复 URL 校验绕过漏洞'), 'security');
  });

  test('an ordinary fix is a weak signal, not a strong one', () => {
    assert.equal(classifySubject('fix: typo in the docs'), 'fix');
    assert.equal(classifySubject('fix: layout on small screens'), 'fix');
  });

  test('common security phrasing is recognised without reaching into general words', () => {
    // These are unambiguously security and must not be missed: an undetected
    // security fix is the failure mode this classifier exists to prevent.
    assert.equal(classifySubject('fix: validate the auth token'), 'security');
    assert.equal(classifySubject('chore: rotate credentials'), 'security');
    assert.equal(classifySubject('fix: correct the permission check'), 'security');

    // General refactoring vocabulary must NOT be treated as security, or the
    // report becomes noise nobody reads.
    assert.equal(classifySubject('refactor: validate the config shape'), 'none');
    assert.equal(classifySubject('feat: add input checking'), 'none');
  });

  test('a feature commit is neither', () => {
    assert.equal(classifySubject('feat: add dark mode'), 'none');
  });

  test('security wins over fix when both match', () => {
    assert.equal(classifySubject('fix: prevent authentication bypass'), 'security');
  });
});

describe('parseDeletedLines', () => {
  test('walks old line numbers across zero-context hunks', () => {
    const diff = [
      'diff --git a/x.js b/x.js',
      '--- a/x.js',
      '+++ b/x.js',
      '@@ -10,3 +10,2 @@',
      '-alpha',
      '-beta',
      '-gamma',
      '+zeta'
    ].join('\n');
    assert.deepEqual(parseDeletedLines(diff), [
      { line: 10, content: 'alpha' },
      { line: 11, content: 'beta' },
      { line: 12, content: 'gamma' }
    ]);
  });

  test('multiple hunks each start their own walk', () => {
    const diff = ['@@ -1,1 +1,0 @@', '-a', '@@ -40,2 +39,0 @@', '-b', '-c'].join('\n');
    assert.deepEqual(parseDeletedLines(diff), [
      { line: 1, content: 'a' },
      { line: 40, content: 'b' },
      { line: 41, content: 'c' }
    ]);
  });
});

describe('securityRelevantLines', () => {
  test('a security check line is recognized, an ordinary line is not', () => {
    assert.equal(securityRelevantLines(['  if (!authorized) return null;']), true);
    assert.equal(securityRelevantLines(['export const double = (x) => x * 2;']), false);
  });
});

describe('classifyCommit', () => {
  test('a neutral message whose diff added a sanitizer classifies security', async () => {
    const repo = await makeRepo();
    const hash = await commitFiles(repo, 'tweaks', {
      'src/a.js': 'export function render(input) {\n  const safe = sanitize(input);\n  return safe;\n}\n'
    });
    assert.equal(await classifyCommit(repo, hash, 'tweaks'), 'security');
  });

  test('a genuinely neutral commit stays none', async () => {
    const repo = await makeRepo();
    const hash = await commitFiles(repo, 'chore: add a util', {
      'src/a.js': 'export const double = (x) => x * 2;\n'
    });
    assert.equal(await classifyCommit(repo, hash, 'chore: add a util'), 'none');
  });
});

describe('collectHistoryFacts against a real repository', () => {
  test('attributes a deleted validation to the security-fix commit that introduced it', async () => {
    const repo = await makeRepo();

    // The commit that introduced the guard says it is a security fix. That
    // message is the only thing tying the deleted line back to a CVE.
    const base = await commitFiles(repo, 'fix: reject undersized packets (CVE-2024-9999)', {
      'src/handler.js': [
        'export function handle(packet) {',
        '  if (packet.size < 16) return null;',
        '  return packet.payload;',
        '}',
        ''
      ].join('\n'),
      'src/other.js': 'export const other = 1;\n'
    });

    await commitFiles(repo, 'feat: add a second module', {
      'src/feature.js': 'export const feature = true;\n'
    });

    // The change under audit removes the guard but never says so.
    await commitFiles(repo, 'refactor: simplify the handler', {
      'src/handler.js': ['export function handle(packet) {', '  return packet.payload;', '}', ''].join('\n')
    });

    const { facts, evaluated, notEvaluated } = await collectHistoryFacts({
      cwd: repo,
      base,
      head: 'HEAD'
    });

    const security = facts.filter(f => f.detail?.classification === 'security');
    assert.equal(security.length, 1, 'exactly one deleted-line origin should classify as security');

    const fact = security[0];
    assert.equal(fact.kind, KIND.HISTORY);
    assert.equal(fact.status, STATUS.ESTABLISHED);
    assert.equal(fact.detail.commitSubject, 'fix: reject undersized packets (CVE-2024-9999)');
    assert.equal(fact.evidence.commit, base);
    assert.equal(fact.evidence.file, 'src/handler.js');
    assert.match(fact.statement, /CVE-2024-9999/);
    assert.ok(fact.command.includes('git blame'), 'fact must carry a reproducible command');

    // The unused-file commit is not deleted from, so it must not appear.
    assert.ok(
      !facts.some(f => f.detail?.commitSubject?.startsWith('feat:')),
      'a commit whose code was not deleted must not be reported'
    );

    assert.equal(evaluated[0].kind, KIND.HISTORY);
    assert.equal(evaluated[0].count, 1, 'one line was deleted');

    // Pickaxe was not requested, so its absence has to be stated, not implied.
    assert.ok(
      notEvaluated.some(n => n.kind === 'reintroduction'),
      'not running pickaxe must be recorded as not evaluated'
    );
  });

  test('a deleted line from a feature commit is reported without a security classification', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: add the widget', {
      'src/w.js': 'export const widget = () => 42;\n'
    });
    await commitFiles(repo, 'chore: drop the widget', { 'src/w.js': 'export const stub = 0;\n' });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].detail.classification, 'none');
  });

  test('a change with no deletions says so instead of reporting nothing', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: initial', { 'a.txt': 'one\n' });
    await commitFiles(repo, 'feat: append', { 'a.txt': 'one\ntwo\n' });

    const { facts, notEvaluated } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 0);
    assert.ok(
      notEvaluated.some(n => /没有任何一行被删除/.test(n.reason)),
      'zero facts plus an explanation, never zero facts alone'
    );
  });

  test('an empty revision range is recorded as not evaluated', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: initial', { 'a.txt': 'one\n' });

    const { facts, notEvaluated } = await collectHistoryFacts({ cwd: repo, base, head: base });
    assert.equal(facts.length, 0);
    assert.ok(notEvaluated.some(n => /没有文件变更/.test(n.reason)));
  });

  test('security-relevant origins are reported before ordinary ones', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: two modules', {
      'src/a.js': 'export const a = 1;\n',
      'src/b.js': 'export const b = 2;\n'
    });
    // The security fix must land BEFORE the base revision: blame is taken at
    // base, so a commit made after it cannot own any line that base contains.
    await commitFiles(repo, 'fix: validate the auth token', {
      'src/a.js': 'export const a = "validated";\n'
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();

    await commitFiles(repo, 'refactor: simplify both', {
      'src/a.js': 'export const a2 = 1;\n',
      'src/b.js': 'export const b2 = 2;\n'
    });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 2, 'one origin per deleted line, from two different commits');
    assert.equal(facts[0].detail.classification, 'security', 'the security origin must sort first');
    assert.equal(facts[0].evidence.file, 'src/a.js');
    assert.equal(facts[1].detail.classification, 'none');
    assert.equal(facts[1].evidence.file, 'src/b.js');
  });

  test('a deleted security check is flagged even when its owning commit message is neutral', async () => {
    // Issue #5 scenario: the classification must not depend on the commit
    // message alone. A commit that introduced a security check under an
    // innocent subject ("feat: add the widget") still leaves security code on
    // the delete list, and that has to be surfaced.
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: add the widget', {
      'src/w.js': ['export function render() {', '  if (!authorized) return;', '  doRender();', '}', ''].join('\n')
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    await commitFiles(repo, 'refactor: trust the caller', {
      'src/w.js': ['export function render() {', '  doRender();', '}', ''].join('\n')
    });

    const { facts, notEvaluated } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    const fact = facts.find(f => f.detail?.classification === 'security');
    assert.ok(fact, 'deleting a security check must be flagged with a neutral message');
    assert.equal(fact.detail.classificationBasis, 'deleted-line');
    assert.equal(fact.detail.originMethod, 'blame');
    assert.ok(
      notEvaluated.some(n => n.kind === 'history-origins' && /最后修改/.test(n.reason)),
      'the blame semantics must be stated when --origins is off'
    );
  });

  test('a neutral message whose diff added a sanitizer classifies security by the diff', async () => {
    // Issue #5 scenario B: "update utils"-style messages whose changed lines
    // are themselves security vocabulary must not classify as none.
    const repo = await makeRepo();
    await commitFiles(repo, 'tweaks', {
      'src/a.js': 'export function render(input) {\n  const safe = sanitize(input);\n  return safe;\n}\n'
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    // The deleted line carries no security vocabulary; the signal has to come
    // from the owning commit's diff, which added the sanitizer.
    await commitFiles(repo, 'refactor: drop the helper', {
      'src/a.js': 'export function render(input) {\n  const safe = sanitize(input);\n  return input;\n}\n'
    });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].detail.classification, 'security');
    assert.equal(facts[0].detail.classificationBasis, 'diff');
  });

  test('--origins re-attributes a duplicated guard to the commit that first introduced it', async () => {
    // Issue #5 scenario A: blame answers "who last touched the line" (here: the
    // chore commit that duplicated the guard); --origins answers "who first
    // introduced the content" (the security fix). The fact must carry both and
    // stand on the introducing commit.
    const repo = await makeRepo();
    const fix = await commitFiles(repo, 'fix: prevent an authorization bypass', {
      'src/svc.js': [
        'export function svc(x) {',
        '  if (!authorized) return null;',
        '  return x;',
        '}',
        ''
      ].join('\n')
    });
    const chore = await commitFiles(repo, 'chore: reuse the same guard in a second route', {
      'src/svc.js': [
        'export function svc(x) {',
        '  if (!authorized) return null;',
        '  return x;',
        '}',
        'export function svc2(y) {',
        '  if (!authorized) return null;',
        '  return y;',
        '}',
        ''
      ].join('\n')
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    // The change under audit deletes the second copy of the guard.
    await commitFiles(repo, 'refactor: drop the duplicate route', {
      'src/svc.js': [
        'export function svc(x) {',
        '  if (!authorized) return null;',
        '  return x;',
        '}',
        ''
      ].join('\n')
    });

    // Without --origins the deleted guard is still flagged (security code was
    // deleted), but the attribution is blame's: the chore commit.
    const plain = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    const plainSecurity = plain.facts.find(f => f.detail?.classification === 'security');
    assert.ok(plainSecurity, 'the deleted guard must be flagged without --origins too');
    assert.equal(plainSecurity.detail.originMethod, 'blame');
    assert.equal(plainSecurity.evidence.commit, chore);

    // With --origins the deleted guard is re-attributed to the security fix.
    const withOrigins = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD', origins: true });
    const refined = withOrigins.facts.filter(f => f.detail?.originMethod === 'pickaxe');
    assert.ok(refined.length >= 1, '--origins must split out the refined origin fact');
    const origin = refined[0];
    assert.equal(origin.evidence.commit, fix, 'the deleted copy traces back to the introducing security fix');
    assert.equal(origin.detail.originCommit, fix);
    assert.equal(origin.detail.blameCommit, chore, 'blame attribution is kept as context');
    assert.equal(origin.detail.classification, 'security');
    assert.match(origin.statement, /最初由提交/, 'the statement says 最初引入');
    assert.match(origin.statement, /最后修改者/, 'and names the blame owner');
    assert.match(origin.command, /git log --format=%H -S/, 'the reproduction command is the origin probe');
  });

  test('hitting the --origins cap is recorded rather than silently truncating', async () => {
    const repo = await makeRepo();
    const lines = Array.from({ length: 8 }, (_, i) => `export const a${i} = ${i};`);
    await commitFiles(repo, 'feat: many constants', { 'src/m.js': `${lines.join('\n')}\n` });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    await commitFiles(repo, 'refactor: drop them all', { 'src/m.js': 'export const keep = 1;\n' });

    const { notEvaluated } = await collectHistoryFacts({
      cwd: repo,
      base,
      head: 'HEAD',
      origins: true,
      maxOrigins: 3
    });
    assert.ok(
      notEvaluated.some(n => /来源探针上限 3 已用尽/.test(n.reason)),
      'a cap that changed the answer must appear in the coverage report'
    );
  });
});

describe('reintroduction detection', () => {
  test('flags an added line whose count was changed by an earlier commit', async () => {
    const repo = await makeRepo();

    // The guard is added, then removed, then added back by the change under audit.
    const base = await commitFiles(repo, 'feat: initial service', {
      'src/svc.js': 'export function svc(x) {\n  return x;\n}\n'
    });
    await commitFiles(repo, 'fix: sanitize the service input', {
      'src/svc.js': 'export function svc(x) {\n  if (!x) throw new Error("bad");\n  return x;\n}\n'
    });
    const withoutGuard = await commitFiles(repo, 'refactor: trust the caller', {
      'src/svc.js': 'export function svc(x) {\n  return x;\n}\n'
    });
    await commitFiles(repo, 'fix: restore input validation', {
      'src/svc.js': 'export function svc(x) {\n  if (!x) throw new Error("bad");\n  return x;\n}\n'
    });

    const { facts, notEvaluated } = await collectHistoryFacts({
      cwd: repo,
      base: withoutGuard,
      head: 'HEAD',
      pickaxe: true
    });

    const reintro = facts.filter(f => f.kind === KIND.REINTRODUCTION);
    assert.ok(reintro.length >= 1, 'the restored guard should be detected as a reintroduction');

    const fact = reintro[0];
    assert.equal(fact.status, STATUS.ESTABLISHED);
    assert.equal(fact.evidence.file, 'src/svc.js');
    assert.match(fact.evidence.snippet, /throw new Error/);
    assert.ok(
      fact.detail.candidateCommits.some(c => c.classification === 'security'),
      'the sanitize commit must be recognised among the candidate origins'
    );
    assert.ok(
      typeof fact.detail.securityOrigin === 'string',
      'a security-classified origin must be surfaced for the adjudicator'
    );

    // Requesting pickaxe must clear the "not evaluated" note about it.
    assert.ok(
      !notEvaluated.some(n => /未启用 --pickaxe/.test(n.reason)),
      'enabling pickaxe must remove the not-evaluated note'
    );

    // Sanity: base really is the guard-less version.
    const atBase = await git(repo, ['show', `${withoutGuard}:src/svc.js`]);
    assert.ok(!atBase.includes('throw new Error'), 'fixture precondition');
    assert.ok(base.length === 40);
  });

  test('attribution spread over several files names the file count and per-file lines', async () => {
    // Found by checking the tool's own output against axe-core by hand: the fact
    // said "4 lines from commit X, evidence: <file>" while only 3 of those lines
    // were in that file. The total was right and the presentation was wrong,
    // which is worse than a wrong total because the reader trusts it.
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: two modules', {
      'src/a.js': 'export const a = 1;\nexport const keep = 0;\n',
      'src/b.js': 'export const b = 2;\nexport const keep2 = 0;\n'
    });
    await commitFiles(repo, 'fix: harden the auth path', {
      'src/a.js': 'export const a = "safe";\nexport const keep = 0;\n',
      'src/b.js': 'export const b = "safe";\nexport const keep2 = 0;\n'
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();

    await commitFiles(repo, 'refactor: rename both', {
      'src/a.js': 'export const a2 = "safe";\nexport const keep = 0;\n',
      'src/b.js': 'export const b2 = "safe";\nexport const keep2 = 0;\n'
    });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    const multi = facts.find(f => f.detail.classification === 'security');
    assert.ok(multi, 'the harden commit should own lines in both files');

    assert.equal(multi.detail.blamedLines, 2);
    assert.equal(multi.detail.byFile.length, 2, 'both files must be listed');
    assert.deepEqual(
      multi.detail.byFile.map(f => f.lines),
      [1, 1],
      'per-file counts must be given, not just the total'
    );
    assert.match(multi.statement, /分布在 2 个文件/, 'the statement must not imply a single file');
    assert.equal(multi.evidence.files.length, 2);
    assert.match(
      multi.detail.reproductionNote,
      /只复现/,
      'when the command covers one file, say so rather than letting it look complete'
    );
  });

  test('the reproduction command carries real line numbers, not a placeholder', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: initial', {
      'src/a.js': 'export const a = 1;\nexport const b = 2;\n'
    });
    await commitFiles(repo, 'refactor: drop two lines', { 'src/a.js': 'export const a = 1;\n' });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 1);
    const command = facts[0].command;

    assert.doesNotMatch(command, /<[^>]+>/, 'a placeholder is not a reproducible command');
    assert.match(command, /git blame --porcelain -L \d+,\d+/, 'the real range must be named');
    assert.match(command, new RegExp(base), 'the base revision must be named');
  });

  test('a hostile filename cannot turn the emitted command into code', async () => {
    // A repo author controls filenames; `;` is legal in them. The command is
    // emitted for a reader to paste, so it must carry the filename as data.
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: initial', {
      'src/a; id; b.js': 'export const a = 1;\nexport const b = 2;\n'
    });
    await commitFiles(repo, 'refactor: drop one line', { 'src/a; id; b.js': 'export const a = 1;\n' });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 1);
    const command = facts[0].command;

    // The path segment must be inside single quotes, not bare.
    assert.match(command, /-- 'src\/a; id; b\.js'/, 'the hostile path must be single-quoted');

    // Replaying the emitted argv must reproduce the fact, not execute `id`.
    const args = splitShellWords(command.replace(/^git\s+/, ''));
    assert.equal(args[args.length - 1], 'src/a; id; b.js', 'the path survives as one argv element');
    const output = await git(repo, args);
    assert.match(output, /export const b = 2;/, 'the replayed command still reproduces the attribution');
  });

  test('a filename containing a single quote round-trips through the emitted command', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, "feat: it's initial", {
      "src/a'b.js": 'export const a = 1;\nexport const b = 2;\n'
    });
    await commitFiles(repo, "refactor: drop one line", { "src/a'b.js": 'export const a = 1;\n' });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    assert.equal(facts.length, 1);
    const command = facts[0].command;

    const args = splitShellWords(command.replace(/^git\s+/, ''));
    assert.equal(args[args.length - 1], "src/a'b.js");
    const output = await git(repo, args);
    assert.match(output, /export const b = 2;/, 'the replayed command blames the surviving line');
  });

  test('the emitted command really reproduces the attributed line', async () => {
    // The contract says every fact carries a command a reader can re-run. This
    // test runs it. It also pins down a bug found by hand against axe-core:
    // git blame --porcelain reports `<sha> <origLine> <finalLine>`, and using
    // origLine produces a command that exits 0, looks plausible, and blames a
    // completely different line.
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: service skeleton', {
      'src/svc.js': ['export function svc(x) {', '  return x;', '}', ''].join('\n')
    });
    await commitFiles(repo, 'fix: prevent an authorization bypass', {
      'src/svc.js': ['export function svc(x) {', '  if (!x) throw new Error("missing");', '  return x;', '}', ''].join('\n')
    });
    // Push the guard down the file so its origin line and its current line differ.
    await commitFiles(repo, 'chore: add a header comment', {
      'src/svc.js': [
        '// service module',
        '// used by the handler layer',
        '// see docs',
        '',
        'export function svc(x) {',
        '  if (!x) throw new Error("missing");',
        '  return x;',
        '}',
        ''
      ].join('\n')
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    await commitFiles(repo, 'refactor: trust the caller', {
      'src/svc.js': [
        '// service module',
        '// used by the handler layer',
        '// see docs',
        '',
        'export function svc(x) {',
        '  return x;',
        '}',
        ''
      ].join('\n')
    });

    const { facts } = await collectHistoryFacts({ cwd: repo, base, head: 'HEAD' });
    const fact = facts.find(f => f.detail.classification === 'security');
    assert.ok(fact, 'the guard origin should be attributed');

    const args = splitShellWords(fact.command.replace(/^git\s+/, ''));
    const output = await git(repo, args);

    assert.match(
      output,
      /throw new Error\("missing"\)/,
      're-running the advertised command must show the deleted line'
    );
    assert.doesNotMatch(output, /used by the handler layer/, 'it must not blame an unrelated line');
  });

  test('a line that is genuinely new is not reported as a reintroduction', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: initial', { 'src/n.js': 'export const n = 1;\n' });
    const without = await commitFiles(repo, 'chore: noop', { 'src/n.js': 'export const n = 1;\n// note\n' });
    await commitFiles(repo, 'feat: brand new function', {
      'src/n.js': [
        'export const n = 1;',
        '// note',
        'export function neverExistedBefore(alpha, beta) {',
        '  return alpha + beta;',
        '}',
        ''
      ].join('\n')
    });

    const { facts } = await collectHistoryFacts({
      cwd: repo,
      base: without,
      head: 'HEAD',
      pickaxe: true
    });

    assert.equal(
      facts.filter(f => f.kind === KIND.REINTRODUCTION).length,
      0,
      'a first-time line has no earlier commit changing its count'
    );
  });

  test('hitting the pickaxe cap is recorded rather than silently truncating', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: initial', { 'src/m.js': 'export const m = 0;\n' });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();

    const added = Array.from({ length: 12 }, (_, i) => `export const added${i} = ${i};`).join('\n');
    await commitFiles(repo, 'feat: many additions', { 'src/m.js': `export const m = 0;\n${added}\n` });

    const { notEvaluated } = await collectHistoryFacts({
      cwd: repo,
      base,
      head: 'HEAD',
      pickaxe: true,
      maxPickaxe: 5
    });

    assert.ok(
      notEvaluated.some(n => /pickaxe 探针上限 5 已用尽/.test(n.reason)),
      'a cap that changed the answer must appear in the coverage report'
    );
  });
});
