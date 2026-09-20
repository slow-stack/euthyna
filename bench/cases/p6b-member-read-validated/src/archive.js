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
const DATA_ROOT = path.resolve(DATA_DIR);

// A dataset name may only be a bare name: one letter or digit, then letters,
// digits, dots, dashes and underscores, and no ".." sequence. Everything else
// is rejected before it can reach tar - separators, "..", a leading "@" (which
// bsdtar reads as "read this archive and merge its entries"), drive letters,
// UNC paths. Two round-3 adjudications each found one of the shapes this
// closes: the bare ".." (run 1) and the "@.." operand (run 3b).
const BARE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function archiveDataset(datasetName) {
  if (!BARE_NAME.test(datasetName) || datasetName.includes('..')) {
    const error = new Error('dataset name must be a bare name');
    error.status = 400;
    throw error;
  }
  // The name becomes a tar member path relative to data/, so the resolved
  // member root must stay inside data/.
  const memberRoot = path.resolve(DATA_DIR, datasetName);
  if (memberRoot !== DATA_ROOT && !memberRoot.startsWith(DATA_ROOT + path.sep)) {
    const error = new Error('dataset name must resolve inside the data directory');
    error.status = 400;
    throw error;
  }
  // The archive target must stay inside ARCHIVE_DIR. path.join already
  // normalizes "..", so containment - not normalization - is what rejects an
  // escaped target here.
  const target = path.resolve(path.join(ARCHIVE_DIR, `${datasetName}.tgz`));
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
