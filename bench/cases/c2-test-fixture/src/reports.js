'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Report storage (production).
 *
 * Names are validated against a strict pattern before use, so only files that
 * the nightly job itself wrote can be read back.
 */

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

function reportPath(name) {
  if (!SAFE_NAME.test(String(name))) {
    throw new Error(`invalid report name: ${name}`);
  }
  const resolved = path.resolve(REPORTS_DIR, name);
  if (!resolved.startsWith(REPORTS_DIR + path.sep)) {
    throw new Error(`report name escapes the reports directory: ${name}`);
  }
  return resolved;
}

function readReport(name) {
  return fs.readFileSync(reportPath(name), 'utf8');
}

module.exports = { readReport, reportPath, REPORTS_DIR };
