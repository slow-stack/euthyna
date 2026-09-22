/**
 * The gate discipline is a document, and documents can be edited. This test is
 * the deterministic guard behind issue #7's scenario: an agent that weakens
 * the skill's gates (removes one, loosens the verdict rules, drops the
 * evidence requirement) must turn CI red even though no model runs here.
 *
 * It does not prove adjudication quality — only that the written discipline
 * still contains the load-bearing pieces, and that the skill points at the
 * command (`euthyna gate`) that enforces them programmatically.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const skill = (rel) => path.join(ROOT, '.agents', 'skills', 'euthyna', rel);
const skillEn = (rel) => path.join(ROOT, '.agents', 'skills', 'euthyna-en', rel);

describe('the skill still declares the six gates', () => {
  test('all six gate names are present in verification-gates.md', async () => {
    const text = await readFile(skill('references/verification-gates.md'), 'utf8');
    for (const gate of ['流程', '可达性', '真实影响', 'PoC 验证', '数学边界', '环境']) {
      assert.match(text, new RegExp(gate), `the "${gate}" gate must stay in the skill`);
    }
  });

  test('the verdict rules are written down', async () => {
    const text = await readFile(skill('references/verification-gates.md'), 'utf8');
    assert.match(text, /门禁.*全部.*pass/s, 'all gates pass -> TRUE POSITIVE');
    assert.match(text, /任一门禁.*fail/s, 'any gate fail -> FALSE POSITIVE');
    assert.match(text, /not_evaluated|不可评估/, 'a not-evaluated gate -> INCONCLUSIVE');
  });

  test('the three verdicts survive', async () => {
    const text = await readFile(skill('SKILL.md'), 'utf8');
    for (const verdict of ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE']) {
      assert.match(text, new RegExp(verdict), `the ${verdict} verdict must stay`);
    }
  });
});

describe('the discipline stays mechanically enforceable', () => {
  test('SKILL.md requires file:line evidence and names the enforcer', async () => {
    const text = await readFile(skill('SKILL.md'), 'utf8');
    assert.match(text, /path:L\d+/, 'evidence must be file:line, not a bare file name');
    assert.match(text, /euthyna gate/, 'the skill must point at the programmatic gate');
    assert.match(text, /降级为「观察」/, 'the downgrade-to-observation rule must stay');
  });
});

describe('the invocation policy uses the keys the harness reads', () => {
  // Measured against @deepseek-ai/dsh-skill-filesystem 0.1.5-rc.2: the policy
  // comes from two TOP-LEVEL frontmatter keys, `disable-model-invocation` and
  // `user-invocable` (lib/index.js:841-851). A nested `invocation:` mapping —
  // the shape this file used to carry — is not read at all: it parses, no
  // warning is logged, and the skill silently becomes model-invocable, which is
  // the opposite of what it says. The legacy top-level spellings are rejected
  // outright.
  test('the policy is declared top-level, and no ignored mapping survives', async () => {
    const text = await readFile(skill('SKILL.md'), 'utf8');
    const frontmatter = text.split('---')[1] ?? '';
    assert.match(frontmatter, /^disable-model-invocation: true$/m, 'the harness reads a top-level disable-model-invocation');
    assert.match(frontmatter, /^user-invocable: true$/m, 'the harness reads a top-level user-invocable');
    assert.doesNotMatch(frontmatter, /^\s*invocation:/m, 'a nested invocation mapping is ignored, so it states policy while doing nothing');
    assert.doesNotMatch(frontmatter, /^\s*modelInvocable:/m, 'modelInvocable is a rejected legacy key');
  });
});

describe('the English skill mirrors the discipline', () => {
  test('all six gate names are present in English in verification-gates.md', async () => {
    const text = await readFile(skillEn('references/verification-gates.md'), 'utf8');
    for (const gate of ['Process', 'Reachability', 'Real Impact', 'PoC Verification', 'Mathematical Boundary', 'Environment']) {
      assert.match(text, new RegExp(gate), `the English "${gate}" gate must stay in the skill`);
    }
  });

  test('the English verdict rules are written down', async () => {
    const text = await readFile(skillEn('references/verification-gates.md'), 'utf8');
    assert.match(text, /All gates passed/i, 'all gates pass -> TRUE POSITIVE');
    assert.match(text, /FAIL/i, 'any gate fail -> FALSE POSITIVE');
    // The report marker is `NOT EVALUATED` (with a space); the rule table may
    // also spell the state `not_evaluated` (snake_case, as in the source). Both
    // are the same not-evaluated -> INCONCLUSIVE rule, so both are accepted.
    assert.match(text, /not[_ ]evaluated/i, 'a not-evaluated gate -> INCONCLUSIVE');
  });

  test('the English SKILL.md carries the verdicts, the enforcer and the downgrade rule', async () => {
    const text = await readFile(skillEn('SKILL.md'), 'utf8');
    for (const verdict of ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE']) {
      assert.match(text, new RegExp(verdict), `the ${verdict} verdict must stay`);
    }
    assert.match(text, /path:L\d+/, 'evidence must be file:line, not a bare file name');
    assert.match(text, /euthyna gate/, 'the skill must point at the programmatic gate');
    assert.match(text, /downgraded to "observation"/, 'the downgrade-to-observation rule must stay in English');
    assert.match(text, /All gates passed\. Evidence:/, 'the English adjudication markers must be the ones the gate parser reads');
  });

  test('the English invocation policy is declared top-level', async () => {
    const text = await readFile(skillEn('SKILL.md'), 'utf8');
    const frontmatter = text.split('---')[1] ?? '';
    assert.match(frontmatter, /^name: euthyna-en$/m, 'the English skill is a distinct loadable skill');
    assert.match(frontmatter, /^disable-model-invocation: true$/m, 'the harness reads a top-level disable-model-invocation');
    assert.match(frontmatter, /^user-invocable: true$/m, 'the harness reads a top-level user-invocable');
  });
});
