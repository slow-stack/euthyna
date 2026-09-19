'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Report storage.
 *
 * Reports are written by the nightly job into REPORTS_DIR and served back to
 * the dashboard by name. The name comes from the query string.
 */

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

/**
 * Resolve a caller-supplied report name to an absolute path inside REPORTS_DIR.
 *
 * resolve() collapses any ".." segments first, and the result is then required
 * to still sit under REPORTS_DIR, so traversal out of the directory fails here
 * rather than at read time.
 */
function reportPath(name) {
  const resolved = path.resolve(REPORTS_DIR, name);
  if (resolved !== REPORTS_DIR && !resolved.startsWith(REPORTS_DIR + path.sep)) {
    throw new Error(`report name escapes the reports directory: ${name}`);
  }
  return resolved;
}

function readReport(name) {
  return fs.readFileSync(reportPath(name), 'utf8');
}

function listReports() {
  return fs.readdirSync(REPORTS_DIR);
}

module.exports = { readReport, listReports, reportPath, REPORTS_DIR };
