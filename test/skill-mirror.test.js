/**
 * The two skill editions must stay in step.
 *
 * `.agents/skills/euthyna/` is the Chinese original and `.agents/skills/euthyna-en/`
 * is its English mirror. The written rule has always been "mirror it by hand"; the
 * measured reality was that nothing checked (AGENTS.md said so), which is how a
 * discipline change can reach one language of a distributed skill and not the
 * other — the two editions are published to ClawHub as two slugs, so the drift is
 * user-visible, not cosmetic.
 *
 * What this pins is structure and identifiers, NOT prose:
 *   - the same relative file set
 *   - per file: heading-level sequence (ATX and Setext), table shapes (every
 *     row's column count, rows recognised with or without outer pipes),
 *     fenced-block count
 *   - per file: the set of `euthyna <word>` mentions and the set of `--flags`
 *
 * Headings and tables are read outside fenced blocks only — a `#` comment inside a
 * bash example is not a heading, and a `|` in a diagram is not a table. Frontmatter
 * is cut line by line rather than by regex, because a body that contains its own
 * `---` rule would otherwise swallow half the document.
 *
 * Counting how often a word appears is deliberately absent. A token like
 * `INCONCLUSIVE` legitimately appears one extra time in the English edition, where
 * a sentence talks about the state itself ("The third state INCONCLUSIVE must
 * exist"); a translation that needs that room is not drift. An identifier missing
 * from one edition IS drift: it means one language documents a capability the
 * other does not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ZH = path.join(ROOT, '.agents/skills/euthyna');
const EN = path.join(ROOT, '.agents/skills/euthyna-en');

async function filesUnder(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(abs, base)));
    else if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(path.relative(base, abs).replace(/\\/g, '/'));
  }
  return out.sort();
}

/**
 * Everything after the YAML frontmatter, as lines.
 *
 * Frontmatter is recognised only when the file's very first line is `---` and a
 * closing `---` line follows; anything else (a thematic break mid-document, a
 * file with no frontmatter at all) is left intact.
 */
function bodyLines(text) {
  const lines = text.split(/\r?\n/);
  // Both delimiters sit at column 0. An indented `---` is not a boundary: in the
  // opener position it would not be frontmatter at all, and inside the block it
  // is YAML content (a block scalar, say) that must not end the frontmatter early.
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return lines;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i] ?? '')) return lines.slice(i + 1);
  }
  return lines; // unterminated: do not guess, keep the whole file
}

/**
 * A table row, recognised in both legal GFM forms: with outer pipes
 * (`| a | b |`) and without them (`a | b`). Requiring the leading pipe was a
 * real blind spot — an edition could carry a whole table the scan never saw.
 * A row counts as part of a table only when it holds a pipe; a table is
 * confirmed by its delimiter row, so prose containing `|` is not miscounted.
 */
const isTableRow = (line) => /^ {0,3}\S.*\|/.test(line) || /^ {0,3}\|/.test(line);
const isTableDelimiter = (line) => /^ {0,3}\|?[\s:]*-[\s:|.-]*$/.test(line) && line.includes('-') && line.includes('|');

/** Cell count with the outer pipes normalised away. */
function tableColumns(line) {
  // `\|` is GFM's escape for a literal pipe inside a cell, so it separates
  // nothing; counting it would make two editions that escaped it differently
  // look like tables of different widths.
  let s = line.trim().replace(/\\\|/g, '');
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').length;
}

/**
 * Whether a line can be the text a Setext underline (`===` / `---`) heads.
 * Blank lines cannot, and neither can a blockquote or list-item line: its
 * paragraph lives inside that container, so an underline under it is a
 * thematic break instead.
 */
const isParagraphLine = (line) =>
  line.trim() !== '' && !/^ {0,3}(?:>|[-+*] |\d+[.)] )/.test(line);

function structure(text, realCommands) {
  const lines = bodyLines(text);
  const headings = [];
  const tables = [];
  const fenceStarts = [];
  const identifiers = [];
  let fence = null; // the opening marker string while inside a fenced block
  let table = null;
  let paragraph = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    identifiers.push(line);

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      paragraph = false;
      if (!fence) {
        fence = marker;
        fenceStarts.push(line);
        table = null;
        continue;
      }
      // a closing fence is the same character class and at least as long, with
      // no info string; anything else is content inside the block. Keeping the
      // whole marker matters: a 4-backtick block containing a 3-backtick line
      // stays open, and storing only the character let it close early.
      if (marker[0] === fence[0] && marker.length >= fence.length && fenceMatch[2].trim() === '') {
        fence = null;
        continue;
      }
      continue;
    }
    if (fence) continue; // a `#` comment in a bash example is not a heading

    // Setext form: an underline directly under a paragraph line is a heading
    // (level 1 for `=`, level 2 for `-`), not a thematic break.
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (setext && paragraph) {
      headings.push(setext[1][0] === '=' ? 1 : 2);
      paragraph = false;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s/.exec(line);
    if (heading) {
      headings.push(heading[1].length);
      table = null;
      paragraph = false;
      continue;
    }

    if (isTableRow(line)) {
      if (!table && isTableDelimiter(lines[idx + 1] ?? '')) {
        table = [];
        tables.push(table);
      }
      if (table) {
        table.push(tableColumns(line));
        paragraph = false;
      } else {
        paragraph = isParagraphLine(line);
      }
      continue;
    }
    table = null;
    paragraph = isParagraphLine(line);
  }

  // Identifiers are read across the whole file, prose included, not only out of
  // the command examples. That is the stricter side and it is deliberate: a flag
  // named in a Chinese sentence and dropped in the English one is the same drift
  // as a flag missing from a documented invocation, and both editions do mirror
  // such sentences today ("`--coverage` 没有 `--repo`" ↔ "the coverage command has
  // no `--repo`"). The cost is that a prose-only difference goes red, and the
  // remedy then is to mirror the sentence.
  const joined = identifiers.join('\n');
  return {
    headings,
    // an unbalanced marker means the scan ended inside a block; report it as a
    // structure difference rather than quietly ignoring the rest of the file
    openFence: fence,
    fences: fenceStarts.length,
    tables,
    // Both written forms count: the skill documents commands as
    // `node <repo>/bin/euthyna.js coverage …`, while prose says `euthyna gate`.
    // Missing the `.js` form was caught by mutation — a one-sided `deps`
    // invocation stayed invisible until the pattern accepted it.
    subcommands: [
      ...new Set([...joined.matchAll(/\beuthyna(?:\.js)?\s+([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]))
    ]
      // Only tokens the CLI actually dispatches count as command mentions: the
      // English edition writes ordinary sentences like "the euthyna repo", and a
      // pattern that cannot tell those apart reports drift that is not there.
      // Real commands come from src/cli.js, so a command added there is in this
      // set by construction rather than by someone remembering to edit a test.
      .filter((name) => realCommands.includes(name))
      .sort(),
    flags: [...new Set([...joined.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]))].sort()
  };
}

/**
 * The CLI's own dispatch table.
 *
 * Matching `euthyna <word>` freely reads English prose as commands ("the euthyna
 * repo"), and a hand-written whitelist of today's five names would let a command
 * added next month escape the comparison silently. Deriving the set from
 * src/cli.js fixes both directions: mentions are restricted to real commands,
 * and a real command cannot be missing from the list.
 *
 * The derivation is what has to fail loudly. Both this pattern and the filter
 * that consumes it are silent by construction: if the dispatch were re-written
 * into a shape the pattern does not read, the set would come back short or empty,
 * every mention would be filtered out of *both* editions, and parity would pass
 * on nothing. So the dispatch forms written here are the two the repository uses
 * (a `===` chain today, `case` if it becomes a switch), and the list is
 * cross-checked against the command section of the CLI's own help, in both
 * languages — which turns even a *partial* miss into a red run rather than a
 * quieter comparison.
 */
async function cliSubcommands() {
  const cli = await readFile(path.join(ROOT, 'src/cli.js'), 'utf8');
  const names = [...cli.matchAll(/(?:command ===|case)\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

describe('the two skill editions stay in step', () => {
  test('they ship the same set of Markdown files', async () => {
    const [zh, en] = await Promise.all([filesUnder(ZH), filesUnder(EN)]);
    assert.deepEqual(
      en,
      zh,
      `file sets differ — only zh: ${zh.filter((f) => !en.includes(f))} / only en: ${en.filter((f) => !zh.includes(f))}`
    );
    assert.ok(zh.includes('SKILL.md'), 'both editions ship a SKILL.md');
  });

  test('every shared file matches on structure and identifiers, file by file', async () => {
    // The derivation itself is pinned by the next test; here it is only consumed.
    const real = await cliSubcommands();
    const diffs = [];

    for (const rel of await filesUnder(ZH)) {
      const a = structure(await readFile(path.join(ZH, rel), 'utf8'), real);
      const b = structure(await readFile(path.join(EN, rel), 'utf8'), real);
      const label = (what) => diffs.push(`${rel}: ${what}`);

      if (a.openFence || b.openFence) label(`unclosed fence (zh ${a.openFence ?? 'none'}, en ${b.openFence ?? 'none'})`);
      if (JSON.stringify(a.headings) !== JSON.stringify(b.headings)) {
        label(`heading levels ${JSON.stringify(a.headings)} vs ${JSON.stringify(b.headings)}`);
      }
      if (a.fences !== b.fences) label(`fenced blocks ${a.fences} vs ${b.fences}`);
      if (JSON.stringify(a.tables) !== JSON.stringify(b.tables)) {
        label(`tables ${JSON.stringify(a.tables)} vs ${JSON.stringify(b.tables)}`);
      }
      for (const key of ['subcommands', 'flags']) {
        const only = a[key].filter((x) => !b[key].includes(x));
        const missing = b[key].filter((x) => !a[key].includes(x));
        if (only.length || missing.length) {
          label(`${key} only in zh: ${only.join(', ') || '-'} / only in en: ${missing.join(', ') || '-'}`);
        }
      }
    }

    assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);
  });

  test('the derived dispatch list matches the CLI\'s own command list', async () => {
    // Why this test belongs to the mirror guard rather than to the CLI: the
    // guard filters `euthyna <word>` mentions against cliSubcommands(), and a
    // list that silently lost a name would drop that command from *both*
    // editions' identifier sets and pass. Asserting "not empty" only catches a
    // total collapse, so the list is cross-checked against the enumeration the
    // CLI shows users — in both languages, because they mirror each other too.
    const cli = await readFile(path.join(ROOT, 'src/cli.js'), 'utf8');
    const listed = (marker) => {
      const block = new RegExp(`${marker}:\\n([\\s\\S]*?)\\n\\n`).exec(cli)?.[1] ?? '';
      return [...new Set([...block.matchAll(/^ {2}([a-z][a-z0-9-]*)\s{2,}/gm)].map((m) => m[1]))].sort();
    };
    const [zh, en] = [listed('命令'), listed('Commands')];
    const real = await cliSubcommands();

    assert.ok(real.length > 0, 'no subcommand derived from src/cli.js');
    assert.deepEqual(zh, en, `the CLI's command list differs between its zh and English help:\nzh ${zh}\nen ${en}`);
    // `help` is dispatched but not a documented command, so it is the one name
    // the dispatch may carry that the help does not list.
    assert.deepEqual(
      real.filter((name) => name !== 'help'),
      zh,
      `dispatch and help disagree — dispatch ${real}, help ${zh}`
    );
  });
});

/**
 * The parity test is only as good as the scan, and every rule above has a legal
 * Markdown form that used to be invisible to it. These cases pin the scan itself
 * on crafted documents, so a rule is demonstrated rather than asserted from the
 * mirror's green colour.
 */
describe('the structure scan reads the Markdown forms it claims', () => {
  const s = (text) => structure(text, ['audit', 'coverage', 'deps', 'gate', 'help', 'history']);

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
  });
});
