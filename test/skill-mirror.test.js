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
 * The Markdown scan itself lives in ./markdown-structure.js, shared with the docs/
 * pairing guard, and its own rules are pinned in markdown-structure.test.js. This
 * file is only the skill-specific policy: which two trees are compared, and where
 * the list of real command names comes from.
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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesUnder, structure, structureDiffs } from './markdown-structure.js';
import { cliSubcommands } from './cli-commands.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ZH = path.join(ROOT, '.agents/skills/euthyna');
const EN = path.join(ROOT, '.agents/skills/euthyna-en');

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
    const real = await cliSubcommands(ROOT);
    const diffs = [];

    for (const rel of await filesUnder(ZH)) {
      const a = structure(await readFile(path.join(ZH, rel), 'utf8'), real);
      const b = structure(await readFile(path.join(EN, rel), 'utf8'), real);
      for (const what of structureDiffs(a, b, { left: 'zh', right: 'en' })) {
        diffs.push(`${rel}: ${what}`);
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
    const real = await cliSubcommands(ROOT);

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
