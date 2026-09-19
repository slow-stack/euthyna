/**
 * Thin wrapper around the `git` binary.
 *
 * Deliberately shells out to git rather than using a library: git is the
 * authority on git semantics, and a library would be a dependency the audit
 * itself would have to trust.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Large repositories produce large diffs; the default 1 MB buffer is not enough.
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Run a git command and return stdout. Throws on a non-zero exit.
 *
 * @param {string[]} args
 * @param {{cwd?: string, allowFailure?: boolean}} [options]
 * @returns {Promise<string>} stdout, with the trailing newline preserved
 */
export async function git(args, options = {}) {
  const { cwd, allowFailure = false } = options;
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      // Keep output byte-exact: a security fact must not be altered by locale.
      env: { ...process.env, LC_ALL: 'C' }
    });
    return stdout;
  } catch (error) {
    if (allowFailure) return '';
    const stderr = (error.stderr || '').trim();
    throw new Error(
      `git ${args.join(' ')} failed${stderr ? `: ${stderr}` : `: ${error.message}`}`
    );
  }
}

/** Resolve the repository top level, or null when cwd is not inside a repo. */
export async function repoToplevel(cwd) {
  const out = await git(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
  return out.trim() || null;
}

/** Resolve a revision to a full commit hash, or null when it does not exist. */
export async function revParse(cwd, rev) {
  const out = await git(['rev-parse', '--verify', `${rev}^{commit}`], {
    cwd,
    allowFailure: true
  });
  return out.trim() || null;
}

/**
 * One-line summaries for a set of commits, as a Map of hash -> {subject, author, date}.
 * Uses a single `git log` invocation so the cost does not scale per commit.
 */
export async function commitSummaries(cwd, hashes) {
  const result = new Map();
  if (hashes.length === 0) return result;

  // A NUL-separated record format survives commit subjects containing any
  // character except NUL, so subjects with newlines or pipes stay intact.
  const out = await git(
    ['log', '--no-walk', '--format=%H%x00%s%x00%an%x00%cI%x00%x00', ...hashes],
    { cwd, allowFailure: true }
  );

  for (const record of out.split('\0\0')) {
    const trimmed = record.replace(/^\n+/, '');
    if (!trimmed) continue;
    const [hash, subject, author, date] = trimmed.split('\0');
    if (!hash) continue;
    result.set(hash, { subject, author, date });
  }
  return result;
}
