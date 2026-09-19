/**
 * The fact contract, tested at the level where it matters: can a measurement
 * layer smuggle a verdict into a fact, and can a malformed fact reach the
 * adjudication layer looking weaker than intended.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeFact, makeReport, assertNoVerdictFields, notEvaluated, STATUS, KIND } from '../src/contract.js';

const validFact = {
  id: 'f1',
  kind: KIND.HISTORY,
  statement: 'something measurable happened',
  status: STATUS.ESTABLISHED,
  evidence: { file: 'src/a.js', line: 3 },
  method: 'command',
  command: 'git blame -L 3,3 HEAD -- src/a.js'
};

describe('makeFact validation', () => {
  test('accepts a well-formed fact', () => {
    const fact = makeFact(validFact);
    assert.equal(fact.kind, KIND.HISTORY);
    assert.equal(fact.confidence, 'exact');
  });

  test('rejects a fact with no evidence file', () => {
    assert.throws(
      () => makeFact({ ...validFact, evidence: {} }),
      /evidence\.file is required/
    );
  });

  test('rejects method "command" without a reproducible command', () => {
    assert.throws(
      () => makeFact({ ...validFact, command: undefined }),
      /requires the reproducible command/
    );
  });

  test('rejects an unknown kind rather than passing it downstream', () => {
    assert.throws(() => makeFact({ ...validFact, kind: 'vibes' }), /unknown kind/);
  });

  test('rejects an unknown status', () => {
    assert.throws(() => makeFact({ ...validFact, status: 'probably_fine' }), /unknown status/);
  });
});

describe('the verdict-field guard', () => {
  test('rejects a severity smuggled into a fact', () => {
    assert.throws(
      () => makeFact({ ...validFact, detail: { severity: 'high' } }),
      /reserved for the adjudication layer/
    );
  });

  test('rejects a score at the top level', () => {
    assert.throws(() => assertNoVerdictFields({ score: 9 }), /reserved for the adjudication layer/);
  });

  test('rejects a verdict nested inside an array', () => {
    assert.throws(
      () => assertNoVerdictFields({ items: [{ ok: true }, { recommendation: 'upgrade' }] }),
      /items\[1\]\.recommendation/
    );
  });

  test('names the offending path so the producer can fix it', () => {
    assert.throws(
      () => assertNoVerdictFields({ a: { b: { exploitable: true } } }),
      /fact\.a\.b\.exploitable/
    );
  });

  test('allows fields that describe measurement rather than judgement', () => {
    assert.doesNotThrow(() =>
      assertNoVerdictFields({
        invocationCount: 0,
        classification: 'security',
        commitSubject: 'fix: something',
        confidence: 'exact'
      })
    );
  });

  test('a report containing a bad fact is rejected as a whole', () => {
    assert.throws(
      () =>
        makeReport({
          producer: { name: 'x', version: '0' },
          subject: {},
          facts: [{ ...validFact, risk: 'critical' }]
        }),
      /reserved for the adjudication layer/
    );
  });
});

describe('notEvaluated', () => {
  test('requires a specific reason', () => {
    assert.throws(() => notEvaluated('history', ''), /requires a specific reason/);
  });

  test('carries the kind and the reason through', () => {
    assert.deepEqual(notEvaluated('history', 'no deletions in range'), {
      kind: 'history',
      reason: 'no deletions in range'
    });
  });
});

describe('report envelope', () => {
  test('always carries a coverage section, even when empty', () => {
    const report = makeReport({
      producer: { name: 'x', version: '0' },
      subject: { repo: '/tmp/x' },
      facts: []
    });
    assert.deepEqual(report.coverage, { evaluated: [], notEvaluated: [] });
    assert.equal(report.schemaVersion, '0.1');
  });
});
