'use strict';

/**
 * Where a round's blind reports live — one definition, used by both the
 * harness that writes them (adjudicate.js) and the collector that reads them
 * (collect-verdicts.js).
 *
 * The two must agree exactly: if they disagree, every report is written to one
 * directory and looked for in another, and the round fails with "report
 * missing" for every case. They used to compute this independently from
 * `process.env.TEMP`, which is unset on most non-Windows hosts — making the
 * path *relative*, resolved against the writer's cwd and against the
 * collector's cwd (ROOT) respectively.
 *
 * `os.tmpdir()` is absolute on every platform: it honours TMPDIR/TMP/TEMP when
 * they are set to something, and otherwise falls back to the platform default,
 * so an empty or missing variable cannot produce a relative path.
 */

const os = require('node:os');
const path = require('node:path');

/** @param {number} round @returns {string} absolute path to the round's results */
function resultsDir(round) {
  return path.join(os.tmpdir(), `euthyna-blind-results-r${round}`);
}

module.exports = { resultsDir };
