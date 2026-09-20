/**
 * The benchmark's ground truth is a claim about the cases, so it gets tested
 * like any other claim.
 *
 * If someone edits a case and breaks its exploitability - removes a guard from
 * a "guarded" case, or makes a "vulnerable" case safe - the scores computed
 * from that case become meaningless while still looking plausible. This test
 * exists so that failure is loud at the point of the edit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CASES = path.join(ROOT, 'bench', 'cases');

async function runExploits() {
  try {
    const { stdout } = await execFileAsync('node', [path.join('bench', 'exploits.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '' };
  }
}

/**
 * The exploit expectations are defined against bsdtar's operand semantics
 * (see bench/README.md): the `@`-archive merge and the treatment of bare
 * `..` members are libarchive behaviour that GNU tar does not share. On a
 * platform whose `tar` is GNU tar the test reports itself as skipped, with
 * the reason, rather than failing — the ground truth is not broken there,
 * it is simply not defined for that binary. Where `tar` is bsdtar (the
 * development machine, the Windows CI runners) it still runs.
 */
async function tarFlavor() {
  try {
    const { stdout } = await execFileAsync('tar', ['--version'], { encoding: 'utf8' });
    return stdout.split('\n')[0].trim();
  } catch (error) {
    return `unavailable (${String(error.message).split('\n')[0]})`;
  }
}

describe('benchmark ground truth', () => {
  test('every exploit expectation holds', async t => {
    const flavor = await tarFlavor();
    if (!flavor.includes('bsdtar')) {
      t.skip(
        `the exploit ground truth is defined against bsdtar, not "${flavor}" — ` +
          'run node bench/exploits.js on a bsdtar machine to verify it'
      );
      return;
    }
    const { code, stdout } = await runExploits();
    assert.equal(
      code,
      0,
      `bench/exploits.js is red, so the ground truth is not trustworthy:\n${stdout}`
    );
    // The count is derived, not hardcoded: a case directory without an exploit
    // entry, or an exploit without a case, must fail here too.
    const caseCount = (await readdir(CASES, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .length;
    const match = stdout.match(/(\d+)\/(\d+) expectations held/);
    assert.ok(match, 'exploits.js must report its expectation count');
    assert.equal(match[1], match[2], 'every expectation must hold');
    assert.equal(
      Number(match[1]),
      caseCount,
      'exploits.js must run exactly one expectation per case directory'
    );
  });

  test('every case declares a ground truth and a reason', async () => {
    const ids = (await readdir(CASES, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);

    assert.ok(ids.length >= 8, 'the benchmark should keep a meaningful number of cases');

    for (const id of ids) {
      const meta = JSON.parse(await readFile(path.join(CASES, id, 'meta.json'), 'utf8'));
      assert.ok(
        ['true_positive', 'false_positive'].includes(meta.groundTruth),
        `${id}: groundTruth must be true_positive or false_positive`
      );
      assert.ok(meta.why && meta.why.length > 40, `${id}: needs a substantive "why"`);
      assert.ok(meta.establishedBy, `${id}: needs to say how the truth was established`);
    }
  });

  test('the true and false sets are balanced enough to be informative', async () => {
    const ids = (await readdir(CASES, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);

    let trues = 0;
    let falses = 0;
    for (const id of ids) {
      const meta = JSON.parse(await readFile(path.join(CASES, id, 'meta.json'), 'utf8'));
      if (meta.groundTruth === 'true_positive') trues++;
      else falses++;
    }

    // A benchmark that is almost all one class scores well on a system that
    // always answers that class, so neither side may be a token presence.
    assert.ok(trues >= 4, `only ${trues} true cases: a always-false adjudicator would look good`);
    assert.ok(falses >= 4, `only ${falses} false cases`);
  });

  test('the blind copy contains no answers', async () => {
    await execFileAsync('node', [path.join('bench', 'prepare-blind.js')], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    const blind = path.join(ROOT, '.scratch', 'blind');
    const found = [];
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.name === 'meta.json') found.push(p);
      }
    };
    await walk(blind);

    assert.deepEqual(found, [], 'the answer must be absent from the blind tree, not merely off-limits');

    // Opaque ids only: a directory named after the answer defeats the blindness.
    const ids = (await readdir(blind, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);
    for (const id of ids) {
      assert.match(id, /^case-\d{2}$/, `blind id "${id}" reveals something`);
    }
  });
});
