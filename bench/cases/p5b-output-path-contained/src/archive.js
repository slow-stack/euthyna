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

const ARCHIVE_DIR = path.resolve(path.join(__dirname, '..', 'backups'));
const DATA_DIR = path.join(__dirname, '..', 'data');

function archiveDataset(datasetName) {
  const target = path.resolve(path.join(ARCHIVE_DIR, `${datasetName}.tgz`));
  // The archive target must stay inside ARCHIVE_DIR. path.join already
  // normalizes "..", so containment - not normalization - is what rejects an
  // escaped target here.
  if (target !== ARCHIVE_DIR && !target.startsWith(ARCHIVE_DIR + path.sep)) {
    const error = new Error('archive target escapes the archive directory');
    error.status = 400;
    throw error;
  }
  // No shell is involved, and "--" stops tar from reading datasetName as an option.
  return execFileSync('tar', ['-czf', target, '--', datasetName], {
    encoding: 'utf8',
    cwd: DATA_DIR
  });
}

module.exports = { archiveDataset, ARCHIVE_DIR, DATA_DIR };
