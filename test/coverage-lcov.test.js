/**
 * lcov tracefile support (`llvm-cov export --format=lcov`, gcov `.info`,
 * cargo-llvm-cov) — the Rust gap recorded in docs/case-study-rust-zh.md §7.
 *
 * The tracefile is text and *does* carry function names, so unlike a Go profile
 * this path needs no source tree. The price is that the names are mangled, so
 * the matching runs on the mangled form. The behaviour worth defending is the
 * same as in the other coverage suites — what the producer refuses to say —
 * plus the lcov-specific refusals: a function with no count at all, a file
 * absent from the tracefile, a file with no function table, and a record whose
 * body does not parse.
 *
 * The fixture shape is copied from a real tracefile: a probe crate built with
 * `RUSTFLAGS=-C instrument-coverage`, run under `cargo test`, merged with
 * `llvm-profdata merge -sparse`, exported with `llvm-cov export --format=lcov`.
 * The mangled names below are that run's output, not invented strings.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  collectCoverageFacts,
  loadCoverage,
  detectCoverageFormat,
  parseLcov,
  lcovSymbolMatches,
  lcovSymbolNeedle
} from '../src/facts/coverage.js';
import { STATUS } from '../src/contract.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'euthyna-cov-lcov-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const CRATE_HASH = 'CsVynAXQWAN6';

/** Write a tracefile fixture and hand back its path. */
async function writeLcov(name, text) {
  const file = path.join(dir, name);
  await writeFile(file, text, 'utf8');
  return file;
}

const LIB = () => path.join(dir, 'src', 'lib.rs');
const OTHER = () => path.join(dir, 'src', 'other.rs');

/** The single function entry for `symbol` in `file`, from a parsed tracefile. */
function fnEntry(parsed, file, symbol) {
  return parsed.files.get(file)?.functions.get(symbol);
}

/**
 * One record for a module with three same-or-differently-qualified names:
 * top-level `dup`, `nested::dup`, and a never-invoked `never_called`.
 */
function tracefile() {
  return [
    `SF:${LIB()}`,
    `FN:3,_RNv${CRATE_HASH}_10lcov_probe7long_fn`,
    `FN:28,_RNv${CRATE_HASH}_10lcov_probe3dup`,
    `FN:23,_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`,
    `FN:11,_RNv${CRATE_HASH}_10lcov_probe12never_called`,
    `FN:48,_RINv${CRATE_HASH}_10lcov_probe10generic_fnReEB2_`,
    `FN:48,_RINv${CRATE_HASH}_10lcov_probe10generic_fnlEB2_`,
    `FN:64,_RNvXs_${CRATE_HASH}_10lcov_probeNtB4_4GearNtB4_6Widget5label`,
    `FNDA:1,_RNv${CRATE_HASH}_10lcov_probe7long_fn`,
    `FNDA:1,_RNv${CRATE_HASH}_10lcov_probe3dup`,
    `FNDA:1,_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`,
    `FNDA:0,_RNv${CRATE_HASH}_10lcov_probe12never_called`,
    `FNDA:1,_RINv${CRATE_HASH}_10lcov_probe10generic_fnReEB2_`,
    `FNDA:1,_RINv${CRATE_HASH}_10lcov_probe10generic_fnlEB2_`,
    `FNDA:1,_RNvXs_${CRATE_HASH}_10lcov_probeNtB4_4GearNtB4_6Widget5label`,
    'FNF:7',
    'FNH:6',
    'DA:3,1',
    'DA:11,0',
    'DA:28,1',
    'LF:3',
    'LH:2',
    'BRF:0',
    'BRH:0',
    'end_of_record',
    `SF:${OTHER()}`,
    `FN:1,_RNvNt${CRATE_HASH}_10lcov_probe5other13only_in_other`,
    'FNDA:0,_RNvNt' + CRATE_HASH + '_10lcov_probe5other13only_in_other',
    'FNF:1',
    'FNH:0',
    'DA:1,0',
    'LF:1',
    'LH:0',
    'end_of_record'
  ].join('\n');
}

describe('lcov tracefiles', () => {
  test('the loader identifies a tracefile by shape and names the format', async () => {
    const file = await writeLcov('basic.info', tracefile());
    const coverage = await loadCoverage(file);
    assert.equal(coverage.__lcov, true);
    assert.equal(coverage.files.size, 2);
    assert.equal(detectCoverageFormat(coverage), 'lcov');
  });

  test('an invoked function yields unknown, never "executed"', async () => {
    const file = await writeLcov('invoked.info', tracefile());
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'long_fn', file: LIB() }]
    });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.UNKNOWN);
    assert.equal(facts[0].detail.reason, 'nonzero_count_cannot_prove_call_site_execution');
    assert.equal(facts[0].evidence.line, 3);
    assert.equal(facts[0].method, 'command');
    // The whole point of the producer: nothing here says a call site ran.
    assert.doesNotMatch(JSON.stringify(facts[0]), /"status":\s*"executed"/i);
  });

  test('a zero count is established as never invoked, with the mangled name on record', async () => {
    const file = await writeLcov('zero.info', tracefile());
    const { facts, evaluated, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'never_called', file: LIB() }]
    });
    assert.equal(measured, true);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].detail.reason, 'invocation_count_zero');
    assert.equal(facts[0].detail.invocationCount, 0);
    assert.equal(facts[0].evidence.line, 11);
    assert.equal(facts[0].detail.mangled, `_RNv${CRATE_HASH}_10lcov_probe12never_called`);
    assert.equal(evaluated[0].format, 'lcov');
  });

  test('a bare name matching two symbols reports both, each naming its own symbol', async () => {
    const file = await writeLcov('bare.info', tracefile());
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'dup', file: LIB() }]
    });
    assert.equal(facts.length, 2);
    const mangled = facts.map(f => f.detail.mangled).sort();
    assert.deepEqual(mangled, [
      `_RNv${CRATE_HASH}_10lcov_probe3dup`,
      `_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`
    ].sort());
    for (const fact of facts) {
      // Each fact names which of the two it is about — never a claim about "dup" at large.
      assert.match(fact.statement, /本次查询匹配到 2 个符号/);
      assert.ok(fact.statement.includes(fact.detail.mangled));
    }
  });

  test('a module-qualified query answers for exactly one of two same-named functions', async () => {
    const file = await writeLcov('qualified.info', tracefile());
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'nested::dup', file: LIB() }]
    });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].detail.mangled, `_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`);
    assert.equal(facts[0].evidence.line, 23);
  });

  test('one generic function instantiated twice reports one fact per instantiation', async () => {
    const file = await writeLcov('generic.info', tracefile());
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'generic_fn', file: LIB() }]
    });
    assert.equal(facts.length, 2);
    for (const fact of facts) assert.equal(fact.evidence.line, 48);
    assert.deepEqual(
      facts.map(f => f.detail.mangled).sort(),
      [
        `_RINv${CRATE_HASH}_10lcov_probe10generic_fnReEB2_`,
        `_RINv${CRATE_HASH}_10lcov_probe10generic_fnlEB2_`
      ]
    );
  });

  test('a trait impl answers both for the type-qualified and the bare method name', async () => {
    const file = await writeLcov('trait.info', tracefile());
    const byType = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'Gear::label', file: LIB() }]
    });
    const bare = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'label', file: LIB() }]
    });
    assert.equal(byType.facts.length, 1);
    assert.equal(bare.facts.length, 1);
    assert.equal(byType.facts[0].detail.mangled, bare.facts[0].detail.mangled);
  });

  test('an already-mangled query is matched exactly and never half-decoded', async () => {
    const file = await writeLcov('mangled.info', tracefile());
    const exact = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: `_RNv${CRATE_HASH}_10lcov_probe7long_fn`, file: LIB() }]
    });
    assert.equal(exact.facts.length, 1);
    assert.equal(exact.facts[0].detail.invocationCount, 1);

    const partial = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: `_RNv${CRATE_HASH}_10lcov_probe7long`, file: LIB() }]
    });
    assert.equal(partial.facts.length, 1);
    assert.equal(partial.facts[0].detail.reason, 'symbol_not_located_in_fnmap');
  });

  test('a function with an FN line and no FNDA line is not evaluated, never "never invoked"', async () => {
    const file = await writeLcov(
      'nofnda.info',
      [`SF:${LIB()}`, `FN:9,_RNv${CRATE_HASH}_10lcov_probe5ghost`, 'FNF:1', 'FNH:0', 'end_of_record'].join('\n')
    );
    const { facts, notEvaluated, evaluated, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'ghost', file: LIB() }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(evaluated.length, 0);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /缺失的计数不是 0/);
  });

  test('an FNDA with no FN line keeps its count and leaves the line unknown', async () => {
    const parsed = parseLcov(
      [`SF:${LIB()}`, `FNDA:0,_RNv${CRATE_HASH}_10lcov_probe7orphan`, 'end_of_record'].join('\n')
    );
    assert.equal(parsed.files.size, 1);
    const orphan = parsed.files.get(LIB()).functions.get(`_RNv${CRATE_HASH}_10lcov_probe7orphan`);
    // The count is in the file, so it is kept; only the line is unknown.
    assert.deepEqual(orphan, { line: null, count: 0 });
  });

  test('two records for one file merge by summing, never by overwriting', async () => {
    const symbol = `_RNv${CRATE_HASH}_10lcov_probe7split`;
    const zeroThenTwo = parseLcov(
      [
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        `FNDA:0,${symbol}`,
        'end_of_record',
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        `FNDA:2,${symbol}`,
        'end_of_record'
      ].join('\n')
    );
    // Summing is the one merge that cannot turn a nonzero count into zero, and
    // zero is the only conclusion this producer draws.
    assert.equal(fnEntry(zeroThenTwo, LIB(), symbol).count, 2);

    const twoThenZero = parseLcov(
      [
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        `FNDA:2,${symbol}`,
        'end_of_record',
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        `FNDA:0,${symbol}`,
        'end_of_record'
      ].join('\n')
    );
    assert.equal(fnEntry(twoThenZero, LIB(), symbol).count, 2);
  });

  test('a missing count stays missing when records merge — null is not a zero', () => {
    const symbol = `_RNv${CRATE_HASH}_10lcov_probe7maybe`;
    const parsed = parseLcov(
      [
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        `FNDA:4,${symbol}`,
        'end_of_record',
        `SF:${LIB()}`,
        `FN:1,${symbol}`,
        'end_of_record' // no FNDA at all
      ].join('\n')
    );
    // 4 + null must not collapse to 4 (a count from one record is not a count for
    // the file) and must not become 0 — 0 is the only number this producer draws
    // a conclusion from, so a wrong zero here would fabricate a real finding.
    assert.equal(fnEntry(parsed, LIB(), symbol).count, null);
  });

  test('a duplicate FN line keeps the first line rather than the last', () => {
    const symbol = `_RNv${CRATE_HASH}_10lcov_probe7twice`;
    const parsed = parseLcov(
      [`SF:${LIB()}`, `FN:1,${symbol}`, `FN:9,${symbol}`, `FNDA:0,${symbol}`, 'end_of_record'].join('\n')
    );
    // The line ends up in the fact's evidence, so which one wins is not cosmetic.
    assert.equal(fnEntry(parsed, LIB(), symbol).line, 1);
  });

  test('two FNDA lines for one symbol sum rather than the last one winning', () => {
    const symbol = `_RNv${CRATE_HASH}_10lcov_probe7twice`;
    const parsed = parseLcov(
      [`SF:${LIB()}`, `FN:1,${symbol}`, `FNDA:3,${symbol}`, `FNDA:4,${symbol}`, 'end_of_record'].join('\n')
    );
    assert.equal(fnEntry(parsed, LIB(), symbol).count, 7);
  });

  test('a file absent from the tracefile is not evaluated, not "never executed"', async () => {
    const file = await writeLcov('absent.info', tracefile());
    const missing = path.join(dir, 'src', 'not_instrumented.rs');
    const { facts, notEvaluated, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'anything', file: missing }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /「未出现」不能当「未执行」/);
    // Deliberately the opposite of the c8 path, where absence is established. A
    // notEvaluated entry is not a fact and carries no status field at all, so this
    // asserts that absence — "not established" would hold even for a malformed
    // entry, because the field does not exist to be compared.
    assert.equal('status' in notEvaluated[0], false);
  });

  test('a symbol that is not in the table is unknown, and says why a mangled name may not match', async () => {
    const file = await writeLcov('unlocated.info', tracefile());
    const { facts, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'no_such_fn', file: LIB() }]
    });
    assert.equal(measured, true);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.UNKNOWN);
    assert.equal(facts[0].detail.reason, 'symbol_not_located_in_fnmap');
    assert.equal(facts[0].method, 'static');
    assert.match(facts[0].statement, /lcov 的 FN: 名是 mangled 的/);
    // The needle it tried is in the statement, so a reader can see what was looked for.
    assert.ok(facts[0].statement.includes('10no_such_fn'));
  });

  test('a tracefile with no function table is not evaluated — line data cannot answer a symbol question', async () => {
    const file = await writeLcov(
      'linesonly.info',
      [`SF:${LIB()}`, 'DA:1,1', 'DA:2,0', 'LF:2', 'LH:1', 'end_of_record'].join('\n')
    );
    const { facts, notEvaluated, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'anything', file: LIB() }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /没有任何 FN: 行/);
  });

  test('a query answered only by refusals is measured: false, never clean', async () => {
    const file = await writeLcov('refusals.info', tracefile());
    const { facts, evaluated, measured } = await collectCoverageFacts({
      coverageFile: file,
      targets: [
        { symbol: 'anything', file: path.join(dir, 'src', 'absent_a.rs') },
        { symbol: 'anything', file: path.join(dir, 'src', 'absent_b.rs') }
      ]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(evaluated.length, 0, 'a query that produced no fact was not answered');
  });

  test('a bare name with no file restriction still searches every record', async () => {
    const file = await writeLcov('unrestricted.info', tracefile());
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'only_in_other' }]
    });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].evidence.file, OTHER());
  });

  test('comments and summary lines are recognised and ignored, not treated as unknown keys', async () => {
    const parsed = parseLcov(
      [
        'TN:',
        `SF:${LIB()}`,
        `FN:5,_RNv${CRATE_HASH}_10lcov_probe5hello`,
        `FNDA:1,_RNv${CRATE_HASH}_10lcov_probe5hello`,
        'FNF:1',
        'FNH:1',
        'BRDA:5,0,0,1',
        'LF:1',
        'LH:1',
        'end_of_record'
      ].join('\n')
    );
    assert.equal(parsed.files.size, 1);
    assert.deepEqual(
      fnEntry(parsed, LIB(), `_RNv${CRATE_HASH}_10lcov_probe5hello`),
      { line: 5, count: 1 }
    );
  });

  test('a malformed body is refused with a reason, not interpreted', async () => {
    for (const [name, text] of [
      ['unclosed.info', `SF:${LIB()}\nFN:1,_RNa\n`],
      ['fnoutofrec.info', `TN:\nFN:1,_RNa\nSF:${LIB()}\nend_of_record\n`],
      ['fnbadvalue.info', `SF:${LIB()}\nFN:notanumber,_RNa\nend_of_record\n`],
      ['nosf.info', 'FNF:0\nend_of_record\n']
    ]) {
      const file = await writeLcov(name, text);
      const { facts, notEvaluated, measured } = await collectCoverageFacts({
        coverageFile: file,
        targets: [{ symbol: 'anything', file: LIB() }]
      });
      assert.equal(facts.length, 0, name);
      assert.equal(measured, false, name);
      assert.equal(notEvaluated.length, 1, name);
      assert.match(notEvaluated[0].reason, /无法读取覆盖率数据|cannot read coverage data/, name);
    }
  });

  test('the newer FNL/FNA encoding is refused rather than read out of a guessed shape', async () => {
    for (const key of ['FNL', 'FNA', 'FNAB']) {
      const file = await writeLcov(
        `newenc-${key}.info`,
        [`SF:${LIB()}`, `${key}:1,2,_RNv${CRATE_HASH}_10lcov_probe5hello`, 'end_of_record'].join('\n')
      );
      const { facts, notEvaluated, measured } = await collectCoverageFacts({
        coverageFile: file,
        targets: [{ symbol: 'hello', file: LIB() }]
      });
      assert.equal(facts.length, 0, key);
      assert.equal(measured, false, key);
      assert.match(notEvaluated[0].reason, /无法读取覆盖率数据/, key);
    }
  });

  test('the parser refuses each unaccounted-for line instead of skipping it', () => {
    const bad = [
      `SF:${LIB()}\nFN:1,_RNa\n`, // unclosed
      `FN:1,_RNa\nSF:${LIB()}\nend_of_record\n`, // function before any record
      `SF:${LIB()}\nFN:nope,_RNa\nend_of_record\n`, // FN value is not "<line>,<name>"
      `SF:${LIB()}\n  FN:1,_RNa\nend_of_record\n`, // indented: not an lcov line
      `SF:${LIB()}\nFNL:1,2,_RNa\nend_of_record\n`, // unsupported encoding
      'TN:\nend_of_record\n', // no SF record at all
      `SF:${LIB()}\nFN:1,_RNa\nSF:${OTHER()}\nend_of_record\n` // second SF inside a record
    ];
    for (const text of bad) assert.equal(parseLcov(text), null, JSON.stringify(text));
  });

  test('a closed record followed by an unclosed one is refused, not half-read', () => {
    // The lone-unclosed case above is caught by the "no SF: record at all" guard,
    // so it does not exercise the EOF guard: with one *complete* record already in
    // hand, dropping the trailing record would look like success. Measured against
    // the shipped parser — refusing is what keeps the second record's functions
    // out of the answer instead of silently absent from it.
    const text = [
      `SF:${LIB()}`,
      `FN:1,_RNv${CRATE_HASH}_10lcov_probe5first`,
      `FNDA:1,_RNv${CRATE_HASH}_10lcov_probe5first`,
      'end_of_record',
      `SF:${OTHER()}`,
      `FN:2,_RNv${CRATE_HASH}_10lcov_probe6second`,
      `FNDA:0,_RNv${CRATE_HASH}_10lcov_probe6second`
      // no end_of_record
    ].join('\n');
    assert.equal(parseLcov(text), null);
  });

  test('a symbol query needs no --source: the tracefile carries the names', async () => {
    const file = await writeLcov('nosource.info', tracefile());
    const withSource = await collectCoverageFacts({
      coverageFile: file,
      source: dir,
      targets: [{ symbol: 'never_called', file: LIB() }]
    });
    const without = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'never_called', file: LIB() }]
    });
    assert.equal(withSource.facts.length, 1);
    assert.equal(without.facts.length, 1);
    assert.deepEqual(without.facts[0].status, withSource.facts[0].status);
  });

  test('a missing file is not evaluated, never "not covered"', async () => {
    const { facts, notEvaluated, measured } = await collectCoverageFacts({
      coverageFile: path.join(dir, 'nope.info'),
      targets: [{ symbol: 'x', file: LIB() }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
  });

  test('a path query states the symbol it resolved to, not the pattern', async () => {
    const file = await writeLcov(
      'subject.info',
      [
        `SF:${LIB()}`,
        `FN:28,_RNv${CRATE_HASH}_10lcov_probe3dup`,
        `FN:23,_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`,
        `FNDA:1,_RNv${CRATE_HASH}_10lcov_probe3dup`,
        `FNDA:0,_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`,
        'FNF:2',
        'FNH:1',
        'end_of_record'
      ].join('\n')
    );
    const { facts } = await collectCoverageFacts({
      coverageFile: file,
      targets: [{ symbol: 'lcov_probe::nested::dup', file: LIB() }]
    });
    // A `::` query is a pattern, so the statement names the symbol that matched:
    // "Symbol lcov_probe::nested::dup was never invoked" would claim something
    // about a name the tracefile does not carry.
    assert.equal(facts.length, 1);
    assert.match(facts[0].statement, /_RNvNt/);
    assert.doesNotMatch(facts[0].statement, /lcov_probe::nested::dup/);
    assert.equal(facts[0].detail.mangled, `_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`);
  });
});

describe('lcov symbol matching', () => {
  const name = mangled => `_RNvNt${CRATE_HASH}_10lcov_probe6${mangled}`;

  test('a segment is looked up as <byte length><segment>', () => {
    assert.equal(lcovSymbolNeedle(['dup']), '3dup');
    assert.equal(lcovSymbolNeedle(['nested', 'dup']), '6nested3dup');
    // Lengths are bytes, not code points: a non-ASCII identifier still works.
    assert.equal(lcovSymbolNeedle(['名']), '3名');
  });

  test('segments are anchored at the start, after a mangling separator, or at a proven pair boundary', () => {
    assert.equal(lcovSymbolMatches(['dup'], `${name('nested3dup')}`), true);
    assert.equal(lcovSymbolMatches(['dup'], `_RNv${CRATE_HASH}_10lcov_probe7xyz3dup`), false);
    assert.equal(lcovSymbolMatches(['bump'], `_RNvMCsVynAXQWAN6_10lcov_probeNtB2_7Counter4bump`), true);
  });

  test('segments match independently, so a disambiguator between them is tolerated', () => {
    // A #[cfg(test)] module comes out as `testss_`, not `tests`; a concatenated
    // needle would miss this outright.
    assert.equal(
      lcovSymbolMatches(['tests', 'exercises_some'], `_RNvNt${CRATE_HASH}_10lcov_probe5testss_14exercises_some`),
      true
    );
  });

  test('a qualified query does not answer for the same name in another module', () => {
    assert.equal(lcovSymbolMatches(['nested', 'dup'], `_RNv${CRATE_HASH}_10lcov_probe3dup`), false);
  });

  test('an already-mangled query is matched exactly', () => {
    const mangled = `_RNv${CRATE_HASH}_10lcov_probe7long_fn`;
    assert.equal(lcovSymbolMatches([mangled], mangled), true);
    assert.equal(lcovSymbolMatches([mangled.slice(0, -3)], mangled), false);
  });

  test('an empty segment list matches nothing but does not throw', () => {
    assert.equal(lcovSymbolMatches([], `_RNv${CRATE_HASH}_10lcov_probe3dup`), false);
  });

  test('a query never answers for an identifier that sits inside a longer one', () => {
    // Measured on a real `llvm-cov export` tracefile: `get` and `cfg_3get` are two
    // functions, and `8cfg_3get` is itself a complete `<len><value>` pair, so
    // `3get` sits inside an identifier rather than at a boundary. Before the
    // containment guard a query for `get` reported "Symbol get was not invoked
    // even once" about `cfg_3get` — an established fact about a function nobody
    // asked about, and false about `get`, which had been called once.
    const get = '_RNvCsi8SMnIpCoEi_13collide_probe3get';
    const cfg = '_RNvCsi8SMnIpCoEi_13collide_probe8cfg_3get';
    assert.equal(lcovSymbolMatches(['get'], get), true);
    assert.equal(lcovSymbolMatches(['get'], cfg), false);
    assert.equal(lcovSymbolMatches(['collide_probe', 'get'], get), true);
    assert.equal(lcovSymbolMatches(['collide_probe', 'get'], cfg), false);
    // The collision name is still reachable on its own — the guard rejects a
    // needle that lands inside a longer identifier, not the identifier itself.
    assert.equal(lcovSymbolMatches(['cfg_3get'], cfg), true);
  });

  test('each repeated segment consumes the name it matched', () => {
    // The cursor advances past every match, so one identifier cannot satisfy two
    // segments of the same query.
    assert.equal(lcovSymbolMatches(['a', 'a'], '1a'), false);
    assert.equal(lcovSymbolMatches(['a', 'a'], '_RNv__1a1a'), true);
  });

  test('a qualified query may skip components between its segments', () => {
    // A trait method's path carries its Self type — `Gear::Widget::label` — so
    // `Gear::label` names a subsequence. Measured: the contiguous form of this
    // matcher rejected it against the real tracefiles, which is why the segments
    // are matched independently rather than as one concatenated needle.
    const label = `_RNvXs_${CRATE_HASH}_10lcov_probeNtB4_4GearNtB4_6Widget5label`;
    assert.equal(lcovSymbolMatches(['Gear', 'label'], label), true);
    assert.equal(lcovSymbolMatches(['Widget', 'label'], label), true);
    assert.equal(lcovSymbolMatches(['Gear', 'Widget', 'label'], label), true);
  });

  test('a qualified query is a subsequence test, not a path-exact one', () => {
    // Recorded rather than hidden: `lcov_probe::dup` also answers for
    // `lcov_probe::nested::dup`. Each fact names the symbol it is about, so a
    // reader can tell the two apart; narrowing this further would need the
    // mangling's grammar.
    const outer = `_RNv${CRATE_HASH}_10lcov_probe3dup`;
    const nested = `_RNvNt${CRATE_HASH}_10lcov_probe6nested3dup`;
    assert.equal(lcovSymbolMatches(['lcov_probe', 'dup'], outer), true);
    assert.equal(lcovSymbolMatches(['lcov_probe', 'dup'], nested), true);
  });
});
