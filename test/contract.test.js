/**
 * The fact contract, tested at the level where it matters: can a measurement
 * layer smuggle a verdict into a fact, and can a malformed fact reach the
 * adjudication layer looking weaker than intended.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeFact, makeReport, assertNoVerdictFields, notEvaluated, renderReport, shellQuote, safeText, safeTextLines, STATUS, KIND } from '../src/contract.js';

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

describe('shellQuote', () => {
  test('a plain path stays readable', () => {
    assert.equal(shellQuote('src/a.js'), `'src/a.js'`);
  });

  test('an embedded single quote survives round-trip', () => {
    assert.equal(shellQuote("a'b.js"), `'a'\\''b.js'`);
  });

  test('shell metacharacters stay data: everything lands inside single quotes', () => {
    // The safety property is not "metacharacters disappear" (inside single
    // quotes $( ) and backticks are literal) — it is "no metacharacter is ever
    // outside a quoted context". Exactly: output starts and ends with a quote,
    // and the only inner quotes belong to the '\'' escape idiom.
    for (const hostile of ['a; id; b.js', 'a$(id)b.js', 'a`id`b.js', "a'b.js", "a; rm -rf /; #'b.js"]) {
      const q = shellQuote(hostile);
      assert.ok(q.startsWith("'") && q.endsWith("'"), `must open and close quoted: ${q}`);
      const inner = q.slice(1, -1).replaceAll(`'\\''`, '');
      assert.ok(!inner.includes("'"), `every inner quote must be the escape idiom: ${q}`);
    }
    assert.equal(shellQuote('a$(id)b.js'), `'a$(id)b.js'`);
  });
});

describe('safeText (render boundary)', () => {
  test('strips CSI and OSC sequences', () => {
    assert.equal(safeText('a\u001b[31mred\u001b[0mb'), 'aredb');
    assert.equal(safeText('a\u001b]0;pwned\u0007b'), 'ab');
  });

  test('escapes a lone BEL that stripVTControlCharacters misses', () => {
    assert.equal(safeText('ring\u0007end'), 'ring\\x07end');
  });

  test('escapes CR and LF instead of preserving them as terminal input', () => {
    // A literal \r would let a repo-controlled name overwrite the rendered
    // line on screen; the escape is visible data, not control.
    assert.equal(safeText('a\rb\nc'), 'a\\rb\\nc');
  });

  test('escapes other bare C0 controls but keeps text and spaces', () => {
    assert.equal(safeText('a\u0000\u0007\u001b[31mb'), 'a\\x00\\x07b');
    assert.equal(safeText('keep space and visible text'), 'keep space and visible text');
  });

  test('renderReport sanitizes repo-controlled strings before writing', () => {
    const report = makeReport({
      producer: { name: 'x', version: '0' },
      subject: { repo: 'normal' },
      facts: [
        makeFact({
          id: 'f1',
          kind: KIND.HISTORY,
          statement: 'deleted lines',
          status: STATUS.ESTABLISHED,
          evidence: { file: 'src/a.js' },
          method: 'command',
          command: 'git blame -- src/a.js'
        })
      ]
    });
    report.facts[0].evidence.file = '\u001b]0;pwned\u0007x.js';
    const lines = [];
    renderReport(report, { write: (l) => lines.push(l) });
    const all = lines.join('\n');
    assert.doesNotMatch(all, /\u001b|\u0007/, 'no escape byte may reach the writer');
    assert.match(all, /x\.js/, 'the readable suffix of the name survives');
  });

  test('rendered commands stay faithful: control bytes are escaped, not deleted', () => {
    // A command whose control byte was silently dropped would no longer
    // reproduce the fact when pasted; the escaped form still identifies the
    // real path while showing the byte as data.
    const report = makeReport({
      producer: { name: 'x', version: '0' },
      subject: { repo: 'normal' },
      facts: [
        makeFact({
          id: 'f1',
          kind: KIND.HISTORY,
          statement: 'deleted lines',
          status: STATUS.ESTABLISHED,
          evidence: { file: "src/be\u0007ll.js" },
          method: 'command',
          command: "git blame -- 'src/be\u0007ll.js'"
        })
      ]
    });
    const lines = [];
    renderReport(report, { write: (l) => lines.push(l) });
    const all = lines.join('\n');
    assert.doesNotMatch(all, /\u0007/, 'no raw BEL may reach the writer');
    assert.match(all, /src\/be\\x07ll\.js/, 'the command keeps the byte as a visible escape');
  });
});

describe('safeTextLines (stderr boundary)', () => {
  test('preserves line structure while making each line terminal-safe', () => {
    // A stack trace flattened into one line of \n escapes would be unreadable;
    // a control that acts on the terminal must not survive.
    assert.equal(safeTextLines('a\u0007b\nc\u001b[31md\ne'), 'a\\x07b\ncd\ne');
  });

  test('escapes CR so a repo-controlled name cannot overwrite a stack line', () => {
    assert.equal(safeTextLines('x\ry'), 'x\\ry');
  });

  test('is idempotent: a second pass through a boundary changes nothing', () => {
    const once = safeTextLines('git blame: fatal \u0007ring \u001b[31mred\ndone');
    assert.equal(safeTextLines(once), once);
  });
});
