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
