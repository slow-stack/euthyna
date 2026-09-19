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
import { makeFact, notEvaluated as notEvaluatedEntry, KIND, STATUS } from '../contract.js';

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
    `euthyna coverage --coverage ${JSON.stringify(coverageFile)} ` +
    `--symbol ${JSON.stringify(symbol)}` +
    (file ? ` --file ${JSON.stringify(file)}` : '')
  );
}

/**
 * Read a c8/v8-to-istanbul coverage-final.json.
 *
 * Note the shape: per-file keys are path/all/statementMap/s/branchMap/b/fnMap/f.
 * There is no istanbul `hash`, and `branchMap` is a relabelled V8 block range
 * rather than an if/else model, so a consumer written against classic istanbul
 * field lists reads the wrong thing.
 */
export async function loadCoverage(coverageFile) {
  const raw = await readFile(coverageFile, 'utf8');
  return JSON.parse(raw);
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

  const entries = Object.entries(coverage).filter(([, v]) => v && typeof v === 'object');

  if (entries.length === 0) {
    // An empty object is what c8 produces when the tests never loaded the code
    // under test. Reporting "no facts" would read as clean, so say so explicitly.
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        '覆盖率数据为空对象。这通常意味着测试运行没有加载到被测代码（常见于缺少 --all），' +
          '因此任何「未在数据中」的文件都必须按未覆盖处理，而这里连文件清单都没有'
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
          `${target.file} 命中 c8 的默认排除规则，很可能根本不在覆盖率数据里。` +
            '需要显式 --all 或调整 exclude 才能测到它'
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
          command: 'npx c8 --all --reporter=json <test-command>',
          detail: { symbol: target.symbol, reason: 'file_absent_from_coverage' }
        })
      );
      continue;
    }

    let matched = 0;
    for (const [entryPath, entry] of scoped) {
      const fnMap = entry.fnMap ?? {};
      const counts = entry.f ?? {};

      const hits = Object.entries(fnMap).filter(([, meta]) => meta && meta.name === target.symbol);
      if (hits.length === 0) continue;

      for (const [index, meta] of hits) {
        matched++;
        const count = Number(counts[index] ?? 0);
        const line = meta.decl?.start?.line ?? meta.loc?.start?.line ?? meta.line ?? null;

        if (count === 0) {
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
                `符号 ${target.symbol} 被调用了 ${count} 次，但调用计数非零**不能**证明任何特定调用点执行过 —— ` +
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
            ' —— 可能是被重命名、被内联，或它只在模块顶层出现（c8 把这类调用点放在 branchMap 而非 fnMap）',
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
    count: facts.length
  });

  return { facts, evaluated, notEvaluated, measured: true };
}
