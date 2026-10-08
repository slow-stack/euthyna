/**
 * What differs between two documents, as human-readable labels.
 *
 * Both guards ask the same question of a pair, so the comparison lives in one
 * place: if the two files each grew their own version, one could report drift the
 * other waves through. `side` only names the two in the message.
 */
export function structureDiffs(a, b, side = { left: 'left', right: 'right' }) {
  const out = [];
  const same = (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]);

  if (a.openFence || b.openFence)
    out.push(`unclosed fence (${side.left} ${a.openFence ?? 'none'}, ${side.right} ${b.openFence ?? 'none'})`);
  if (!same('headings'))
    out.push(`heading levels ${JSON.stringify(a.headings)} vs ${JSON.stringify(b.headings)}`);
  if (a.fences !== b.fences)
    out.push(`fenced blocks ${a.fences} vs ${b.fences}`);
  if (!same('tables'))
    out.push(`tables ${JSON.stringify(a.tables)} vs ${JSON.stringify(b.tables)}`);
  for (const key of ['subcommands', 'flags']) {
    const only = a[key].filter((x) => !b[key].includes(x));
    const missing = b[key].filter((x) => !a[key].includes(x));
    if (only.length || missing.length) {
      out.push(`${key} only in ${side.left}: ${only.join(', ') || '-'} / only in ${side.right}: ${missing.join(', ') || '-'}`);
    }
  }
  return out;
}

/**
 * A small Markdown structure reader shared by the parity guards.
 *
 * Two tests need the same thing: `.agents/skills/euthyna` vs `-en` (the two skill
 * editions) and `docs/X-zh.md` vs `docs/X.md` (the original and its English
 * translation). Both ask "is this document built the same way as its twin", and
 * the only honest answer comes from one scan, not two that could disagree — the
 * review cycle on the skill guard found four legal Markdown forms that a
 * hand-written scan missed, and a second copy elsewhere would start out with the
 * same blind spots.
 *
 * What is read:
 *   - heading levels, ATX (`## …`) and Setext (`===` / `---` under a paragraph)
 *   - fenced blocks, where a closing marker must be at least as long as its opener
 *   - tables, with rows recognised with or without outer pipes, confirmed by their
 *     delimiter row, and `\|` treated as cell content rather than a boundary
 *   - identifiers: `--flag` tokens and `euthyna <subcommand>` mentions
 *
 * Headings and tables are counted outside fenced blocks only — a `#` comment in a
 * bash example is not a heading and a `|` in a diagram is not a table. Frontmatter
 * is cut line by line rather than by regex, because a body containing its own
 * `---` rule would otherwise swallow half the document.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function walk(dir, base, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, base, out);
    else if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(path.relative(base, abs).replace(/\\/g, '/'));
  }
  return out;
}

/** Every Markdown file under `dir`, as `/`-separated paths relative to `dir`. */
export async function filesUnder(dir) {
  return (await walk(dir, dir, [])).sort();
}

/**
 * Everything after the YAML frontmatter, as lines.
 *
 * Frontmatter is recognised only when the file's very first line is `---` and a
 * closing `---` line follows; anything else (a thematic break mid-document, a
 * file with no frontmatter at all) is left intact.
 */
export function bodyLines(text) {
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
 * real blind spot — a twin could carry a whole table the scan never saw.
 * A row counts as part of a table only when it holds a pipe; a table is
 * confirmed by its delimiter row, so prose containing `|` is not miscounted.
 */
const isTableRow = (line) => /^ {0,3}\S.*\|/.test(line) || /^ {0,3}\|/.test(line);
const isTableDelimiter = (line) => /^ {0,3}\|?[\s:]*-[\s:|.-]*$/.test(line) && line.includes('-') && line.includes('|');

/** Cell count with the outer pipes normalised away. */
function tableColumns(line) {
  // `\|` is GFM's escape for a literal pipe inside a cell, so it separates
  // nothing; counting it would make two documents that escaped it differently
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

/**
 * @param {string} text the document
 * @param {string[]} commandNames tokens that may count as an `euthyna <word>`
 *   mention; anything else is ordinary prose ("the euthyna repo") and is dropped
 */
export function structure(text, commandNames = []) {
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
  // as a flag missing from a documented invocation, and the twins do mirror such
  // sentences today ("`--coverage` 没有 `--repo`" ↔ "the coverage command has
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
    // Both written forms count: the documents cite commands as
    // `node <repo>/bin/euthyna.js coverage …` while prose says `euthyna gate`.
    // Missing the `.js` form was caught by mutation — a one-sided `deps`
    // invocation stayed invisible until the pattern accepted it.
    subcommands: [
      ...new Set([...joined.matchAll(/\beuthyna(?:\.js)?\s+([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]))
    ]
      .filter((name) => commandNames.includes(name))
      .sort(),
    flags: [...new Set([...joined.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]))].sort()
  };
}
