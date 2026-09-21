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
import { makeRepo, commitFiles, git } from './helpers.js';

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
