/**
 * CLI behaviour: argument parsing and the exit code contract.
 *
 * The exit code contract is the part this ecosystem lacks - none of the eight
 * measurement plugins surveyed publishes a process exit code - so it is tested
 * here rather than left to convention.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { parseArgs, EXIT } from '../src/cli.js';
import { makeRepo, commitFiles, git, npmLockfile } from './helpers.js';

const execFileAsync = promisify(execFile);

describe('parseArgs', () => {
  test('separates positional arguments from flags', () => {
    const { positional, flags } = parseArgs(['history', '--base', 'main']);
    assert.deepEqual(positional, ['history']);
    assert.equal(flags.base, 'main');
  });

  test('a repeated flag accumulates instead of overwriting', () => {
    // Overwriting here would report on one symbol while the caller asked about
    // three, and the output would look entirely normal.
    const { flags } = parseArgs(['coverage', '--symbol', 'a', '--symbol', 'b', '--symbol', 'c']);
    assert.deepEqual(flags.symbol, ['a', 'b', 'c']);
  });

  test('a valueless flag becomes true', () => {
    const { flags } = parseArgs(['history', '--pickaxe', '--base', 'main']);
    assert.equal(flags.pickaxe, true);
    assert.equal(flags.base, 'main');
  });

  test('a flag followed by another flag does not consume it', () => {
    const { flags } = parseArgs(['--pickaxe', '--json']);
    assert.equal(flags.pickaxe, true);
    assert.equal(flags.json, true);
  });
});

describe('exit code contract', () => {
  test('a history run that finds a security-classified origin exits 10', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'fix: prevent authentication bypass (CVE-2024-1111)', {
      'src/a.js': 'if (!ok) throw new Error("denied");\n'
    });
    await commitFiles(repo, 'refactor: drop the check', { 'src/a.js': 'doIt();\n' });

    const code = await main(['history', '--repo', repo, '--base', base, '--json']);
    assert.equal(code, EXIT.FLAGGED);
  });

  test('a history run with nothing to report exits 0', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: add a file', { 'src/a.js': 'export const a = 1;\n' });
    await commitFiles(repo, 'feat: touch another', { 'src/b.js': 'export const b = 2;\n' });

    const code = await main(['history', '--repo', repo, '--base', base, '--json']);
    assert.equal(code, EXIT.CLEAN);
  });

  test('history --origins accepts the flag and still flags the security origin', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    await commitFiles(repo, 'fix: prevent an authorization bypass', {
      'src/svc.js': ['export function svc(x) {', '  if (!isAuthorized(user)) return null;', '  return x;', '}', ''].join('\n')
    });
    await commitFiles(repo, 'chore: reuse the guard in a second route', {
      'src/svc.js': [
        'export function svc(x) {', '  if (!isAuthorized(user)) return null;', '  return x;', '}',
        'export function svc2(y) {', '  if (!isAuthorized(user)) return null;', '  return y;', '}', ''
      ].join('\n')
    });
    const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
    await commitFiles(repo, 'refactor: drop the duplicate route', {
      'src/svc.js': ['export function svc(x) {', '  if (!isAuthorized(user)) return null;', '  return x;', '}', ''].join('\n')
    });

    const code = await main(['history', '--repo', repo, '--base', base, '--origins', '--json']);
    assert.equal(code, EXIT.FLAGGED);
  });

  test('a missing --base is a usage error', async () => {
    const { main } = await import('../src/cli.js');
    assert.equal(await main(['history', '--json']), EXIT.USAGE);
  });

  test('an unreadable coverage file exits 2, which must not read as clean', async () => {
    const { main } = await import('../src/cli.js');
    const missing = path.join(await mkdtemp(path.join(tmpdir(), 'euthyna-cli-')), 'nope.json');
    const code = await main(['coverage', '--coverage', missing, '--symbol', 'x', '--json']);
    assert.equal(code, EXIT.UNMEASURED);
    assert.notEqual(code, EXIT.CLEAN);
  });

  test('coverage with no symbol is a usage error', async () => {
    const { main } = await import('../src/cli.js');
    assert.equal(await main(['coverage', '--coverage', 'whatever.json']), EXIT.USAGE);
  });

  test('an unknown command is a usage error', async () => {
    const { main } = await import('../src/cli.js');
    assert.equal(await main(['frobnicate']), EXIT.USAGE);
  });
});

describe('json output', () => {
  test('is a single parseable report carrying the contract version', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: x', { 'src/a.js': 'export const a = 1;\n' });

    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = chunk => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      await main(['history', '--repo', repo, '--base', base, '--json']);
    } finally {
      process.stdout.write = original;
    }

    const report = JSON.parse(chunks.join(''));
    assert.equal(report.schemaVersion, '0.1');
    assert.ok(report.producer.name);
    assert.ok(report.coverage);
    assert.ok(Array.isArray(report.facts));
  });
});

describe('stderr boundary', () => {
  test('a usage error embedding a hostile flag value reaches stderr sanitized', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();

    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = chunk => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      const code = await main(['history', '--repo', repo, '--base', '\u0007bel\u001b[31mred']);
      assert.equal(code, EXIT.USAGE);
    } finally {
      process.stderr.write = original;
    }

    const all = chunks.join('');
    assert.doesNotMatch(all, /\u0007|\u001b/, 'no raw control byte may reach the writer');
    assert.match(all, /\\x07/, 'the byte survives as a visible escape');
    assert.match(all, /belred/, 'the readable text survives');
  });

  test('an unknown command echoing hostile argv reaches stderr sanitized', async () => {
    const { main } = await import('../src/cli.js');

    const chunks = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = chunk => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      const code = await main(['frobnicate\u0007']);
      assert.equal(code, EXIT.USAGE);
    } finally {
      process.stderr.write = original;
    }

    const all = chunks.join('');
    assert.doesNotMatch(all, /\u0007/, 'no raw control byte may reach the writer');
    assert.match(all, /frobnicate/, 'the command name survives');
  });
});

describe('audit command (history + deps in one run)', () => {
  test('merges history and lockfile facts into one report and exits by the worse half', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'fix: prevent authentication bypass (CVE-2024-1111)', {
      'src/a.js': 'if (!ok) throw new Error("denied");\\n'
    });
    await commitFiles(repo, 'refactor: drop the check', { 'src/a.js': 'doIt();\\n' });
    await writeFile(
      path.join(repo, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture' },
          'node_modules/left-pad': { version: '1.3.0' }
        }
      }),
      'utf8'
    );

    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = chunk => {
      chunks.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = await main(['audit', '--repo', repo, '--base', base, '--json']);
    } finally {
      process.stdout.write = original;
    }

    assert.equal(code, EXIT.FLAGGED, 'the deleted security check must fail the run');
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.producer.name, 'euthyna-audit');
    const kinds = new Set(report.facts.map(f => f.kind));
    assert.ok(kinds.has('history'), 'the history half must be present');
    assert.ok(kinds.has('dependency'), 'the deps half must be present');
    const dep = report.facts.find(f => f.kind === 'dependency');
    assert.match(dep.statement, /left-pad/, 'the lockfile dependency was enumerated, not hand-picked');
  });

  test('a clean repo with no lockfile still measures history and exits 0', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: add a file', { 'src/a.js': 'export const a = 1;\\n' });
    await commitFiles(repo, 'feat: touch another', { 'src/b.js': 'export const b = 2;\\n' });

    const code = await main(['audit', '--repo', repo, '--base', base, '--json']);
    assert.equal(code, EXIT.CLEAN);
  });

  test('a missing --base is a usage error', async () => {
    const { main } = await import('../src/cli.js');
    assert.equal(await main(['audit', '--json']), EXIT.USAGE);
  });
});

describe('audit declares when the manifest it measured is not the --head manifest', () => {
  // The two halves of audit read from different places: history from the commits
  // named by --base/--head, deps from the manifest checked out in --repo. A clone
  // parked elsewhere silently reports facts about a version the caller did not ask
  // for — measured on a real repository as 284 dependency facts where the tag holds
  // 366. The criterion is manifest CONTENT, not the checked-out sha: comparing shas
  // was shown to fire on a PR merge commit whose lockfile is byte-identical to
  // --head's, and to stay silent on a gitignored lockfile that belongs to no commit.
  async function repoWithAGrowingLock() {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'chore: pin left-pad', {
      'package-lock.json': npmLockfile([['left-pad', '1.3.0']]),
      'src/a.js': 'export const a = 1;\n'
    });
    const head = await commitFiles(repo, 'chore: pin alpha', {
      'package-lock.json': npmLockfile([['left-pad', '1.3.0'], ['alpha', '2.0.0']]),
      'src/b.js': 'export const b = 2;\n'
    });
    return { repo, base, head };
  }

  async function auditJson(args) {
    const { main } = await import('../src/cli.js');
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = await main(args);
    } finally {
      process.stdout.write = original;
    }
    return { code, report: JSON.parse(chunks.join('')) };
  }

  const declared = (report) => report.coverage.notEvaluated.filter((e) => e.code);

  test('a manifest that differs from --head is declared and does not lose the facts', async () => {
    const { repo, base, head } = await repoWithAGrowingLock();
    await git(repo, ['checkout', '-q', '--detach', base]);

    const { code, report } = await auditJson(['audit', '--repo', repo, '--base', base, '--head', head, '--json']);

    const entry = declared(report).find((e) => e.code === 'manifest-not-head');
    assert.ok(entry, 'content that is not the --head content must be declared');
    assert.ok(entry.reason.includes(head.slice(0, 10)), `the reason must name --head, got: ${entry.reason}`);
    assert.ok(
      report.facts.some((f) => f.kind === 'dependency'),
      'declaring the gap must not suppress the dependency facts that were measured'
    );
    assert.equal(code, EXIT.CLEAN, 'a declared gap cannot fail a run the history half answered');
  });

  test('a merge commit with lockfile content identical to --head declares nothing', async () => {
    // actions/checkout leaves a pull_request run on the merge commit. Its lockfile
    // equals the PR head's, so the dependency facts ARE the --head facts, and
    // declaring them a gap would force every finding that cites them to
    // not_evaluated for no reason (fact-contract hard rule 1).
    const { repo, base, head } = await repoWithAGrowingLock();
    await git(repo, ['checkout', '-q', '-b', 'other', base]);
    await commitFiles(repo, 'chore: touch an unrelated file on the other branch', {
      'src/c.js': 'export const c = 3;\n'
    });
    await git(repo, ['merge', '-q', '--no-ff', '-m', `Merge the lockfile change into other`, head]);

    assert.equal(
      (await git(repo, ['diff', '--name-only', head, '--', 'package-lock.json'])).trim(),
      '',
      'the fixture is only worth this test if its manifest content equals --head'
    );
    assert.notEqual((await git(repo, ['rev-parse', 'HEAD'])).trim(), head, 'and if the commit itself differs');

    const { report } = await auditJson(['audit', '--repo', repo, '--base', base, '--head', head, '--json']);
    assert.deepEqual(declared(report), [], 'identical content must not be declared as a gap');
  });

  test('a manifest that exists only in the working tree is declared', async () => {
    // The case a commit comparison cannot see at all: the lockfile is gitignored,
    // so nothing about it belongs to any commit, and the measured facts are the
    // working tree's by construction.
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'chore: ignore the lockfile', {
      '.gitignore': 'package-lock.json\n',
      'src/a.js': 'export const a = 1;\n'
    });
    const head = await commitFiles(repo, 'chore: touch another file', { 'src/b.js': 'export const b = 2;\n' });
    await writeFile(path.join(repo, 'package-lock.json'), npmLockfile([['left-pad', '1.3.0']]), 'utf8');

    const { report } = await auditJson(['audit', '--repo', repo, '--base', base, '--head', head, '--json']);

    const entry = declared(report).find((e) => e.code === 'manifest-not-head');
    assert.ok(entry, 'a manifest absent from --head cannot read as measured-at---head');
    assert.ok(entry.reason.includes('package-lock.json'), `the reason must name the file, got: ${entry.reason}`);
  });

  test('a manifest exactly matching --head declares nothing', async () => {
    const { repo, base, head } = await repoWithAGrowingLock();
    await git(repo, ['checkout', '-q', '--detach', head]);

    const { report } = await auditJson(['audit', '--repo', repo, '--base', base, '--head', head, '--json']);

    assert.deepEqual(declared(report), [], 'the normal case must not gain a warning line');
  });

  test('an uncommitted edit away from the --head content is declared', async () => {
    const { repo, base, head } = await repoWithAGrowingLock();
    await git(repo, ['checkout', '-q', '--detach', head]);
    await writeFile(path.join(repo, 'package-lock.json'), npmLockfile([['left-pad', '1.3.0'], ['beta', '3.0.0']]), 'utf8');

    const { report } = await auditJson(['audit', '--repo', repo, '--base', base, '--head', head, '--json']);

    assert.ok(declared(report).some((e) => e.code === 'manifest-not-head'), 'working-tree content belongs to no commit');
  });

  test('omitting --head declares nothing, because HEAD is the head by definition', async () => {
    const { repo, base } = await repoWithAGrowingLock();

    const { report } = await auditJson(['audit', '--repo', repo, '--base', base, '--json']);

    assert.deepEqual(declared(report), [], 'the checkout is at the head that was measured against');
  });
});

describe('the manifest-version decision table', () => {
  // The probes that feed the decision run git; the decision itself is pure, and its
  // fail-closed branch is otherwise unreachable from a test. Missing data must never
  // read as clean, so an unreadable probe is itself a declared gap.
  const t = (zh) => zh;

  test('identical content at --head yields no gap', async () => {
    const { manifestVersionGap } = await import('../src/cli.js');
    assert.equal(manifestVersionGap({ probeFailed: false, existsAtHead: true, differsFromHead: false, head: 'a'.repeat(40), worktree: 'a'.repeat(40), manifest: 'Cargo.lock' }, t), null);
  });

  test('content differing from --head is a gap naming that commit', async () => {
    const { manifestVersionGap } = await import('../src/cli.js');
    const gap = manifestVersionGap({ probeFailed: false, existsAtHead: true, differsFromHead: true, head: 'b'.repeat(40), worktree: 'c'.repeat(40), manifest: 'Cargo.lock' }, t);
    assert.equal(gap.code, 'manifest-not-head');
    assert.ok(gap.reason.includes('b'.repeat(10)), gap.reason);
  });

  test('a manifest absent at --head is the same gap', async () => {
    const { manifestVersionGap } = await import('../src/cli.js');
    const gap = manifestVersionGap({ probeFailed: false, existsAtHead: false, differsFromHead: false, head: 'd'.repeat(40), worktree: 'd'.repeat(40), manifest: 'go.mod' }, t);
    assert.equal(gap.code, 'manifest-not-head');
    assert.ok(gap.reason.includes('go.mod'), gap.reason);
  });

  test('a failed probe is declared, never treated as clean', async () => {
    const { manifestVersionGap } = await import('../src/cli.js');
    const gap = manifestVersionGap({ probeFailed: true, existsAtHead: false, differsFromHead: false, head: 'e'.repeat(40), worktree: 'e'.repeat(40), manifest: 'Cargo.lock' }, t);
    assert.equal(gap.code, 'manifest-unverified', 'a probe that could not run must not read as no gap');
  });
});

describe('deps --all (enumerate every manifest dependency)', () => {
  test('reports one fact per lockfile entry without any --dep flag', async () => {
    const { main } = await import('../src/cli.js');
    const repo = await makeRepo();
    await writeFile(
      path.join(repo, 'package-lock.json'),
      JSON.stringify({
        name: 'fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture' },
          'node_modules/alpha': { version: '1.0.0' },
          'node_modules/beta': { version: '2.0.0' }
        }
      }),
      'utf8'
    );

    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = chunk => {
      chunks.push(String(chunk));
      return true;
    };
    let code;
    try {
      code = await main(['deps', '--repo', repo, '--all', '--json']);
    } finally {
      process.stdout.write = original;
    }

    assert.equal(code, EXIT.CLEAN);
    const report = JSON.parse(chunks.join(''));
    const names = report.facts.map(f => f.detail.dependency).sort();
    assert.deepEqual(names, ['alpha', 'beta']);
  });

  test('--all with no manifest anywhere exits 2, not clean', async () => {
    const { main } = await import('../src/cli.js');
    const empty = await mkdtemp(path.join(tmpdir(), 'euthyna-all-'));
    assert.equal(await main(['deps', '--repo', empty, '--all', '--json']), EXIT.UNMEASURED);
  });
});

describe('crash path (bin entry)', () => {
  test('an unexpected git failure exits 2 with a terminal-safe crash report', async () => {
    const repo = await makeRepo();
    const base = await commitFiles(repo, 'feat: base', { 'src/a.js': 'export const a = 1;\n' });
    await commitFiles(repo, 'feat: head', { 'src/b.js': 'export const b = 2;\n' });

    // Force a genuine measurement crash the way a corrupt repository would:
    // head's tree object is deleted after the commit is recorded. rev-parse
    // still succeeds (the commit object is intact); the diff cannot read the
    // tree and git fails — the throw propagates out of main() to bin's catch.
    const tree = (await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim();
    await rm(path.join(repo, '.git', 'objects', tree.slice(0, 2), tree.slice(2)));

    const bin = fileURLToPath(new URL('../bin/euthyna.js', import.meta.url));
    await assert.rejects(
      execFileAsync(process.execPath, [bin, 'history', '--repo', repo, '--base', base], {
        encoding: 'utf8'
      }),
      (error) => {
        assert.equal(error.code, 2, 'an unmeasurable crash must not read as clean');
        const stderr = String(error.stderr || '');
        assert.match(stderr, /测量过程抛出异常/, 'the crash line is present');
        assert.match(stderr, /unable to read tree/, 'git diagnosis survives sanitization');
        assert.doesNotMatch(stderr, /\u0007|\u001b/, 'no raw control byte may reach stderr');
        return true;
      }
    );
  });
});
