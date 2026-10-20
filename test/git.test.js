/**
 * The git wrapper's error path.
 *
 * The claim "a failed git invocation's stderr carries a VT/BEL sequence and it
 * does not reach the writer raw" is tested against real git for the failure
 * itself, and against hostile input directly at the message builder where the
 * platform cannot carry the bytes: on Windows a control byte in argv does not
 * survive the command-line round trip (observed: BEL reached git as '?', and an
 * ESC-bearing argument came out with different semantics entirely).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { git, gitFailureMessage, mergeBase } from '../src/git.js';
import { makeRepo, commitFiles } from './helpers.js';

describe('gitFailureMessage', () => {
  test('quotes the argv so the message can be pasted back into a shell', () => {
    assert.equal(
      gitFailureMessage(['log', 'a; id; b.js'], 'fatal: nope'),
      `git 'log' 'a; id; b.js' failed: fatal: nope`
    );
  });

  test('shell metacharacters in a filename stay data, inside quotes', () => {
    assert.equal(
      gitFailureMessage(['blame', 'a`id`b.js'], 'fatal: nope'),
      `git 'blame' 'a\`id\`b.js' failed: fatal: nope`
    );
  });

  test('a VT/BEL-bearing detail reaches the message as visible escapes only', () => {
    // The issue's regression: git embeds repo-controlled names in its own
    // messages, so the detail is sanitized here rather than left to whichever
    // writer happens to catch the error.
    const msg = gitFailureMessage(['log', 'HEAD'], "fatal: '\u001b[31mred\u001b[0m x\u0007' nope");
    assert.doesNotMatch(msg, /\u001b|\u0007/, 'no raw control byte may survive');
    assert.match(msg, /\\x07/);
    assert.match(msg, /x\\x07' nope/);
  });

  test('hostile bytes in the argv itself are escaped too, not just the detail', () => {
    // shellQuote makes an argument shell-inert but not terminal-safe: a BEL
    // inside single quotes still beeps. Real flows pass repo-controlled
    // filenames through this argv (git diff -- <file>), so the assembled
    // message — both halves — must pass the terminal-safety transform.
    const msg = gitFailureMessage(['log', 'only\u0007bel'], 'fatal: nope');
    assert.doesNotMatch(msg, /\u0007/, 'no raw control byte may survive');
    assert.match(msg, /^git 'log' 'only\\x07bel' failed: /);
  });

  test('multi-line git stderr collapses into a single-line message, visibly', () => {
    const msg = gitFailureMessage(['log', 'HEAD'], 'fatal: one\nhint: two');
    assert.doesNotMatch(msg, /\n/, 'an Error message stays one line');
    assert.match(msg, /fatal: one\\nhint: two/);
  });
});

describe('git() error path (real git)', () => {
  test('a failed invocation reports quoted argv and git own diagnosis', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: add a file', { 'src/a.js': 'export const a = 1;\n' });

    await assert.rejects(
      git(['log', 'nonexistent-plain'], { cwd: repo }),
      (error) => {
        assert.match(error.message, /^git 'log' 'nonexistent-plain' failed: /);
        assert.match(error.message, /unknown revision or path not in the working tree/);
        return true;
      }
    );
  });

  test('a failure whose argument carries a BEL does not produce a raw BEL', async () => {
    const repo = await makeRepo();
    await commitFiles(repo, 'feat: add a file', { 'src/a.js': 'export const a = 1;\n' });

    // On Linux, git echoes this argument back with the control byte in it; on
    // Windows the byte is neutralized before git sees it. The property under
    // test is the portable one: whatever git did, our message carries no raw BEL.
    await assert.rejects(
      git(['log', 'only\u0007bel'], { cwd: repo }),
      (error) => {
        assert.doesNotMatch(error.message, /\u0007/, 'no raw BEL may survive');
        assert.match(error.message, /^git 'log' '/);
        assert.match(error.message, /ambiguous argument/);
        return true;
      }
    );
  });

  test('allowFailure still returns empty output instead of throwing', async () => {
    const repo = await makeRepo();
    const out = await git(['log', 'nonexistent-plain'], { cwd: repo, allowFailure: true });
    assert.equal(out, '');
  });
});

describe('mergeBase', () => {
  const BS = String.fromCharCode(92);

  test('a sha256 repository still yields a merge base', async () => {
    // The audited repository chooses its own object format. Accepting only a
    // 40-char id reads a valid 64-char fork point as "nothing resolved", which
    // turns a working inference into a usage error.
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-sha256-'));
    await git(['init', '-q', '--object-format=sha256', '.'], { cwd: dir });
    await git(['config', 'user.email', 'test@example.com'], { cwd: dir });
    await git(['config', 'user.name', 'Test Author'], { cwd: dir });
    await git(['config', 'commit.gpgsign', 'false'], { cwd: dir });
    await writeFile(path.join(dir, 'a.txt'), 'one' + BS + 'n');
    await git(['add', '-A'], { cwd: dir });
    await git(['commit', '-q', '-m', 'seed'], { cwd: dir });
    const seed = (await git(['rev-parse', 'HEAD'], { cwd: dir })).trim();
    await git(['branch', 'side'], { cwd: dir });
    await writeFile(path.join(dir, 'b.txt'), 'two' + BS + 'n');
    await git(['add', '-A'], { cwd: dir });
    await git(['commit', '-q', '-m', 'main moves on'], { cwd: dir });

    assert.equal(seed.length, 64, 'the repository really is sha256 here');
    assert.equal(await mergeBase(dir, 'HEAD', 'side'), seed, 'the fork point is returned, not rejected as unparseable');
  });
});
