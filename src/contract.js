/**
 * The fact contract, in code.
 *
 * Facts produced here are consumed by an adjudication layer. Two properties are
 * enforced mechanically rather than by convention, because a convention is what
 * erodes first:
 *
 *   1. Facts carry no verdict. No score, no severity, no recommendation. A
 *      measurement layer that emits "risk: high" has decided for the
 *      adjudicator, and the decision is not reproducible.
 *   2. Every fact is three-state. "Established", "refuted" and "unknown" are
 *      distinct, and a missing measurement is never silently reported as clean.
 *
 * See docs/fact-contract-zh.md.
 */

import { stripVTControlCharacters } from 'node:util';

export const SCHEMA_VERSION = '0.1';

/**
 * Quote a value for pasting into a POSIX shell.
 *
 * Single quotes make every byte literal except the single quote itself, which
 * the `'\''` idiom escapes. JSON.stringify is not enough here: inside double
 * quotes a backtick or $( ) still executes, so a repo-controlled filename or
 * symbol would survive it as code, not data.
 */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * Render repo-controlled text safely for the terminal: every C0 control and
 * DEL becomes a visible escape (\n, \r, \t, else \xHH). Nothing is preserved
 * raw — a literal \r would let a filename overwrite the report line on screen
 * — and nothing is deleted silently — a command whose BEL was dropped would
 * no longer reproduce the fact when pasted. stripVTControlCharacters removes
 * complete CSI/OSC sequences first; the regex catches the stragglers.
 */
export function safeText(value) {
  return stripVTControlCharacters(String(value)).replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

/**
 * safeText for multi-line text: every line is made terminal-safe, real newlines
 * are preserved as structure. The render boundary never sees a newline
 * (renderReport writes line by line), but the error path does — a stack trace
 * flattened into one line of \n escapes would be unreadable. What must never
 * survive is a control that acts on the terminal: CR (line overwrite), BEL,
 * ESC, every other C0 and DEL are still made visible, per line.
 */
export function safeTextLines(value) {
  return String(value)
    .split('\n')
    .map(safeText)
    .join('\n');
}

/** Fact kinds. Kept explicit so an unknown kind fails loudly instead of passing. */
export const KIND = Object.freeze({
  HISTORY: 'history',
  REINTRODUCTION: 'reintroduction',
  TEST_COVERAGE: 'test_coverage'
});

/** Fact status. `unknown` is a first-class value, not an error. */
export const STATUS = Object.freeze({
  ESTABLISHED: 'established',
  REFUTED: 'refuted',
  UNKNOWN: 'unknown'
});

/**
 * Keys that must never appear on a fact: they belong to the adjudication layer.
 * Checked recursively so a nested object cannot smuggle one in.
 */
const FORBIDDEN_KEYS = [
  'severity',
  'score',
  'risk',
  'confidence_score',
  'recommendation',
  'remediation',
  'fix',
  'verdict',
  'exploitable',
  'priority'
];

/**
 * Throw if a value contains a key reserved for the adjudication layer.
 * A measurement layer that can set these has stopped being a measurement layer.
 */
export function assertNoVerdictFields(value, path = 'fact') {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoVerdictFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      throw new Error(
        `fact contract violation: "${path}.${key}" is reserved for the adjudication layer. ` +
          `The measurement layer must not emit ${key}.`
      );
    }
    assertNoVerdictFields(child, `${path}.${key}`);
  }
}

/**
 * Build one fact. Throws when a required field is missing, so a malformed fact
 * cannot reach the adjudication layer and be read as a weaker claim than intended.
 *
 * @param {object} input
 * @param {string} input.kind       one of KIND
 * @param {string} input.statement  one sentence a human can check
 * @param {string} input.status     one of STATUS
 * @param {object} input.evidence   {file, line?, commit?, snippet?}
 * @param {string} input.method     'command' | 'static' | 'tool'
 * @param {string} [input.command]  required when method is 'command'
 * @param {'exact'|'approximate'} [input.confidence]
 * @param {object} [input.detail]   kind-specific structured payload
 * @param {string} input.id
 */
export function makeFact(input) {
  const { id, kind, statement, status, evidence, method, command, confidence = 'exact', detail } = input;

  if (!id) throw new Error('fact requires an id');
  if (!Object.values(KIND).includes(kind)) throw new Error(`fact ${id}: unknown kind "${kind}"`);
  if (!Object.values(STATUS).includes(status)) throw new Error(`fact ${id}: unknown status "${status}"`);
  if (!statement) throw new Error(`fact ${id}: statement is required`);
  if (!evidence || !evidence.file) throw new Error(`fact ${id}: evidence.file is required`);
  if (method === 'command' && !command) {
    throw new Error(`fact ${id}: method "command" requires the reproducible command`);
  }

  const fact = {
    id,
    kind,
    statement,
    status,
    evidence,
    method,
    ...(command ? { command } : {}),
    confidence,
    ...(detail ? { detail } : {})
  };

  assertNoVerdictFields(fact);
  return fact;
}

/**
 * Build the report envelope.
 *
 * `notEvaluated` is the honesty surface: anything the producer could not
 * measure must be listed with a reason. An empty `notEvaluated` alongside zero
 * facts means "measured, nothing found"; a populated one means "do not read
 * this as clean".
 */
export function makeReport({ producer, subject, facts, evaluated = [], notEvaluated = [] }) {
  for (const fact of facts) assertNoVerdictFields(fact);
  return {
    schemaVersion: SCHEMA_VERSION,
    producer,
    subject,
    facts,
    coverage: { evaluated, notEvaluated }
  };
}

/** Convenience: an entry for the coverage.notEvaluated list. */
export function notEvaluated(kind, reason) {
  if (!reason) throw new Error(`notEvaluated("${kind}") requires a specific reason`);
  return { kind, reason };
}

/**
 * Render a report for a terminal reader.
 *
 * Ordering is deliberate: what was NOT measured comes last but is never
 * omitted, so a reader cannot finish the output without seeing it.
 */
export function renderReport(report, { write: rawWrite = console.log } = {}) {
  // Render boundary: every repo-controlled string below passes through safeText
  // exactly once, here, rather than at each producer. The JSON channel
  // (cli.js) needs no equivalent — JSON.stringify escapes control bytes.
  const write = (line) => rawWrite(safeText(line));
  const { producer, subject, facts, coverage } = report;

  const established = facts.filter(f => f.status === STATUS.ESTABLISHED);
  const refuted = facts.filter(f => f.status === STATUS.REFUTED);
  const unknown = facts.filter(f => f.status === STATUS.UNKNOWN);

  write('');
  write(`euthyna ${producer.name} — ${producer.purpose || ''}`.trim());
  write(`目标: ${subject.repo ?? subject.coverageFile ?? '(未指定)'}`);
  if (subject.base || subject.head) {
    write(`范围: ${subject.base ?? '?'}..${subject.head ?? 'HEAD'}`);
  }
  write('');

  const section = (title, list) => {
    if (list.length === 0) return;
    write(`${title} (${list.length})`);
    for (const fact of list) {
      write(`  • ${fact.statement}`);
      const where = [fact.evidence.file, fact.evidence.line].filter(Boolean).join(':');
      write(`      证据: ${where}${fact.evidence.commit ? ` (${fact.evidence.commit.slice(0, 10)})` : ''}`);
      if (fact.command) write(`      复现: ${fact.command}`);
      if (fact.confidence === 'approximate') {
        write('      ⚠ approximate —— 不得用于门禁判定');
      }
    }
    write('');
  };

  section('已确证', established);
  section('已证伪', refuted);
  section('无法判定', unknown);

  if (facts.length === 0) {
    write('  本次运行没有产出任何事实。');
    write('');
  }

  if (coverage.notEvaluated.length > 0) {
    write('⚠ 未评估的判据（缺数据不等于干净）：');
    for (const item of coverage.notEvaluated) {
      write(`  • ${item.kind}: ${item.reason}`);
    }
    write('');
  }

  if (coverage.evaluated.length > 0) {
    write('已评估的判据：');
    for (const item of coverage.evaluated) {
      write(`  • ${item.kind}: ${item.count} 条 (${item.producer})`);
    }
    write('');
  }
}
