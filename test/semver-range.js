/**
 * Enough of node-semver to ask one question about one range: "is this version
 * admitted?" — used to test the peer range we publish.
 *
 * Why not just import `semver`: this repository is deliberately zero-dependency
 * and CI has no install step (.github/workflows/ci.yml), so a devDependency
 * would not resolve on a runner. AGENTS.md allows a third-party dependency only
 * after auditing its source; that is a poor trade for a test helper.
 *
 * Why not a regex over the range text: the text is not the property under test.
 * `>=0.2.0-0 <0.2.1-0` contains "0.2." and is short, yet it rejects
 * 0.2.1-rc.2 — that is exactly the class of bug this file exists to catch.
 *
 * Scope is deliberately narrow: it understands only `>=` and `<` comparators,
 * joined by whitespace, in branches joined by `||`. Anything else throws. The
 * published range is written in exactly those forms, so a future edit that
 * reaches for `^`, `~` or a hyphen range fails here loudly instead of being
 * quietly mis-parsed into a passing test.
 *
 * This is NOT a semver implementation for production use. It is verified
 * against the real node-semver over a version matrix in
 * test/plugin.test.js — if it ever drifts, that comparison fails first.
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const COMPARATOR_RE = /^(>=|<)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Parse `major.minor.patch[-prerelease]`. Build metadata is out of scope. */
export function parseVersion(text) {
  const m = VERSION_RE.exec(String(text).trim());
  if (!m) throw new Error(`not a version this helper understands: ${text}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : []
  };
}

const numeric = (id) => /^\d+$/.test(id);

/**
 * Semver precedence (https://semver.org/#spec-item-11). Returns -1, 0 or 1.
 *
 * A version with a prerelease sorts below the same tuple without one; within a
 * prerelease, numeric identifiers compare numerically and sort below
 * alphanumeric ones, and a shorter identifier list sorts below a longer one
 * once every shared position is equal.
 */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  const ap = a.prerelease;
  const bp = b.prerelease;
  if (ap.length === 0 || bp.length === 0) {
    if (ap.length === bp.length) return 0;
    // No prerelease outranks any prerelease.
    return ap.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    if (numeric(x) && numeric(y)) return Number(x) < Number(y) ? -1 : 1;
    if (numeric(x)) return -1;
    if (numeric(y)) return 1;
    return x < y ? -1 : 1;
  }
  if (ap.length === bp.length) return 0;
  return ap.length < bp.length ? -1 : 1;
}

/** Split a range into branches of parsed comparators. Throws on unknown syntax. */
export function parseRange(range) {
  return String(range)
    .split('||')
    .map((branch) => {
      const parts = branch.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) throw new Error(`empty range branch in: ${range}`);
      return parts.map((text) => {
        const m = COMPARATOR_RE.exec(text);
        if (!m) throw new Error(`comparator "${text}" is outside this helper's scope (only >= and <): ${range}`);
        return { op: m[1], version: parseVersion(m[2]) };
      });
    });
}

/**
 * Mirrors node-semver's `satisfies(version, range, { includePrerelease })`.
 *
 * The prerelease rule is the subtle half and the reason this helper exists. By
 * default node-semver refuses a prerelease version unless some comparator *in
 * the same branch* both shares its exact major.minor.patch tuple *and* itself
 * carries a prerelease tag. So `>=0.1.6-0 <0.2.0` cannot admit `0.2.1-rc.2` no
 * matter how the numbers read. `includePrerelease: true` drops that requirement
 * and compares on precedence alone — which is what the harness does
 * (app-boot's unmetRequirements calls semver.satisfies with includePrerelease),
 * while plain `npm install` uses the default. Both are checked in the tests
 * because the plugin has to survive both.
 */
export function satisfies(version, range, { includePrerelease = false } = {}) {
  const v = parseVersion(version);
  const branches = parseRange(range);
  // node-semver tests each `||` branch on its own and returns true as soon as
  // one passes — including the prerelease rule, which is evaluated per branch.
  // Short-circuiting on the first branch whose comparators match is wrong: a
  // version can match a wide branch numerically and still be refused there
  // because that branch's prerelease comparator names a different tuple, while
  // a later branch admits it legitimately.
  return branches.some((candidates) => {
    const inRange = candidates.every((c) => {
      const order = compareVersions(v, c.version);
      return c.op === '>=' ? order >= 0 : order < 0;
    });
    if (!inRange) return false;
    if (includePrerelease || v.prerelease.length === 0) return true;
    return candidates.some((c) => c.version.prerelease.length > 0
      && c.version.major === v.major
      && c.version.minor === v.minor
      && c.version.patch === v.patch);
  });
}

/**
 * A table of [version, expected] pairs checked against one range under one
 * admission rule. Used by the peer-range tests so a failure names the version
 * and the rule rather than just "the range is wrong".
 */
export function partition(versions, range, options) {
  const admitted = [];
  const rejected = [];
  for (const version of versions) (satisfies(version, range, options) ? admitted : rejected).push(version);
  return { admitted, rejected };
}
