/**
 * i18n: the language switch, the bilingual report renderer, and the gate
 * parser accepting report markers in either language.
 *
 * The default stays Chinese, and the existing suite already pins the Chinese
 * output byte for byte. This file pins the other half: English output on
 * request, English report markers parsing, and the precedence rules of the
 * switch (--lang beats EUTHYNA_LANG beats the default).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveLang, T, isLang, DEFAULT_LANG } from '../src/lang.js';
import { makeReport, renderReport, makeFact, notEvaluated, KIND, STATUS } from '../src/contract.js';
import { parseGateReport, validateFindings, renderGateReport, isNotEvaluatedStatus, isPassStatus } from '../src/gate.js';
import { EXIT } from '../src/cli.js';

describe('src/lang.js', () => {
  test('defaults to Chinese and switches on --lang en', () => {
    assert.equal(resolveLang({}), DEFAULT_LANG);
    assert.equal(resolveLang({ flag: 'en' }), 'en');
    assert.equal(resolveLang({ flag: 'zh' }), 'zh');
  });

  test('EUTHYNA_LANG=en switches, and the flag beats the environment', () => {
    assert.equal(resolveLang({ env: { EUTHYNA_LANG: 'en' } }), 'en');
    assert.equal(resolveLang({ flag: 'zh', env: { EUTHYNA_LANG: 'en' } }), 'zh');
    assert.equal(
      resolveLang({ env: { EUTHYNA_LANG: 'fr' } }),
      'zh',
      'an unknown environment value falls back to the default'
    );
  });

  test('isLang accepts only zh and en', () => {
    assert.equal(isLang('zh'), true);
    assert.equal(isLang('en'), true);
    assert.equal(isLang('fr'), false);
    assert.equal(isLang(undefined), false);
  });

  test('T picks the English string only for en', () => {
    assert.equal(T('zh')('已确证', 'Established'), '已确证');
    assert.equal(T('en')('已确证', 'Established'), 'Established');
  });
});

describe('renderReport language', () => {
  function sampleReport(purpose) {
    return makeReport({
      producer: { name: 'euthyna-test', version: '0.1.0', purpose },
      subject: { repo: '/tmp/repo', base: 'abc1234', head: 'HEAD' },
      facts: [
        makeFact({
          id: 'f1',
          kind: KIND.HISTORY,
          status: STATUS.ESTABLISHED,
          statement: 'fact statement',
          evidence: { file: 'a.js', line: 3 },
          method: 'static'
        })
      ],
      evaluated: [{ kind: KIND.HISTORY, producer: 'euthyna-test', count: 1 }],
      notEvaluated: [notEvaluated(KIND.HISTORY, 'a reason')]
    });
  }

  function render(report, lang) {
    const lines = [];
    renderReport(report, { write: (line) => lines.push(line), lang });
    return lines.join('\n');
  }

  test('Chinese by default', () => {
    const out = render(sampleReport('测试'), 'zh');
    assert.match(out, /目标: \/tmp\/repo/);
    assert.match(out, /范围: abc1234\.\.HEAD/);
    assert.match(out, /已确证 \(1\)/);
    assert.match(out, /证据: a\.js:3/);
    assert.match(out, /未评估的判据/);
    assert.match(out, /已评估的判据/);
  });

  test('English on request', () => {
    const out = render(sampleReport('test'), 'en');
    assert.match(out, /Target: \/tmp\/repo/);
    assert.match(out, /Range: abc1234\.\.HEAD/);
    assert.match(out, /Established \(1\)/);
    assert.match(out, /Evidence: a\.js:3/);
    assert.match(out, /Criteria not evaluated/);
    assert.match(out, /Evaluated criteria/);
    assert.doesNotMatch(out, /目标:|证据:|已确证/);
  });
});

describe('gate parses report markers in either language', () => {
  const EN_TP = [
    'BUG #1 TRUE POSITIVE — command injection in exec',
    '  All gates passed. Evidence: src/archive.js:42 (abc1234)',
    '  Reproduce: node bench/exploits.js p3',
    '  Exploitability: EASY',
    '  Impact: arbitrary command execution',
    ''
  ].join('\n');

  const EN_FP = [
    'BUG #2 FALSE POSITIVE — integer underflow',
    '  Gate 5 (Mathematical Boundary) FAIL: line 98 checks packet_size >= 16, underflow is mathematically impossible',
    ''
  ].join('\n');

  const EN_INCONCLUSIVE = [
    'BUG #3 INCONCLUSIVE — dependency exploitability unknown',
    '  Gate 6 (Environment) NOT EVALUATED: the production environment for this dependency version is unknown',
    ''
  ].join('\n');

  test('an English report parses into the same shape as a Chinese one', () => {
    const { findings, unparseable } = parseGateReport(`${EN_TP}\n${EN_FP}\n${EN_INCONCLUSIVE}\n`);
    assert.equal(findings.length, 3);
    assert.equal(unparseable.length, 0);

    assert.equal(findings[0].verdict, 'TRUE POSITIVE');
    assert.ok(findings[0].allPass, 'All gates passed. is recognised');
    assert.equal(findings[0].evidence.file, 'src/archive.js');
    assert.equal(findings[0].evidence.line, 42);
    assert.equal(findings[0].evidence.commit, 'abc1234');
    assert.equal(findings[0].reproduce, 'node bench/exploits.js p3');
    assert.equal(findings[0].impact, 'arbitrary command execution');

    assert.equal(findings[1].verdict, 'FALSE POSITIVE');
    assert.equal(findings[1].gates.length, 1);
    assert.equal(findings[1].gates[0].number, 5);
    assert.equal(findings[1].gates[0].name, 'Mathematical Boundary');
    assert.equal(findings[1].gates[0].status, 'FAIL');
    assert.match(findings[1].gates[0].reason, /packet_size/);

    assert.equal(findings[2].verdict, 'INCONCLUSIVE');
    assert.equal(findings[2].gates[0].status, 'NOT EVALUATED');
    assert.match(findings[2].gates[0].reason, /production environment/);
  });

  test('an English report with six PASS lines validates as TRUE POSITIVE', () => {
    const text = [
      'BUG #1 TRUE POSITIVE - X',
      '  Gate 1 (Process) PASS: followed the full procedure',
      '  Gate 2 (Reachability) PASS: attacker-controlled input',
      '  Gate 3 (Real Impact) PASS: information disclosure',
      '  Gate 4 (PoC Verification) PASS: real payload',
      '  Gate 5 (Mathematical Boundary) PASS: holds',
      '  Gate 6 (Environment) PASS: no guard in production',
      '  Evidence: src/a.js:3',
      '  Reproduce: node p.js',
      '  Impact: leaks internal files'
    ].join('\n');
    const [entry] = validateFindings(parseGateReport(text).findings);
    assert.equal(entry.downgraded, false, 'a complete English TRUE POSITIVE passes the contract');
  });

  test('status helpers normalise both languages', () => {
    assert.equal(isPassStatus('通过'), true);
    assert.equal(isPassStatus('PASS'), true);
    assert.equal(isNotEvaluatedStatus('未评估'), true);
    assert.equal(isNotEvaluatedStatus('NOT EVALUATED'), true);
    assert.equal(isNotEvaluatedStatus('not evaluated'), true);
    assert.equal(isNotEvaluatedStatus('FAIL'), false);
  });

  test('violations are rendered in the requested language', () => {
    const [entry] = validateFindings(
      parseGateReport('BUG #1 TRUE POSITIVE — x\n').findings,
      { lang: 'en' }
    );
    assert.ok(
      entry.violations.some((v) => /missing evidence/i.test(v)),
      'English violations for an English session'
    );
    const [zhEntry] = validateFindings(parseGateReport('BUG #1 TRUE POSITIVE — x\n').findings);
    assert.ok(zhEntry.violations.some((v) => /缺少证据/.test(v)), 'Chinese stays the default');
  });
});

describe('renderGateReport language', () => {
  test('English labels on request', () => {
    const findings = [
      {
        finding: { number: 1, verdict: 'TRUE POSITIVE', claim: 'x', gates: [] },
        violations: ['missing evidence (a TRUE POSITIVE must carry Evidence: path:L123)'],
        downgraded: true
      }
    ];
    const lines = [];
    renderGateReport(
      { file: 'report.md', findings, unparseable: [], downgraded: 1, verify: false },
      { write: (line) => lines.push(line), lang: 'en' }
    );
    const out = lines.join('\n');
    assert.match(out, /Report: report\.md/);
    assert.match(out, /downgraded to "observation"/);
    assert.match(out, /1 finding downgraded/);
    assert.doesNotMatch(out, /报告:|降级为「观察」/);
  });
});

describe('CLI language switch', () => {
  function capture(stream) {
    const chunks = [];
    const original = stream.write.bind(stream);
    stream.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    return () => {
      stream.write = original;
      return chunks.join('');
    };
  }

  test('--lang en produces English report output', async () => {
    const { main } = await import('../src/cli.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-i18n-'));
    const restore = capture(process.stdout);
    let code;
    try {
      code = await main(['deps', '--repo', dir, '--dep', 'lodash', '--lang', 'en']);
    } finally {
      const out = restore();
      assert.equal(code, EXIT.UNMEASURED, 'no manifest means cannot measure');
      assert.match(out, /Target:/);
      assert.match(out, /Criteria not evaluated/);
      assert.doesNotMatch(out, /目标:|未评估的判据/);
    }
  });

  test('EUTHYNA_LANG=en switches without the flag', async () => {
    const { main } = await import('../src/cli.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-i18n-'));
    const restore = capture(process.stdout);
    const previous = process.env.EUTHYNA_LANG;
    process.env.EUTHYNA_LANG = 'en';
    let code;
    try {
      code = await main(['deps', '--repo', dir, '--dep', 'lodash']);
    } finally {
      if (previous === undefined) delete process.env.EUTHYNA_LANG;
      else process.env.EUTHYNA_LANG = previous;
      const out = restore();
      assert.equal(code, EXIT.UNMEASURED);
      assert.match(out, /Target:/);
    }
  });

  test('an unknown --lang value is a usage error, not a silent fallback', async () => {
    const { main } = await import('../src/cli.js');
    const restore = capture(process.stderr);
    let code;
    try {
      code = await main(['deps', '--lang', 'fr', '--dep', 'x']);
    } finally {
      const err = restore();
      assert.equal(code, EXIT.USAGE);
      assert.match(err, /fr/);
    }
  });

  test('the gate command reads an English report and renders English output', async () => {
    const { main } = await import('../src/cli.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'euthyna-i18n-'));
    const file = path.join(dir, 'report-en.md');
    await writeFile(
      file,
      [
        'BUG #1 TRUE POSITIVE — x',
        '  Gate 1 (Process) PASS: followed',
        '  Gate 2 (Reachability) PASS: attacker-controlled',
        '  Gate 3 (Real Impact) PASS: disclosure',
        '  Gate 4 (PoC Verification) PASS: real payload',
        '  Gate 5 (Mathematical Boundary) PASS: holds',
        '  Gate 6 (Environment) PASS: no guard',
        '  Evidence: src/a.js:3',
        '  Reproduce: node p.js',
        '  Impact: leaks files',
        ''
      ].join('\n'),
      'utf8'
    );
    const restore = capture(process.stdout);
    let code;
    try {
      code = await main(['gate', file, '--lang', 'en']);
    } finally {
      const out = restore();
      assert.equal(code, EXIT.CLEAN);
      assert.match(out, /All findings pass the gate contract\./);
      assert.match(out, /passed/);
    }
  });
});
