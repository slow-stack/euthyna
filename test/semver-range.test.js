/**
 * Locks the zero-dependency range helper against node-semver.
 *
 * test/semver-range.js exists because this repository has no install step in CI
 * (see .github/workflows/ci.yml) and AGENTS.md forbids a casual third-party
 * dependency — so the suite cannot import the real node-semver at all. But a
 * hand-written comparator is exactly the kind of thing that is subtly wrong
 * while looking right, and a wrong helper makes every peer-range assertion pass
 * for the wrong reason.
 *
 * The cases below were generated from node-semver 7 (semver.satisfies with and
 * without includePrerelease, semver.compare) and frozen. They are the tricky
 * ones: numeric vs alphanumeric identifiers, shorter identifier lists, a
 * prerelease sorting below its own release, and per-branch evaluation of `||`.
 * If the helper drifts, this fails here rather than silently mis-answering in
 * test/plugin.test.js.
 *
 * Do not "fix" a failure by editing the expected values. Re-derive them from
 * node-semver and say so in the commit message.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, satisfies, parseRange } from './semver-range.js';

// [a, b, expected sign of compare(a, b)] — from semver.compare
const PRECEDENCE = [
  ['0.2.0-0', '0.2.0', -1],
  ['0.2.0-rc.1', '0.2.0', -1],
  ['0.2.0-alpha.1', '0.2.0-rc.1', -1],
  ['0.1.6-rc.9', '0.1.6-rc.10', -1],
  ['0.1.6-rc.10', '0.1.6-rc.9', 1],
  ['0.1.6-1', '0.1.6-alpha', -1],
  ['0.1.6-alpha', '0.1.6-1', 1],
  ['0.1.6-alpha.1', '0.1.6-alpha', 1],
  ['0.1.6-alpha', '0.1.6-alpha.1', -1],
  ['0.1.9', '0.2.0-0', -1],
  ['0.2.1-0', '0.2.1-rc.1', -1],
  ['0.2.1-rc.2', '0.2.1', -1],
  ['1.0.0-0', '0.9.9', 1],
  ['0.1.6-x.1', '0.1.6-1', 1],
  ['0.1.6-beta.2', '0.1.6-beta.10', -1]
];

// [version, range, includePrerelease, expected] — from semver.satisfies
const SATISFIES = [
  ['0.2.1-rc.2', '>=0.2.1-0 <0.3.0-0', true, true],
  ['0.2.1-rc.2', '>=0.2.1-0 <0.3.0-0', false, true],
  ['0.2.2-alpha.1', '>=0.2.1-0 <0.3.0-0', true, true],
  ['0.2.2-alpha.1', '>=0.2.1-0 <0.3.0-0', false, false],
  ['0.2.1-rc.2', '>=0.2.0-0 <0.2.1-0', true, false],
  ['0.1.6-rc.1', '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0', true, true],
  ['0.1.6-rc.1', '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0', false, true],
  ['0.1.9', '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0', false, true],
  ['0.2.0-rc.1', '>=0.1.6-0 <0.2.0 || >=0.2.0-0 <0.3.0-0', false, true],
  ['0.2.0-rc.1', '>=0.1.6-0 <0.2.0 || >=0.2.0-0 <0.3.0-0', true, true],
  ['0.3.0-0', '>=0.1.6-0 <0.2.0 || >=0.2.0-0 <0.3.0-0', true, false],
  ['0.1.5-rc.2', '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0', false, true]
];

describe('the range helper agrees with node-semver on the cases that matter', () => {
  test('precedence matches semver.compare', () => {
    for (const [a, b, expected] of PRECEDENCE) {
      const got = Math.sign(compareVersions(parseVersion(a), parseVersion(b)));
      assert.equal(got, expected, `compare(${a}, ${b})`);
      // and the reverse direction has to be consistent, not independently lucky
      assert.equal(Math.sign(compareVersions(parseVersion(b), parseVersion(a))), -expected, `compare(${b}, ${a})`);
    }
  });

  test('satisfies matches semver.satisfies under both admission rules', () => {
    for (const [version, range, includePrerelease, expected] of SATISFIES) {
      assert.equal(satisfies(version, range, { includePrerelease }), expected,
        `satisfies(${version}, ${range}, {includePrerelease:${includePrerelease}})`);
    }
  });

  test('branches are evaluated independently, so a wide first branch cannot mask a later one', () => {
    // This is the bug the first draft of the helper had, and it is invisible in
    // any test whose range has a single branch. `>=0.1.2-rc.1 <0.2.0` matches
    // 0.1.6-rc.1 numerically, but under the default rule that branch refuses it
    // (its prerelease comparator names the 0.1.2 tuple); the third branch is
    // what admits it. Short-circuiting on the first numeric match returns false.
    const range = '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0';
    assert.equal(satisfies('0.1.6-rc.1', range, { includePrerelease: false }), true);
    assert.equal(parseRange(range).length, 3);
  });

  test('a comparator this helper cannot read fails loudly instead of being guessed at', () => {
    // The published range uses only >= and <. If a future edit reaches for a
    // caret or a hyphen range, a silent mis-parse would make the peer tests
    // meaningless, so the helper throws and the suite stops.
    for (const unsupported of ['^0.1.6', '~0.2.0', '0.1.6 - 0.2.0', '>=0.1.6 <0.2.0 || ']) {
      assert.throws(() => parseRange(unsupported), /outside this helper's scope|empty range branch/,
        `${unsupported} must not be silently accepted`);
    }
    assert.throws(() => parseVersion('0.1'), /not a version this helper understands/);
  });
});
