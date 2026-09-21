/**
 * Coverage facts: was this symbol ever actually invoked?
 *
 * Scoped deliberately. V8 block coverage cannot prove a call site ran, and the
 * inverse of that limitation is dangerous: it *does* report unreachable code as
 * covered (nodejs/node#57435), so a naive "the line is covered, therefore the
 * call ran" join reports a call site that never executed as executed. That is
 * wrong in the one direction a security audit cannot afford, because it hides a
 * real gap and manufactures confidence at the same time.
 *
 * So this producer emits exactly two outcomes and no third one:
 *
 *   count === 0  ->  established: the symbol was never invoked
 *   count  > 0   ->  unknown: the symbol was entered, but that says nothing
 *                    about whether any particular call site reached it
 *
 * There is no code path here that emits "executed". That is the design, not an
 * omission. See docs/fact-contract-zh.md section 6.2.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeFact, notEvaluated as notEvaluatedEntry, KIND, STATUS, shellQuote } from '../contract.js';

/** c8's default exclusions. A production file matching one of these vanishes from the report. */
const C8_DEFAULT_EXCLUDES = [
  /(^|\/)node_modules\//,
  /(^|\/)test\//,
  /(^|\/)tests\//,
  /(^|\/)__tests__\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.d\.ts$/
];

/** Normalize for comparison: coverage keys are absolute, callers may pass relative paths. */
function normalize(p) {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function matchesTarget(entryPath, target) {
  const a = normalize(entryPath);
  const b = normalize(target);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

/**
 * The reproducible command for a coverage fact.
 *
 * Self-referential on purpose: re-running this producer with the same arguments
 * reproduces the fact. Embedding a language-specific one-liner instead would
 * break on any path containing a quote, and the point of the field is that a
 * reader can re-derive the claim without trusting this report.
 */
function reproduceCommand({ coverageFile, symbol, file }) {
  return (
    `euthyna coverage --coverage ${shellQuote(coverageFile)} ` +
    `--symbol ${shellQuote(symbol)}` +
    (file ? ` --file ${shellQuote(file)}` : '')
  );
}

/**
 * Read a coverage report.
 *
 * Three formats are accepted, all identified by shape rather than by filename:
 *
 * 1. c8 / v8-to-istanbul `coverage-final.json` — per-file keys are
 *    path/all/statementMap/s/branchMap/b/fnMap/f. There is no istanbul `hash`,
 *    and `branchMap` is a relabelled V8 block range rather than an if/else
 *    model, so a consumer written against classic istanbul field lists reads
 *    the wrong thing.
 * 2. classic istanbul (jest's default provider, nyc) `coverage-final.json` —
 *    the same per-file statementMap/s/branchMap/b/fnMap/f plus a `hash` field.
 *    The symbol locator only reads fnMap/f, which classic istanbul and c8 emit
 *    in the same shape, so both resolve through the same code path.
 * 3. coverage.py JSON (`coverage json`, format 3) — top level is
 *    `{meta, files}`, and per-file `functions` maps a function name
 *    (`name`, or `Class.method` for methods) to
 *    `{executed_lines, missing_lines, start_line, ...}`. There is **no
 *    invocation counter**: an empty `executed_lines` array is the only
 *    evidence that the function was never entered. coverage.py reports
 *    functions that were never called as long as their module was loaded,
 *    which is exactly what makes "never invoked" an established fact.
 *
 * Anything that matches none of these shapes is **not a coverage report this
 * producer can read**, and is reported as notEvaluated — never fed through the
 * locator, where it would answer "symbol not located" with a straight face.
 */
export async function loadCoverage(coverageFile) {
  const raw = await readFile(coverageFile, 'utf8');
  return JSON.parse(raw);
}

/**
 * True for coverage.py's `{"meta": {...}, "files": {...}}` shape.
 * A c8 report never has a top-level `meta` key.
 */
function isCoveragePyReport(coverage) {
  return (
    coverage &&
    typeof coverage === 'object' &&
    coverage.meta &&
    typeof coverage.meta === 'object' &&
    coverage.files &&
    typeof coverage.files === 'object'
  );
}

/**
 * Identify the coverage format by shape, or null when the file is not a
 * coverage report at all. c8 and classic istanbul share the fnMap/f shape the
 * locator reads; they differ only in `hash` (istanbul has it, c8 does not) and
 * `all` (c8 has it), neither of which the locator reads — but naming the format
 * honestly is still part of the fact, so the distinction is kept.
 */
export function detectCoverageFormat(coverage) {
  if (isCoveragePyReport(coverage)) return 'coverage.py';

  const entries = Object.entries(coverage).filter(([, v]) => v && typeof v === 'object');
  if (entries.length === 0) return null;

  // A real c8/istanbul entry carries both `fnMap` (function metadata) and `f`
  // (per-index invocation counts). Requiring both stops a partial shape — a
  // file with `fnMap` but no `f`, say — from being classified as coverage and
  // then emitting "never invoked" for a count a missing `f` defaults to zero.
  // coverage.py's per-file `functions` is only valid inside a `meta.files`
  // report, which isCoveragePyReport already handled above; a bare `functions`
  // object is not a JS report and must not be accepted here.
  const jsShaped = entries.some(
    ([, e]) =>
      e.fnMap && typeof e.fnMap === 'object' && e.f && typeof e.f === 'object'
  );
  if (!jsShaped) return null;

  return entries.some(([, e]) => typeof e === 'object' && 'hash' in e) ? 'istanbul' : 'c8';
}

/**
 * Locate a symbol inside one file entry and normalise the hit.
 *
 * c8: `fnMap` holds `{name, decl, loc}` and `f` the invocation count per
 *     index. `line` comes from decl/loc start.
 * coverage.py: `functions` holds `name -> {executed_lines, ..., start_line}`.
 *     A method is named `Class.method`; the bare method name is accepted too,
 *     so a user asking about `method_called` finds `Guard.method_called`.
 *
 * Returns an array of `{ name, line, count, invoked }` where `count` is the
 * c8 invocation counter (coverage.py has none, so it is 0/1) and `invoked` is
 * `true` iff there is evidence the function was entered at least once.
 */
function locateSymbolInEntry(entry, symbol) {
  const hits = [];

  const fnMap = entry.fnMap;
  const counts = entry.f;
  if (fnMap && typeof fnMap === 'object') {
    for (const [index, meta] of Object.entries(fnMap)) {
      if (!meta || meta.name !== symbol) continue;
      const count = Number(counts?.[index] ?? 0);
      hits.push({
        name: meta.name,
        line: meta.decl?.start?.line ?? meta.loc?.start?.line ?? meta.line ?? null,
        count,
        invoked: count > 0
      });
    }
    return hits;
  }

  const functions = entry.functions;
  if (functions && typeof functions === 'object') {
    for (const [name, meta] of Object.entries(functions)) {
      if (!meta || typeof meta !== 'object') continue;
      if (name === symbol) {
        // module-level code has the empty name; it is not a callable symbol
        if (name === '') continue;
        const invoked = Array.isArray(meta.executed_lines) && meta.executed_lines.length > 0;
        hits.push({
          name,
          line: meta.start_line ?? null,
          count: invoked ? 1 : 0,
          invoked
        });
        continue;
      }
      if (name.includes('.') && name.endsWith('.' + symbol)) {
        const invoked = Array.isArray(meta.executed_lines) && meta.executed_lines.length > 0;
        hits.push({
          name,
          line: meta.start_line ?? null,
          count: invoked ? 1 : 0,
          invoked
        });
      }
    }
    return hits;
  }

  return hits;
}

/**
 * Collect coverage facts.
 *
 * `measured` distinguishes "the question was answered and the answer is empty"
 * from "the question could not be answered". Only the second is a measurement
 * failure, and conflating them would let a failed run look like a clean one.
 *
 * @param {object} options
 * @param {string} options.coverageFile
 * @param {Array<{file?: string, symbol: string}>} options.targets
 */
export async function collectCoverageFacts({ coverageFile, targets = [] } = {}) {
  const facts = [];
  const evaluated = [];
  const notEvaluated = [];
  let counter = 0;

  let coverage;
  try {
    coverage = await loadCoverage(coverageFile);
  } catch (error) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        `无法读取覆盖率数据 ${coverageFile}: ${error.code ?? error.message}。` +
          '未运行测试或测试未产出覆盖率时，这属于「未评估」，不是「未被覆盖」'
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  const isPy = isCoveragePyReport(coverage);

  // c8: entries are the report's file keys directly.
  // coverage.py: the file entries live under `files`.
  const entries = Object.entries(isPy ? (coverage.files ?? {}) : coverage).filter(
    ([, v]) => v && typeof v === 'object'
  );

  if (entries.length === 0) {
    // An empty report is what c8 produces when the tests never loaded the code
    // under test, and what coverage.py produces with an empty `files`. Reporting
    // "no facts" would read as clean, so say so explicitly.
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        '覆盖率数据为空对象。这通常意味着测试运行没有加载到被测代码（常见于缺少 --all 或 --source），' +
          '因此任何「未在数据中」的文件都必须按未覆盖处理，而这里连文件清单都没有'
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  // A non-empty object that matches no known shape is not a coverage report at
  // all. Feeding it through the locator would answer "symbol not located" with
  // a straight face — the confident wrong answer this producer exists to refuse.
  const format = detectCoverageFormat(coverage);
  if (format === null) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        '覆盖率数据不是可识别的报告形状（既无 c8/istanbul 的 fnMap/f，也无 coverage.py 的 functions）——' +
          '它可能根本不是覆盖率文件，任何「符号未定位/未覆盖」的结论在此都不可信'
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  if (targets.length === 0) {
    notEvaluated.push(notEvaluatedEntry(KIND.TEST_COVERAGE, '没有指定要查询的符号（--symbol）'));
    return { facts, evaluated, notEvaluated, measured: false };
  }

  for (const target of targets) {
    if (target.file && C8_DEFAULT_EXCLUDES.some(re => re.test(target.file.replace(/\\/g, '/')))) {
      notEvaluated.push(
        notEvaluatedEntry(
          KIND.TEST_COVERAGE,
          `${target.file} 命中默认排除规则（c8 排除 test/ 等目录），很可能根本不在覆盖率数据里。` +
            '需要显式 --all（c8）或 --source（coverage.py）或调整 exclude 才能测到它'
        )
      );
    }

    const scoped = target.file
      ? entries.filter(([entryPath]) => matchesTarget(entryPath, target.file))
      : entries;

    if (target.file && scoped.length === 0) {
      facts.push(
        makeFact({
          id: `coverage-${++counter}`,
          kind: KIND.TEST_COVERAGE,
          statement:
            `${target.file} 完全没有出现在覆盖率数据中 —— 测试运行期间该文件未被加载，` +
            `因此其中的符号 ${target.symbol} 未曾被执行`,
          status: STATUS.ESTABLISHED,
          evidence: { file: target.file },
          method: 'command',
          command: isPy
            ? 'coverage run --source=<package> <test-command> && coverage json'
            : 'npx c8 --all --reporter=json <test-command>',
          detail: { symbol: target.symbol, reason: 'file_absent_from_coverage' }
        })
      );
      continue;
    }

    let matched = 0;
    for (const [entryPath, entry] of scoped) {
      const hits = locateSymbolInEntry(entry, target.symbol);

      for (const hit of hits) {
        matched++;
        const line = hit.line;
        const count = hit.count;

        if (!hit.invoked) {
          facts.push(
            makeFact({
              id: `coverage-${++counter}`,
              kind: KIND.TEST_COVERAGE,
              statement:
                `符号 ${target.symbol} 在本次测试运行中一次都没有被调用（调用计数为 0）—— ` +
                `任何依赖它的行为都没有被执行验证`,
              status: STATUS.ESTABLISHED,
              evidence: { file: entryPath, line },
              method: 'command',
              command: reproduceCommand({ coverageFile, symbol: target.symbol, file: entryPath }),
              detail: { symbol: target.symbol, invocationCount: 0, reason: 'invocation_count_zero' }
            })
          );
        } else {
          // The tempting next step is to call this "executed". It is not:
          // entering a function says nothing about which call sites reached it,
          // and V8 reports some unreachable code as covered.
          facts.push(
            makeFact({
              id: `coverage-${++counter}`,
              kind: KIND.TEST_COVERAGE,
              statement:
                isPy
                  ? `符号 ${target.symbol} 至少被调用过一次，但被调用**不能**证明任何特定调用点执行过 —— ` +
                    `本事实只能证伪，不能证实`
                  : `符号 ${target.symbol} 被调用了 ${count} 次，但调用计数非零**不能**证明任何特定调用点执行过 —— ` +
                    `本事实只能证伪，不能证实`,
              status: STATUS.UNKNOWN,
              evidence: { file: entryPath, line },
              method: 'command',
              command: reproduceCommand({ coverageFile, symbol: target.symbol, file: entryPath }),
              detail: {
                symbol: target.symbol,
                invocationCount: count,
                reason: 'nonzero_count_cannot_prove_call_site_execution'
              }
            })
          );
        }
      }
    }

    if (matched === 0) {
      facts.push(
        makeFact({
          id: `coverage-${++counter}`,
          kind: KIND.TEST_COVERAGE,
          statement:
            `未能在覆盖率数据中定位符号 ${target.symbol}` +
            (target.file ? `（限定文件 ${target.file}）` : '') +
            (isPy
              ? ' —— 可能是被重命名、被内联，或它只在模块顶层出现'
              : ' —— 可能是被重命名、被内联，或它只在模块顶层出现（c8 把这类调用点放在 branchMap 而非 fnMap）'),
          status: STATUS.UNKNOWN,
          evidence: { file: target.file ?? '(未限定文件)' },
          method: 'static',
          detail: { symbol: target.symbol, reason: 'symbol_not_located_in_fnmap' }
        })
      );
    }
  }

  evaluated.push({
    kind: KIND.TEST_COVERAGE,
    producer: 'euthyna-coverage',
    format,
    count: facts.length
  });

  return { facts, evaluated, notEvaluated, measured: true };
}
