/**
 * Coverage facts.
 *
 * The behaviour worth defending here is what the producer refuses to say. A
 * non-zero invocation count must never become "executed", because V8 reports
 * some unreachable code as covered and that error points the dangerous way.
 * These tests fail if anyone ever adds an "executed" outcome.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectCoverageFacts } from '../src/facts/coverage.js';
import { STATUS, KIND } from '../src/contract.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'euthyna-cov-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Build a coverage-final.json shaped the way c8 actually emits it. */
async function writeCoverage(name, entries) {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(entries), 'utf8');
  return file;
}

function entry(filePath, functions) {
  const fnMap = {};
  const f = {};
  functions.forEach((fn, index) => {
    fnMap[String(index)] = {
      name: fn.name,
      decl: { start: { line: fn.line, column: 0 }, end: { line: fn.line, column: 1 } },
      loc: { start: { line: fn.line, column: 0 }, end: { line: fn.line, column: 1 } },
      line: fn.line
    };
    f[String(index)] = fn.count;
  });
  // The real shape has no istanbul `hash` and does have `all`; include both so a
  // consumer written against the wrong field list is caught here.
  return [
    filePath,
    { path: filePath, all: true, statementMap: {}, s: {}, branchMap: {}, b: {}, fnMap, f }
  ];
}

describe('coverage facts', () => {
  test('an invocation count of zero is reported as established', async () => {
    const file = await writeCoverage('zero.json', Object.fromEntries([
      entry('/proj/src/guard.js', [{ name: 'checkPermission', line: 12, count: 0 }])
    ]));

    const { facts, evaluated } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'checkPermission' }]
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].kind, KIND.TEST_COVERAGE);
    assert.equal(facts[0].detail.invocationCount, 0);
    assert.match(facts[0].statement, /一次都没有被调用/);
    assert.equal(facts[0].evidence.line, 12);
    assert.ok(facts[0].command.startsWith('euthyna coverage'), 'the fact must be reproducible');
    assert.equal(evaluated[0].count, 1);
  });

  test('a non-zero count yields unknown, never "executed"', async () => {
    const file = await writeCoverage('nonzero.json', Object.fromEntries([
      entry('/proj/src/guard.js', [{ name: 'checkPermission', line: 12, count: 7 }])
    ]));

    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'checkPermission' }]
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.UNKNOWN);
    assert.equal(facts[0].detail.invocationCount, 7);
    assert.match(facts[0].statement, /不能\*\*证明任何特定调用点执行过/);
    // This is the assertion that matters: the word must not appear as a claim.
    assert.ok(
      !/status"?\s*:?\s*"?executed/i.test(JSON.stringify(facts[0])),
      'an "executed" outcome must not be reachable from this producer'
    );
  });

  test('a file absent from the coverage report is treated as never loaded', async () => {
    const file = await writeCoverage('other.json', Object.fromEntries([
      entry('/proj/src/unrelated.js', [{ name: 'other', line: 1, count: 3 }])
    ]));

    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'ghost', file: '/proj/src/ghost.js' }]
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].detail.reason, 'file_absent_from_coverage');
    assert.match(facts[0].statement, /没有被加载|未被加载/);
  });

  test('an empty coverage object is reported as not evaluated, not as clean', async () => {
    const file = await writeCoverage('empty.json', {});

    const { facts, notEvaluated } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'anything' }]
    });

    assert.equal(facts.length, 0);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /空对象/);
    assert.match(notEvaluated[0].reason, /--all/, 'the common cause should be named');
  });

  test('an unreadable coverage file is not evaluated, with the errno in the reason', async () => {
    const { facts, notEvaluated } = await collectCoverageFacts({
      coverageFile: path.join(dir, 'does-not-exist.json'),
      targets: [{ symbol: 'x' }]
    });

    assert.equal(facts.length, 0);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /ENOENT|无法读取/);
    assert.match(notEvaluated[0].reason, /「未评估」，不是「未被覆盖」/);
  });

  test('a file matching c8 default excludes is flagged before the answer is trusted', async () => {
    const file = await writeCoverage('excl.json', Object.fromEntries([
      entry('/proj/test/helpers.js', [{ name: 'helper', line: 1, count: 0 }])
    ]));

    const { notEvaluated } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'helper', file: 'test/helpers.js' }]
    });

    assert.ok(
      notEvaluated.some(n => /c8 的默认排除规则/.test(n.reason)),
      'a file that c8 excludes by default would silently vanish from the report'
    );
  });

  test('a symbol that cannot be located is unknown, with the reason spelled out', async () => {
    const file = await writeCoverage('noloc.json', Object.fromEntries([
      entry('/proj/src/a.js', [{ name: 'present', line: 1, count: 1 }])
    ]));

    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'renamedOrInlined' }]
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.UNKNOWN);
    assert.equal(facts[0].detail.reason, 'symbol_not_located_in_fnmap');
    assert.match(facts[0].statement, /branchMap/, 'the module-level explanation should be given');
  });

  test('the same symbol in two files produces one fact per file', async () => {
    const file = await writeCoverage('dupe.json', Object.fromEntries([
      entry('/proj/src/a.js', [{ name: 'shared', line: 1, count: 0 }]),
      entry('/proj/src/b.js', [{ name: 'shared', line: 1, count: 4 }])
    ]));

    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'shared' }]
    });

    assert.equal(facts.length, 2);
    assert.deepEqual(
      facts.map(f => f.status).sort(),
      [STATUS.ESTABLISHED, STATUS.UNKNOWN]
    );
  });

  test('no symbols requested is recorded as not evaluated', async () => {
    const file = await writeCoverage('nosym.json', Object.fromEntries([
      entry('/proj/src/a.js', [{ name: 'a', line: 1, count: 1 }])
    ]));

    const { facts, notEvaluated } = await collectCoverageFacts({ coverageFile: file, targets: [] });
    assert.equal(facts.length, 0);
    assert.ok(notEvaluated.some(n => /没有指定要查询的符号/.test(n.reason)));
  });
});
