/**
 * Thin wrapper around the `git` binary.
 *
 * Deliberately shells out to git rather than using a library: git is the
 * authority on git semantics, and a library would be a dependency the audit
 * itself would have to trust.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { safeText, shellQuote } from './contract.js';

const execFileAsync = promisify(execFile);

// Large repositories produce large diffs; the default 1 MB buffer is not enough.
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * The message for a failed git invocation.
 *
 * Two transforms, both required. The argv is shell-quoted so the message can be
 * pasted back into a shell to reproduce the failure — the same shellQuote the
 * emitted commands use; an unquoted argv with a hostile filename in it would
 * execute as code when the reader does exactly that. The assembled message is
 * then made terminal-safe as a whole: the argv itself carries repo-controlled
 * filenames in the measurement flows (git diff -- <file>), and quoting alone
 * does not neutralize a control byte — a BEL inside single quotes still beeps.
 * git's stderr gets the same treatment because git embeds repository-controlled
 * text (filenames, refs) in its messages.
 *
 * Exported so both transforms are testable against hostile input directly: a
 * repository carrying a control byte in a filename cannot be built on every
 * host this suite runs on.
 */
export function gitFailureMessage(args, detail) {
  const argv = args.map(shellQuote).join(' ');
  return safeText(`git ${argv} failed: ${detail}`);
}

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
    // git writes its own diagnosis to stderr; when it wrote none, the exit
    // status is all there is. error.message is deliberately not used: it
    // embeds the argv unquoted, which is the shape this path exists to remove.
    const stderr = (error.stderr || '').trim();
    const detail = stderr || `exit status ${error.code ?? error.signal ?? 'unknown'}`;
    throw new Error(gitFailureMessage(args, detail));
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
