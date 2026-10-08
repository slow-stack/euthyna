/**
 * The shared Markdown scan's own rules, pinned on crafted documents.
 *
 * Both parity guards are only as good as this scan, and every rule below was a
 * legal form it used to miss — found by review, not by a red run, because a form
 * the scan cannot see makes the comparison pass on that form. So each rule gets a
 * document built to exercise it, rather than trust coming from the twins matching.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyLines, structure, structureDiffs } from './markdown-structure.js';
import { cliSubcommands } from './cli-commands.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const commands = await cliSubcommands(ROOT);
const s = (text) => structure(text, commands);

describe('the structure scan reads the Markdown forms it claims', () => {
  test('a fence closes only on a marker at least as long as its opener', () => {
    const doc = ['````', '```', '# inside the block', '````', '# after the block'].join('\n');
    assert.deepEqual(s(doc).headings, [1], 'the 3-backtick line is content, so the heading under it stays fenced');
    assert.equal(s(doc).fences, 1);
  });

  test('a Setext underline under a paragraph is a heading, and after a blank line it is not', () => {
    assert.deepEqual(s('Title\n===\n\ntext\n---\n').headings, [1, 2]);
    assert.deepEqual(s('text\n\n---\n').headings, [], 'a thematic break is not a heading');
    assert.deepEqual(s('- item\n---\n').headings, [], 'a list item is not a paragraph to underline');
  });

  test('a table is confirmed by its delimiter row and its cells keep escaped pipes', () => {
    assert.deepEqual(s('a | b\n--- | ---\n1 | 2\n').tables, [[2, 2, 2]], 'no outer pipes');
    assert.deepEqual(s('prose with a | inside\n').tables, [], 'a stray pipe is not a table');
    assert.deepEqual(
      s('| a | b |\n| --- | --- |\n| x \\| y | z |\n').tables,
      [[2, 2, 2]],
      'an escaped pipe is cell content, not a cell boundary'
    );
  });

  test('frontmatter ends only at an unindented delimiter', () => {
    const doc = ['---', 'name: x', '  ---', '# still metadata, not a heading', 'description: y', '---', 'body'].join('\n');
    assert.deepEqual(s(doc).headings, [], 'the indented --- is YAML content, so the body starts at the real closer');
    // The body itself, not just what the scan says about it: a version that
    // discarded everything after a valid closer would also report no headings.
    assert.deepEqual(bodyLines(doc), ['body']);
    assert.deepEqual(bodyLines('---\ntitle: x'), ['---', 'title: x'], 'unterminated frontmatter is not guessed away');
  });

  test('every invocation form in the documents yields its command', () => {
    const forms = [
      'euthyna audit --base main',
      'node <repo>/bin/euthyna.js coverage --coverage x.json',
      'npx --yes euthyna@latest gate report.md',
      'npx --yes euthyna@0.6.0 deps --all'
    ].join('\n');
    assert.deepEqual(s(forms).subcommands, ['audit', 'coverage', 'deps', 'gate']);
    // Ordinary prose must not become a command: `repo` and `run` are not dispatched.
    assert.deepEqual(s('the euthyna repo is small; beyond euthyna gate there is nothing').subcommands, ['gate']);
  });

  test('a pipe escaped by an even backslash run is still a cell boundary', () => {
    assert.deepEqual(s('| a \\| b | c |\n| --- | --- |\n').tables[0], [2, 2], 'the escaped pipe stays inside the cell');
    assert.deepEqual(s('| a \\\\| b | c |\n| --- | --- |\n').tables[0], [3, 2], 'an escaped backslash leaves the pipe bare');
  });

  test('the diff list names the side a difference belongs to', () => {
    const a = s('# one\n\n| x | y |\n| --- | --- |\n');
    const b = s('# one\n\nRuns `euthyna audit` and needs `--source`.\n');
    const diffs = structureDiffs(a, b, { left: 'zh', right: 'en' });
    assert.deepEqual(diffs, [
      'tables [[2,2]] vs []',
      'subcommands only in zh: - / only in en: audit',
      'flags only in zh: - / only in en: --source'
    ], `unexpected diffs: ${JSON.stringify(diffs)}`);
  });
});
