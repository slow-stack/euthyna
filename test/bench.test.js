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
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

  test('the adjudication pipeline closes the loop deterministically (golden)', async () => {
    // Issue #7 scenario A: the loop must be one command, and CI must be able to
    // run it without a model. The golden "adjudicator" writes the ground truth
    // into the reports (it is explicitly not blind, and must never be quoted as
    // an adjudication result), so this test verifies the plumbing: blind tree →
    // per-case reports → machine validation → scoring, end to end.
    const out = path.join(ROOT, '.scratch', `verdicts-ci-${process.pid}.json`);
    const { stdout } = await execFileAsync(
      'node',
      ['bench/adjudicate.js', '--round', '0', '--runs', '1', '--adjudicator', 'golden', '--out', out],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    assert.match(stdout, /score green/, 'the loop must end on a green score');
    assert.match(stdout, /wrote .*verdicts/, 'verdicts must be collected and written');

    // Score the same file: exit 0 only when every verdict parses and matches.
    await execFileAsync('node', ['bench/score.js', out], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
  });

  test('score.js goes red on a wrong verdict, so a broken discipline is CI-detectable', async () => {
    // The entire reason the loop must be CI-runnable: if the discipline is
    // weakened, an adjudication round comes back wrong, and score.js has to
    // fail loudly. Feed it a verdict file where every verdict is wrong.
    const ids = (await readdir(CASES, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);
    const wrong = {};
    for (const id of ids) {
      const meta = JSON.parse(await readFile(path.join(CASES, id, 'meta.json'), 'utf8'));
      wrong[id] = [meta.groundTruth === 'true_positive' ? 'FALSE POSITIVE' : 'TRUE POSITIVE'];
    }
    const file = path.join(ROOT, '.scratch', `verdicts-wrong-${process.pid}.json`);
    await writeFile(file, JSON.stringify(wrong, null, 2), 'utf8');

    await assert.rejects(
      execFileAsync('node', ['bench/score.js', file], { cwd: ROOT, encoding: 'utf8' }),
      error => error.code === 1,
      'an all-wrong verdict file must make score.js exit non-zero'
    );
  });

  test('the p6 skip set tracks the tar flavor', async () => {
    // Issue #7 scenario B: on a GNU tar platform p6's ground truth is undefined
    // (not false), so the harness must skip it with a reason — and only it. The
    // skip logic is exported so the assertion does not depend on the platform
    // this suite happens to run on.
    const { buildSkips } = createRequire(import.meta.url)('../bench/exploits.js');
    assert.equal(buildSkips('bsdtar 3.8.8').size, 0, 'on bsdtar every exploit is scorable');
    const gnu = buildSkips('tar (GNU tar) 1.34');
    assert.deepEqual([...gnu.keys()], ['p6-member-read-traversal'], 'only p6 is bsdtar-defined');
    assert.match(gnu.get('p6-member-read-traversal'), /bsdtar/, 'the skip reason names the semantics');
  });
});
