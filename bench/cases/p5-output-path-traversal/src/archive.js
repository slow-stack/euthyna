'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Nightly archive job.
 *
 * Each dataset directory is packed into a single tarball so it can be shipped
 * to cold storage. The dataset name is chosen in the admin UI, and the same
 * handler is reused by the "archive now" button in the dashboard.
 */

const ARCHIVE_DIR = path.join(__dirname, '..', 'backups');
const DATA_DIR = path.join(__dirname, '..', 'data');

function archiveDataset(datasetName) {
  const target = path.join(ARCHIVE_DIR, `${datasetName}.tgz`);
  // No shell is involved, and "--" stops tar from reading datasetName as an option.
  return execFileSync('tar', ['-czf', target, '--', datasetName], {
    encoding: 'utf8',
    cwd: DATA_DIR
  });
}

module.exports = { archiveDataset, ARCHIVE_DIR, DATA_DIR };
