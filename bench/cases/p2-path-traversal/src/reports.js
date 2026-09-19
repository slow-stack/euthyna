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

function reportPath(name) {
  return path.join(REPORTS_DIR, name);
}

function readReport(name) {
  return fs.readFileSync(reportPath(name), 'utf8');
}

function listReports() {
  return fs.readdirSync(REPORTS_DIR);
}

module.exports = { readReport, listReports, reportPath, REPORTS_DIR };
