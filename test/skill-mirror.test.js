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
 *   - per file: heading-level sequence, table shapes (every row's column count),
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
  if ((lines[0] ?? '').trim() !== '---') return lines;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') return lines.slice(i + 1);
  }
  return lines; // unterminated: do not guess, keep the whole file
}

function structure(text, realCommands) {
  const lines = bodyLines(text);
  const headings = [];
  const tables = [];
  const fenceStarts = [];
  const identifiers = [];
  let fence = null; // the opening marker while inside a fenced block
  let table = null;

  for (const line of lines) {
    identifiers.push(line);

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const kind = marker[0];
      if (!fence) {
        fence = kind;
        fenceStarts.push(line);
        table = null;
        continue;
      }
      // a closing fence is the same character class and at least as long, with
      // no info string; anything else is content inside the block
      if (kind === fence && marker.length >= fence.length && fenceMatch[2].trim() === '') {
        fence = null;
        continue;
      }
      continue;
    }
    if (fence) continue; // a `#` comment in a bash example is not a heading

    const heading = /^ {0,3}(#{1,6})\s/.exec(line);
    if (heading) {
      headings.push(heading[1].length);
      table = null;
      continue;
    }

    const row = /^ {0,3}\|.*$/.exec(line);
    if (row) {
      const columns = row[0].split('|').length - 2;
      if (!table) {
        table = [];
        tables.push(table);
      }
      table.push(columns);
      continue;
    }
    table = null;
  }

  // Identifiers are read across the whole file, code examples included: the
  // `--flag` and `euthyna <subcommand>` occurrences that must match are the ones
  // in the commands an agent will copy. Prose is excluded from this concern's
  // reach in the other direction too — the Chinese note "`--coverage` 没有
  // `--repo`" is faithfully translated as "the coverage command has no `--repo`",
  // and naming the flag in prose is not what the parity is about.
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
      // Real commands come from src/cli.js, so one added there can never be
      // invisible here — see the "every dispatched command is documented" test.
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
 */
async function cliSubcommands() {
  const cli = await readFile(path.join(ROOT, 'src/cli.js'), 'utf8');
  return [...new Set([...cli.matchAll(/command === '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]))].sort();
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
});
