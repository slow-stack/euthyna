/**
 * Every flag the CLI advertises in its own help must be documented somewhere.
 *
 * This guard exists because two shipped changes — `--graph`, and making `--base`
 * optional — left README and the skill's own "required argument" line behind, and
 * nothing turned red. A claim with no channel is how a repository ends up
 * publishing a statement that stopped being true.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// Not a behaviour that needs prose: it is how you get the text that lists the
// behaviours. Every other flag changes what is measured, rendered or executed.
const UNDOCUMENTABLE = new Set(['--help']);

async function helpFlags() {
  const { main } = await import('../src/cli.js');
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await main(['help']);
  } finally {
    process.stdout.write = original;
  }
  const help = chunks.join('');
  return new Set([...help.matchAll(/--([a-z][a-z-]*)/g)].map((m) => `--${m[1]}`));
}

async function documentedIn() {
  const files = ['README.md', 'CONTRIBUTING.md'];
  for (const name of await readdir(path.join(ROOT, 'docs'))) {
    if (name.endsWith('.md')) files.push(path.join('docs', name));
  }
  for (const edition of ['euthyna', 'euthyna-en']) {
    const relDir = path.join('.agents', 'skills', edition, 'references');
    for (const name of await readdir(path.join(ROOT, relDir))) {
      if (name.endsWith('.md')) files.push(path.join(relDir, name));
    }
  }
  const text = [];
  for (const rel of files) {
    text.push(await readFile(path.join(ROOT, rel), 'utf8'));
  }
  return text.join('\n');
}

describe('the CLI help has no undocumented flag', () => {
  test('every advertised flag appears in the prose that is supposed to explain it', async () => {
    const flags = await helpFlags();
    const documented = await documentedIn();

    const missing = [...flags].filter((flag) => !UNDOCUMENTABLE.has(flag) && !documented.includes(flag));
    assert.deepEqual(
      missing,
      [],
      `${missing.join(', ')} is advertised by \`euthyna help\` and explained nowhere in README, CONTRIBUTING, docs/ or the skill references`
    );
    assert.ok(flags.size >= 12, `the help should list the whole surface; found ${flags.size} flags`);
  });
});
