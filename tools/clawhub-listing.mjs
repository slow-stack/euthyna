#!/usr/bin/env node
/**
 * Read a `clawhub skill verify` reply on stdin and normalise it for the shell.
 *
 * The publish workflow needs one line it can branch on, and it must not
 * mistake an intermediate registry state for a verdict. Measured on 2026-10-08:
 * minutes after a real push both slugs returned decision=fail with
 * reasons=["card.missing"] (the skill card is generated asynchronously) and the
 * English edition additionally reported security=suspicious, before both
 * settled to pass/clean the same evening. Anything still in flight is
 * therefore "settling", not "failed".
 *
 * Usage:
 *   clawhub skill verify <slug> --version <v> | node tools/clawhub-listing.mjs
 *     -> "decision|reasons|securityStatus|version"
 *     -> "unparsed|<first line of input>" when the reply is not JSON
 *        (rate limits answer with plain text like
 *        "Version not found (reset in 35s)")
 *
 *   node tools/clawhub-listing.mjs --compare <candidate> <current>
 *     -> "newer" | "same" | "older" | "unknown"
 *     Guards against replaying an old tag and moving the `latest` pointer
 *     backwards on a registry that has a newer release.
 */
import { readFileSync } from 'node:fs';

const arg = process.argv[2];

/**
 * Numeric dot-prefix comparison over the core version.
 *
 * Prerelease and build metadata are stripped rather than ordered: this is used
 * to decide whether publishing a candidate may move `latest`, and "0.6.0-rc.1
 * is not comparable" must not fail closed forever against "0.6.0". A candidate
 * that shares its core with the current listing compares "same", which the
 * guard allows; ordering two prereleases of the same core is out of scope here.
 */
function compareVersions(a, b) {
  const core = (v) => String(v ?? '').replace(/[-+].*$/, '');
  if (!/^\d+(\.\d+)*$/.test(core(a)) || !/^\d+(\.\d+)*$/.test(core(b))) return 'unknown';
  const pa = core(a).split('.').map(Number);
  const pb = core(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 'newer';
    if (x < y) return 'older';
  }
  return 'same';
}

if (arg === '--compare') {
  console.log(compareVersions(process.argv[3], process.argv[4]));
  process.exit(0);
}

const raw = readFileSync(0, 'utf8');

let report;
try {
  const j = JSON.parse(raw);
  report = [
    j.decision ?? 'no-decision',
    (j.reasons ?? []).join(','),
    j.security?.status ?? 'no-security',
    j.version ?? ''
  ].join('|');
} catch {
  report = `unparsed|${raw.split('\n')[0].slice(0, 160).replace(/\|/g, '/')}||`;
}

console.log(report);
