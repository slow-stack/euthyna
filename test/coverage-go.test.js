/**
 * Go coverage profile support (`go test -coverprofile`).
 *
 * The profile is text and carries no function names, so the two-state mapping
 * runs through function ranges parsed from the gofmt'd source. The behaviour
 * worth defending is the same as in coverage.test.js — what the producer
 * refuses to say — plus the Go-specific refusals: no --source, a file absent
 * from the profile (it may simply not be in the test binary), and a body that
 * does not parse.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectCoverageFacts, parseGoProfile, goFunctionRanges } from '../src/facts/coverage.js';
import { STATUS } from '../src/contract.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'euthyna-cov-go-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A tiny gofmt'd module: two top-level funcs, one method, one generic. */
const A_GO = [
  'package pkg',
  '',
  'func Called(n int) int {',
  '\treturn n + 1',
  '}',
  '',
  'func NeverCalled(n int) int {',
  '\treturn n * 2',
  '}',
  '',
  'type T struct{}',
  '',
  'func (t *T) Method() int {',
  '\treturn 1',
  '}',
  '',
  'func Generic[T any](v T) T {',
  '\treturn v',
  '}'
].join('\n');

const PROFILE_LINES = [
  'mode: set',
  'example.com/mini/pkg/a.go:3.24,4.13 1 1', // inside Called -> invoked
  'example.com/mini/pkg/a.go:7.29,8.13 1 0', // inside NeverCalled -> never
  'example.com/mini/pkg/a.go:13.24,14.11 1 1' // inside Method -> invoked
].join('\n');

describe('Go coverage profiles', () => {
  let goRoot;

  before(async () => {
    goRoot = path.join(dir, 'mini');
    await mkdir(path.join(goRoot, 'pkg'), { recursive: true });
    await writeFile(path.join(goRoot, 'go.mod'), 'module example.com/mini\n\ngo 1.22\n', 'utf8');
    await writeFile(path.join(goRoot, 'pkg', 'a.go'), A_GO, 'utf8');
  });

  test('parseGoProfile reads blocks and rejects a malformed body', () => {
    const parsed = parseGoProfile(PROFILE_LINES);
    assert.equal(parsed.mode, 'set');
    assert.equal(parsed.files.get('example.com/mini/pkg/a.go').length, 3);
    assert.equal(parseGoProfile('mode: set\nnot a block line'), null);
  });

  test('goFunctionRanges maps methods by bare name and handles generics', () => {
    const ranges = goFunctionRanges(A_GO);
    assert.deepEqual(ranges.map(r => r.name), ['Called', 'NeverCalled', 'Method', 'Generic']);
    assert.deepEqual([ranges[0].startLine, ranges[0].endLine], [3, 5]);
  });

  test('a never-invoked function is established, resolved through the go.mod module prefix', async () => {
    const profile = path.join(dir, 'go-never.out');
    await writeFile(profile, PROFILE_LINES, 'utf8');
    const { facts } = await collectCoverageFacts({
      coverageFile: profile,
      source: goRoot,
      targets: [{ symbol: 'NeverCalled' }]
    });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].evidence.file, 'example.com/mini/pkg/a.go');
    assert.equal(facts[0].evidence.line, 7);
  });

  test('an invoked function yields unknown, never "executed"', async () => {
    const profile = path.join(dir, 'go-invoked.out');
    await writeFile(profile, PROFILE_LINES, 'utf8');
    const { facts } = await collectCoverageFacts({
      coverageFile: profile,
      source: goRoot,
      targets: [{ symbol: 'Called' }, { symbol: 'Method' }]
    });
    assert.equal(facts.length, 2);
    for (const f of facts) {
      assert.equal(f.status, STATUS.UNKNOWN);
      assert.ok(!/"status":\s*"executed"/i.test(JSON.stringify(f)));
    }
  });

  test('no --source is not evaluated, never an answer', async () => {
    const profile = path.join(dir, 'go-nosource.out');
    await writeFile(profile, PROFILE_LINES, 'utf8');
    const { facts, notEvaluated, measured } = await collectCoverageFacts({
      coverageFile: profile,
      targets: [{ symbol: 'Called' }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.ok(notEvaluated.some(n => /--source/.test(n.reason)));
  });

  test('a file absent from the profile is not evaluated, not "never executed"', async () => {
    const profile = path.join(dir, 'go-absent.out');
    await writeFile(profile, PROFILE_LINES, 'utf8');
    const { facts, notEvaluated } = await collectCoverageFacts({
      coverageFile: profile,
      source: goRoot,
      targets: [{ symbol: 'Called', file: 'example.com/mini/pkg/other.go' }]
    });
    assert.equal(facts.length, 0);
    assert.ok(notEvaluated.some(n => /coverage profile/.test(n.reason)));
  });

  test('a profile whose source cannot be resolved under --source is not evaluated', async () => {
    const profile = path.join(dir, 'go-unresolved.out');
    await writeFile(profile, PROFILE_LINES, 'utf8');
    const { facts, notEvaluated } = await collectCoverageFacts({
      coverageFile: profile,
      source: path.join(dir, 'no-such-module'),
      targets: [{ symbol: 'Called' }]
    });
    assert.equal(facts.length, 0);
    assert.ok(notEvaluated.some(n => /--source/.test(n.reason)));
  });

  test('a malformed Go profile body is refused with a reason, not interpreted', async () => {
    const profile = path.join(dir, 'go-malformed.out');
    await writeFile(profile, 'mode: set\nthis line is not a block\n', 'utf8');
    const { facts, notEvaluated, measured } = await collectCoverageFacts({
      coverageFile: profile,
      source: goRoot,
      targets: [{ symbol: 'Called' }]
    });
    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.ok(notEvaluated.some(n => /无法读取覆盖率数据|cannot read coverage data/.test(n.reason)));
  });
});
