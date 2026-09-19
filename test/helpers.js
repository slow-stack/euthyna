/**
 * Shared helpers for the test suite.
 *
 * Tests build real, throwaway git repositories rather than mocking git. The
 * claim under test is "this blame attribution is correct", which is exactly the
 * kind of claim a mock would let pass while the real thing is wrong.
 */
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Run git in `cwd` and return stdout. Local config only, so the host's global git config cannot change the result. */
export async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' }
  });
  return stdout;
}

/** Create an empty repository with a deterministic identity and no signing. */
export async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-test-'));
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test Author']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

/** Write files and commit them. Returns the new commit hash. */
export async function commitFiles(cwd, message, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(cwd, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-q', '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}
