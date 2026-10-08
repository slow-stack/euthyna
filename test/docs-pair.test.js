/**
 * Every document in `docs/` exists twice: the `-zh` original and its English translation.
 *
 * That is a written convention in AGENTS.md, and it had no checker — measured before
 * this file existed, nothing under `test/` looked at `docs/` at all. So a case study
 * could gain a section, a table, a documented command or a flag in one language and
 * not the other, and CI stayed green while the two readers of the same public
 * repository got different documents.
 *
 * Pinned: the pairing in both directions, and per pair the same structure and
 * identifier comparison the two skill editions are held to (one shared scan, in
 * ./markdown-structure.js).
 *
 * Deliberately NOT pinned: that the prose says the same thing. Whether a
 * translation is faithful is a reading job, and a mechanical stand-in for it would
 * only produce noise. What this guard catches is the narrower, real class — one
 * language documenting something the other does not.
 *
 * Measured as of writing this guard: 14 files, 7 pairs, and every pair already
 * identical on heading sequence, fenced blocks, tables, command mentions and flags.
 * It therefore starts with no debt and no allow-list.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesUnder, structure, structureDiffs } from './markdown-structure.js';
import { cliSubcommands } from './cli-commands.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

/** The counterpart a document must have: `-zh` gets its translation, a translation gets its original. */
const twinOf = (rel) => (rel.endsWith('-zh.md') ? rel.slice(0, -'-zh.md'.length) + '.md' : rel.slice(0, -'.md'.length) + '-zh.md');

describe('the documents in docs/ exist in both languages', () => {
  test('every file has its counterpart', async () => {
    const files = await filesUnder(DOCS);
    assert.ok(files.length > 0, 'no Markdown found under docs/ — the scan is reading the wrong place');

    const missing = files.filter((rel) => !files.includes(twinOf(rel)));
    assert.deepEqual(
      missing,
      [],
      `\n${missing.map((rel) => `${rel} has no ${twinOf(rel)}`).join('\n')}\n\n` +
        'the convention is that every document in docs/ exists in both languages; one without a twin means ' +
        'a reader of one language is missing something the other has'
    );
  });

  test('every pair matches on structure and identifiers, document by document', async () => {
    const commands = await cliSubcommands(ROOT);
    const files = await filesUnder(DOCS);
    const diffs = [];

    for (const rel of files.filter((f) => f.endsWith('-zh.md'))) {
      const en = twinOf(rel);
      const a = structure(await readFile(path.join(DOCS, rel), 'utf8'), commands);
      const b = structure(await readFile(path.join(DOCS, en), 'utf8'), commands);
      for (const what of structureDiffs(a, b, { left: 'zh', right: 'en' })) {
        diffs.push(`${rel} ↔ ${en}: ${what}`);
      }
    }

    assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);
  });
});
