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
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { makeFact, notEvaluated as notEvaluatedEntry, KIND, STATUS, shellQuote } from '../contract.js';
import { T, DEFAULT_LANG } from '../lang.js';
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
function reproduceCommand({ coverageFile, symbol, file, source }) {
  return (
    `euthyna coverage --coverage ${shellQuote(coverageFile)} ` +
    `--symbol ${shellQuote(symbol)}` +
    (file ? ` --file ${shellQuote(file)}` : '') +
    (source ? ` --source ${shellQuote(source)}` : '')
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
 * 4. Go coverage profiles (`go test -coverprofile`) — text, `mode:` header
 *    plus one line per block (`path:startL.startC,endL.endC stmts count`).
 *    No function names: the two-state mapping runs through function ranges
 *    parsed from the gofmt'd source under --source (module root). A file
 *    absent from the profile is *not* evidence of "never executed" (the
 *    package may not be in the test binary), so absence is notEvaluated.
 *
 * Anything that matches none of these shapes is **not a coverage report this
 * producer can read**, and is reported as notEvaluated — never fed through the
 * locator, where it would answer "symbol not located" with a straight face.
 */
export async function loadCoverage(coverageFile) {
  const raw = await readFile(coverageFile, 'utf8');
  if (isGoProfileText(raw)) {
    const parsed = parseGoProfile(raw);
    if (!parsed) {
      throw new Error(
        'the file starts like a Go coverage profile ("mode:" header) but the body has lines that do not match ' +
          '"file:startLine.startCol,endLine.endCol numStatements count" — refusing to interpret it as coverage'
      );
    }
    return parsed;
  }
  return JSON.parse(raw);
}

/**
 * Go coverage profiles (`go test -coverprofile`) are text, not JSON:
 *
 *   mode: set
 *   github.com/nektos/act/pkg/artifacts/artifact.pb.go:42.2,43.29 2 0
 *
 * One line per *block* — a line range with a statement count and a hit count.
 * There are **no function names**, so a symbol query needs the source tree
 * (via --source, the module root) to map line ranges back to functions:
 * goFunctionRanges() reads the gofmt'd source, whose top-level `func`
 * declarations start at column 0 and end at a `}` at column 0.
 */
function isGoProfileText(raw) {
  const first = String(raw).split(/\r?\n/, 1)[0];
  return /^mode:\s*(set|count|atomic)\s*$/.test(first);
}

const GO_BLOCK_RE = /^(.+):(\d+)\.(\d+),(\d+)\.(\d+)\s+(\d+)\s+(\d+)$/;

/** Parse a Go profile into `{ __go, mode, files: Map<path, blocks[]> }`, or null if malformed. */
export function parseGoProfile(raw) {
  const lines = String(raw).split(/\r?\n/);
  const mode = /^mode:\s*(set|count|atomic)\s*$/.exec((lines[0] ?? '').trim())?.[1];
  if (!mode) return null;

  const files = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = GO_BLOCK_RE.exec(line);
    if (!m) return null;
    const [, file, startLine, , endLine, , statements, count] = m;
    let blocks = files.get(file);
    if (!blocks) {
      blocks = [];
      files.set(file, blocks);
    }
    blocks.push({
      startLine: Number(startLine),
      endLine: Number(endLine),
      statements: Number(statements),
      count: Number(count)
    });
  }
  return { __go: true, mode, files };
}

/**
 * The code visible on each line: comments and raw-string contents blanked out,
 * with multi-line `/*...*​/` and `...` regions tracked across lines.
 *
 * Without this, a commented-out function, a `}` at column 0 inside a block
 * comment, or a raw string with a column-0 brace would create phantom function
 * ranges or split real ones — and coverage blocks would be assigned to the
 * wrong function, which is a false coverage result.
 */
function goSignificantLines(text) {
  const out = [];
  let inBlock = false;
  let inRaw = false;
  for (const line of String(text).split(/\r?\n/)) {
    let sig = '';
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (inBlock) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlock = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (inRaw) {
        if (ch === '`') inRaw = false;
        i++;
        continue;
      }
      if (ch === '`') {
        inRaw = true;
        i++;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') break; // rest of the line is a comment
      if (ch === '/' && line[i + 1] === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      sig += ch;
      i++;
    }
    out.push(sig);
  }
  return out;
}

/**
 * Top-level function ranges of a gofmt'd Go source file.
 *
 * Only `func` at column 0 of *significant* code matches: nested (indented)
 * declarations are left alone, which is the point — a closure inside a
 * function is part of that function's range. A function ends at the next `}`
 * at column 0, or on its own declaration line when the whole function sits on
 * that line (`func f() {}`), so a later package-level block is not absorbed.
 * Methods are reported under their bare method name (two types may share it;
 * every match is reported, mirroring how c8 reports every fnMap entry with a
 * given name).
 */
export function goFunctionRanges(text) {
  const lines = goSignificantLines(text);
  const funcs = [];
  let current = null;
  const declRe = /^func\s*(?:\([^)]*\))?\s*([A-Za-z_]\w*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current && /^}/.test(line)) {
      funcs.push({ ...current, endLine: i + 1 });
      current = null;
      continue;
    }
    if (/^func\s/.test(line)) {
      // a new decl with no closing brace in between: close the previous range
      // at the previous line rather than swallowing the new declaration
      if (current) funcs.push({ ...current, endLine: i });
      const name = declRe.exec(line)?.[1];
      current = name ? { name, startLine: i + 1 } : null;
      // the whole function on one line (gofmt keeps empty ones there): close
      // it on its own line
      if (current && /\}\s*$/.test(line)) {
        funcs.push({ ...current, endLine: i + 1 });
        current = null;
      }
    }
  }
  if (current) funcs.push({ ...current, endLine: lines.length });
  return funcs;
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
  if (coverage && typeof coverage === 'object' && coverage.__go) return 'go';
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
 * @param {string} [options.source] module root for Go profiles (--source), whose
 *   source files are needed to map profile line ranges back to functions
 */
export async function collectCoverageFacts({ coverageFile, targets = [], source, lang = DEFAULT_LANG } = {}) {
  const t = T(lang);
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
        t(
          `无法读取覆盖率数据 ${coverageFile}: ${error.code ?? error.message}。` +
            '未运行测试或测试未产出覆盖率时，这属于「未评估」，不是「未被覆盖」',
          `cannot read coverage data ${coverageFile}: ${error.code ?? error.message}. ` +
            'When no tests ran or none produced coverage, this is "not evaluated", not "not covered"'
        )
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  const isPy = isCoveragePyReport(coverage);

  // Go profiles take a dedicated path: the report is a block list with no
  // function names, so symbol location needs the source tree and the
  // two-state mapping runs through function ranges, not per-file function maps.
  if (coverage.__go) {
    return collectGoCoverageFacts({ coverage, coverageFile, targets, source, lang });
  }

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
        t(
          '覆盖率数据为空对象。这通常意味着测试运行没有加载到被测代码（常见于缺少 --all 或 --source），' +
            '因此任何「未在数据中」的文件都必须按未覆盖处理，而这里连文件清单都没有',
          'Coverage data is an empty object. This usually means the test run never loaded the code under test ' +
            '(commonly a missing --all or --source), so any file "not in the data" must be treated as uncovered — ' +
            'and here there is not even a file list'
        )
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
        t(
          '覆盖率数据不是可识别的报告形状（既无 c8/istanbul 的 fnMap/f，也无 coverage.py 的 functions）——' +
            '它可能根本不是覆盖率文件，任何「符号未定位/未覆盖」的结论在此都不可信',
          'Coverage data is not a recognizable report shape (neither c8/istanbul\'s fnMap/f nor coverage.py\'s functions) — ' +
            'it may not be a coverage file at all, and any "symbol not located / not covered" conclusion is untrustworthy here'
        )
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  if (targets.length === 0) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        t('没有指定要查询的符号（--symbol）', 'no symbol requested for query (--symbol)')
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  for (const target of targets) {
    if (target.file && C8_DEFAULT_EXCLUDES.some(re => re.test(target.file.replace(/\\/g, '/')))) {
      notEvaluated.push(
        notEvaluatedEntry(
          KIND.TEST_COVERAGE,
          t(
            `${target.file} 命中默认排除规则（c8 排除 test/ 等目录），很可能根本不在覆盖率数据里。` +
              '需要显式 --all（c8）或 --source（coverage.py）或调整 exclude 才能测到它',
            `${target.file} matches a default exclusion rule (c8 excludes test/ etc.), so it is likely absent from the coverage data entirely. ` +
              'Explicit --all (c8) or --source (coverage.py), or adjusting exclude, is required to measure it'
          )
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
            t(
              `${target.file} 完全没有出现在覆盖率数据中 —— 测试运行期间该文件未被加载，` +
                `因此其中的符号 ${target.symbol} 未曾被执行`,
              `${target.file} does not appear in the coverage data at all — the file was never loaded during the test run, ` +
                `so the symbol ${target.symbol} inside it was never executed`
            ),
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
                t(
                  `符号 ${target.symbol} 在本次测试运行中一次都没有被调用（调用计数为 0）—— ` +
                    `任何依赖它的行为都没有被执行验证`,
                  `Symbol ${target.symbol} was never invoked in this test run (invocation count 0) — ` +
                    `any behavior depending on it was never exercised`
                ),
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
                  ? t(
                      `符号 ${target.symbol} 至少被调用过一次，但被调用**不能**证明任何特定调用点执行过 —— ` +
                        `本事实只能证伪，不能证实`,
                      `Symbol ${target.symbol} was invoked at least once, but being invoked **cannot** prove any specific call site ran — ` +
                        `this fact can only falsify, never confirm`
                    )
                  : t(
                      `符号 ${target.symbol} 被调用了 ${count} 次，但调用计数非零**不能**证明任何特定调用点执行过 —— ` +
                        `本事实只能证伪，不能证实`,
                      `Symbol ${target.symbol} was invoked ${count} time(s), but a non-zero invocation count **cannot** prove any specific call site ran — ` +
                        `this fact can only falsify, never confirm`
                    ),
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
            t(
              `未能在覆盖率数据中定位符号 ${target.symbol}`,
              `Could not locate symbol ${target.symbol} in the coverage data`
            ) +
            (target.file ? t(`（限定文件 ${target.file}）`, ` (restricted to file ${target.file})`) : '') +
            (isPy
              ? t(' —— 可能是被重命名、被内联，或它只在模块顶层出现', ' — it may have been renamed, inlined, or it only appears at module top level')
              : t(
                  ' —— 可能是被重命名、被内联，或它只在模块顶层出现（c8 把这类调用点放在 branchMap 而非 fnMap）',
                  ' — it may have been renamed, inlined, or it only appears at module top level (c8 places such call sites in branchMap, not fnMap)'
                )),
          status: STATUS.UNKNOWN,
          evidence: { file: target.file ?? t('(未限定文件)', '(unrestricted file)') },
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

/**
 * The Go-profile path.
 *
 * Profile lines carry no function names, so the two-state mapping goes:
 * block list -> function ranges from the gofmt'd source -> per-function hit.
 * The module root (--source) is required; profile paths are import paths
 * (`module/dir/file.go`) or absolute paths, so resolution tries go.mod's
 * module prefix and the plain path under the root before giving up — and a
 * file it cannot resolve is reported as notEvaluated, never as uncovered.
 */
async function collectGoCoverageFacts({ coverage, coverageFile, targets, source, lang }) {
  const t = T(lang);
  const facts = [];
  const evaluated = [];
  const notEvaluated = [];
  let counter = 0;

  if (coverage.files.size === 0) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        t(
          'Go coverage profile 为空（只有 mode 头）。测试没有加载到任何被编译的包，' +
            '或 -coverpkg 没有指向被测代码',
          'The Go coverage profile is empty (mode header only). The test run loaded no compiled package, ' +
            'or -coverpkg did not point at the code under test'
        )
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  if (targets.length === 0) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        t('没有指定要查询的符号（--symbol）', 'no symbol requested for query (--symbol)')
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  let module = null;
  if (source) {
    try {
      module = modulePrefix(await readFile(path.join(source, 'go.mod'), 'utf8'));
    } catch {
      // no go.mod at the root: relative import paths then cannot be resolved,
      // and the per-file resolution below reports that honestly
    }
  }

  const sourceCache = new Map();
  async function resolveSource(profilePath) {
    if (sourceCache.has(profilePath)) return sourceCache.get(profilePath);
    let result = null;
    if (source) {
      const candidates = [];
      if (path.isAbsolute(profilePath)) {
        candidates.push(profilePath);
      } else {
        if (module && profilePath.startsWith(module + '/')) {
          candidates.push(path.join(source, profilePath.slice(module.length + 1)));
        }
        candidates.push(path.join(source, profilePath));
      }
      for (const candidate of candidates) {
        try {
          result = { text: await readFile(candidate, 'utf8'), resolved: candidate };
          break;
        } catch {
          // try the next candidate, then report honestly
        }
      }
    }
    sourceCache.set(profilePath, result);
    return result;
  }

  if (!source) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.TEST_COVERAGE,
        t(
          'Go 的 -coverprofile 是文本格式且不含函数名，函数级裁定需要 --source <模块根目录> ' +
            '把行区间映射回函数。没有源码，符号查询无法进行',
          'A Go -coverprofile is text and carries no function names; a function-level verdict needs ' +
            '--source <module root> to map line ranges back to functions. Without the source, symbol queries cannot run'
        )
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  const entries = [...coverage.files.entries()];

  for (const target of targets) {
    const scoped = target.file
      ? entries.filter(([entryPath]) => matchesTarget(entryPath, target.file))
      : entries;

    if (target.file && scoped.length === 0) {
      // For Go this must NOT read as "never executed": a file absent from the
      // profile may simply not have been compiled into the test binary at all.
      notEvaluated.push(
        notEvaluatedEntry(
          KIND.TEST_COVERAGE,
          t(
            `${target.file} 没有出现在 Go coverage profile 中 —— 该文件所在的包可能根本没被编译进这次测试二进制` +
              '（--coverpkg 或运行对应包才能测到它），「未出现」不能当「未执行」',
            `${target.file} does not appear in the Go coverage profile — its package may not have been compiled into the test binary at all ` +
              '(-coverpkg or running that package is required to measure it), so "absent" must not be read as "never executed"'
          )
        )
      );
      continue;
    }

    let matched = 0;
    let unresolved = false;
    for (const [entryPath, blocks] of scoped) {
      const src = await resolveSource(entryPath);
      if (!src) {
        unresolved = true;
        notEvaluated.push(
          notEvaluatedEntry(
            KIND.TEST_COVERAGE,
            t(
              `profile 中的 ${entryPath} 无法在 --source ${source} 下定位（go.mod 模块前缀已尝试）—— ` +
                '没有该源文件，行区间无法映射回函数',
              `The profile entry ${entryPath} cannot be located under --source ${source} (the go.mod module prefix was tried) — ` +
                'without that source file, line ranges cannot be mapped back to functions'
            )
          )
        );
        continue;
      }

      for (const fn of goFunctionRanges(src.text)) {
        if (fn.name !== target.symbol) continue;
        const inFn = blocks.filter(b => b.startLine >= fn.startLine && b.startLine <= fn.endLine);
        if (inFn.length === 0) continue; // no measured block: cannot answer for this function
        matched++;
        const invoked = inFn.some(b => b.count > 0);

        if (!invoked) {
          facts.push(
            makeFact({
              id: `coverage-${++counter}`,
              kind: KIND.TEST_COVERAGE,
              statement:
                t(
                  `符号 ${target.symbol} 在本次测试运行中一次都没有被调用（函数体内所有覆盖区块的执行计数为 0）—— ` +
                    `任何依赖它的行为都没有被执行验证`,
                  `Symbol ${target.symbol} was never invoked in this test run (every coverage block inside the function has a hit count of 0) — ` +
                    `any behavior depending on it was never exercised`
                ),
              status: STATUS.ESTABLISHED,
              evidence: { file: entryPath, line: fn.startLine },
              method: 'command',
              command: reproduceCommand({ coverageFile, symbol: target.symbol, file: entryPath, source }),
              detail: { symbol: target.symbol, invocationCount: 0, reason: 'invocation_count_zero' }
            })
          );
        } else {
          facts.push(
            makeFact({
              id: `coverage-${++counter}`,
              kind: KIND.TEST_COVERAGE,
              statement:
                t(
                  `符号 ${target.symbol} 至少被调用过一次，但被调用**不能**证明任何特定调用点执行过 —— ` +
                    `本事实只能证伪，不能证实`,
                  `Symbol ${target.symbol} was invoked at least once, but being invoked **cannot** prove any specific call site ran — ` +
                    `this fact can only falsify, never confirm`
                ),
              status: STATUS.UNKNOWN,
              evidence: { file: entryPath, line: fn.startLine },
              method: 'command',
              command: reproduceCommand({ coverageFile, symbol: target.symbol, file: entryPath, source }),
              detail: {
                symbol: target.symbol,
                invocationCount: 1,
                reason: 'nonzero_count_cannot_prove_call_site_execution'
              }
            })
          );
        }
      }
    }

    // "could not locate" implies we searched the data; when the source file
    // needed to even read the data was missing, the notEvaluated entry above
    // is the honest record and no locating claim is made.
    if (matched === 0 && !unresolved) {
      // With --source we can tell "not located" apart from "lives in a file the
      // profile never saw": a symbol declared in a file absent from the profile
      // is a refusal (its package was probably not compiled in), not an answer.
      const elsewhere = await findGoSymbolOutsideProfile(coverage, source, module, target.symbol);
      if (elsewhere) {
        notEvaluated.push(
          notEvaluatedEntry(
            KIND.TEST_COVERAGE,
            t(
              `符号 ${target.symbol} 在 ${elsewhere} 中有顶层声明，但该文件没有出现在 Go coverage profile 里 —— ` +
                '它所在的包多半没被编译进这次测试二进制（-coverpkg 或运行对应包才能测到它）。' +
                '这是「未评估」，既不是「从未调用」也不是「无法定位」',
              `Symbol ${target.symbol} is declared in ${elsewhere}, but that file does not appear in the Go coverage profile — ` +
                'its package was probably not compiled into this test binary (-coverpkg or running that package is required to measure it). ' +
                'This is "not evaluated": neither "never invoked" nor "could not locate"'
            )
          )
        );
        continue;
      }
      facts.push(
        makeFact({
          id: `coverage-${++counter}`,
          kind: KIND.TEST_COVERAGE,
          statement:
            t(
              `未能在覆盖率数据中定位符号 ${target.symbol}`,
              `Could not locate symbol ${target.symbol} in the coverage data`
            ) +
            (target.file ? t(`（限定文件 ${target.file}）`, ` (restricted to file ${target.file})`) : '') +
            t(
              ' —— 可能是被重命名、被内联，或它不是顶层 func 声明（Go profile 只携带行区间，' +
                '函数边界来自源码中的顶层 func）',
              ' — it may have been renamed, inlined, or it is not a top-level func declaration (a Go profile carries line ranges only; ' +
                'function boundaries come from top-level funcs in the source)'
            ),
          status: STATUS.UNKNOWN,
          evidence: { file: target.file ?? t('(未限定文件)', '(unrestricted file)') },
          method: 'static',
          detail: { symbol: target.symbol, reason: 'symbol_not_located_in_fnmap' }
        })
      );
    }
  }

  // A query that produced no fact and only refusals was not answered —
  // "measured" must not let CI read it as clean.
  const measured = facts.length > 0;
  if (measured) {
    evaluated.push({
      kind: KIND.TEST_COVERAGE,
      producer: 'euthyna-coverage',
      format: 'go',
      count: facts.length
    });
  }

  return { facts, evaluated, notEvaluated, measured };
}

function modulePrefix(goModText) {
  return /^\s*module\s+(\S+)/m.exec(goModText)?.[1] ?? null;
}

const GO_WALK_SKIP = new Set(['vendor', 'testdata', 'node_modules', '.git']);

/**
 * Does the symbol exist in a .go file that the profile does not cover?
 *
 * Walks the module root (skipping vendor/testdata and hidden dirs), maps each
 * file to its import path, and reports the first file — relative to the
 * module root — whose top-level functions include the symbol while the file
 * itself is absent from the profile. The whole-tree scan only runs on the
 * rare "matched 0" path, so the common query pays nothing for it.
 */
async function findGoSymbolOutsideProfile(coverage, source, module, symbol) {
  if (!source) return null;

  // absolute disk paths the profile already accounts for
  const covered = new Set();
  for (const profilePath of coverage.files.keys()) {
    if (path.isAbsolute(profilePath)) {
      covered.add(path.resolve(profilePath).replace(/\\/g, '/').toLowerCase());
    }
  }

  async function* walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.endsWith('.go')) yield path.join(dir, entry.name);
      else if (entry.isDirectory() && !GO_WALK_SKIP.has(entry.name) && !entry.name.startsWith('.')) {
        yield* walk(path.join(dir, entry.name));
      }
    }
  }

  for await (const file of walk(source)) {
    const abs = path.resolve(file).replace(/\\/g, '/').toLowerCase();
    if (covered.has(abs)) continue;
    const rel = path.relative(source, file).replace(/\\/g, '/');
    const importPath = module ? `${module}/${rel}` : rel;
    if (coverage.files.has(importPath) || coverage.files.has(rel)) continue;
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (goFunctionRanges(text).some(fn => fn.name === symbol)) return rel;
  }
  return null;
}
