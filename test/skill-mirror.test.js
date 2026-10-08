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
 *   - per file: heading-level sequence, fenced-block count, table shapes in order
 *   - per file: the set of `euthyna <subcommand>` mentions and the set of `--flags`
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
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.relative(base, abs).replace(/\\/g, '/'));
  }
  return out.sort();
}

/** Frontmatter is language-specific by design: name, description, whenToUse. */
const stripFrontmatter = (text) => text.replace(/^---[\s\S]*?---\n?/, '');

function structure(text) {
  const body = stripFrontmatter(text);
  const headings = [...body.matchAll(/^#{1,6}\s/gm)].map((m) => m[0].length);

  const tables = [];
  let current = null;
  for (const line of body.split('\n')) {
    if (/^\|/.test(line)) {
      const columns = line.split('|').length - 2;
      if (!current) {
        current = { columns, rows: 0 };
        tables.push(current);
      }
      current.rows += 1;
    } else {
      current = null;
    }
  }

  return {
    headings,
    fences: (body.match(/^\s*```/gm) ?? []).length,
    tables,
    subcommands: [...new Set([...body.matchAll(/euthyna (audit|history|coverage|deps|gate)/g)].map((m) => m[0]))].sort(),
    flags: [...new Set([...body.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]))].sort()
  };
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
    const zh = await filesUnder(ZH);
    const diffs = [];

    for (const rel of zh) {
      const zhText = await readFile(path.join(ZH, rel), 'utf8');
      const enText = await readFile(path.join(EN, rel), 'utf8');
      const a = structure(zhText);
      const b = structure(enText);

      const label = (what) => `${rel}: ${what}`;
      if (a.headings.length !== b.headings.length || a.headings.some((h, i) => h !== b.headings[i])) {
        diffs.push(label(`heading levels ${a.headings.join(',')} vs ${b.headings.join(',')}`));
      }
      if (a.fences !== b.fences) diffs.push(label(`fenced blocks ${a.fences} vs ${b.fences}`));
      if (JSON.stringify(a.tables) !== JSON.stringify(b.tables)) {
        diffs.push(label(`tables ${JSON.stringify(a.tables)} vs ${JSON.stringify(b.tables)}`));
      }
      for (const key of ['subcommands', 'flags']) {
        const only = a[key].filter((x) => !b[key].includes(x));
        const missing = b[key].filter((x) => !a[key].includes(x));
        if (only.length || missing.length) {
          diffs.push(label(`${key} only in zh: ${only.join(', ') || '-'} / only in en: ${missing.join(', ') || '-'}`));
        }
      }
    }

    assert.deepEqual(diffs, [], `\n${diffs.join('\n')}`);
  });
});
