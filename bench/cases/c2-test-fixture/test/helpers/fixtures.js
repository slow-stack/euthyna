'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Fixture helpers for the reports test suite.
 *
 * Tests need to read files from a scratch directory that each test creates and
 * tears down, so these helpers deliberately take a raw path and do no
 * validation - the "caller" is the test itself, and a test that wants to read a
 * file outside its scratch directory is doing so on purpose.
 */

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-fixtures-'));

function writeFixture(relativePath, contents) {
  const target = path.join(SCRATCH, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
  return target;
}

function readFixture(relativePath) {
  return fs.readFileSync(path.join(SCRATCH, relativePath), 'utf8');
}

function cleanup() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
}

module.exports = { writeFixture, readFixture, cleanup, SCRATCH };
