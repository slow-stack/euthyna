/**
 * History facts: what did this change delete, and where did the deleted code come from?
 *
 * The upstream methodology states the rule this mechanises: code deleted by a
 * commit whose message says it was a security fix is a regression risk, and code
 * that was removed and is now being added back is a reintroduction. Both are
 * answerable from git alone, deterministically, and both are things a language
 * model guesses at rather than measures.
 *
 * This module produces facts. It does not decide whether a regression happened.
 */
import { git, commitSummaries } from '../git.js';
import { makeFact, notEvaluated as notEvaluatedEntry, KIND, STATUS, shellQuote } from '../contract.js';

/**
 * Strong signal: the commit is about security.
 *
 * Tuned asymmetrically on purpose. The two ways this classifier can be wrong do
 * not cost the same: over-classifying yields a noisy report a reader dismisses,
 * while under-classifying hides exactly the deleted-code-origin case this tool
 * exists to surface. So it errs broad across vocabulary that is unambiguously
 * security, and stops there - it does not guess from general words such as
 * "validate" or "check", which appear in ordinary refactors.
 */
const SECURITY_PATTERN =
  /\bcve-\d{4}-\d+\b|\bsecurity\b|\bvuln(?:erabilit(?:y|ies))?\b|\bexploit\b|\bxss\b|\bcsrf\b|\bssrf\b|\binjection\b|\bsanitiz|\bpermission\b|\bauthoriz|\bauthenticat|\bauthn?\b|\boauth\b|\bcredential|\bprivileg|\baccess control\b|\bhardening\b|\bmalicious\b|\bmalware\b|\bunsafe\b|漏洞|安全/i;

/** Weak signal: an ordinary fix. Worth reporting, weaker than the above. */
const FIX_PATTERN = /^\s*(?:fix|bugfix|hotfix|patch)\b|\bfixes\b|\bfixed\b|\bfixing\b|\bpatches\b|\brevert/i;

/** Longest-first so a longer added line is preferred over a substring of it. */
const MIN_PICKAXE_LINE_LENGTH = 12;

/**
 * Parse `git diff --unified=0` hunk headers into deleted line ranges.
 * With --unified=0 every hunk is exactly the changed lines, so a hunk's old
 * range is precisely the set of lines this change removed.
 *
 * @returns {Array<{start: number, count: number}>}
 */
export function parseDeletedRanges(diffText) {
  const ranges = [];
  const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of diffText.split('\n')) {
    const match = hunk.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    // A missing count means 1; a count of 0 means pure insertion, so nothing was deleted.
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push({ start, count });
  }
  return ranges;
}

/**
 * Attribute every line in `ranges` to the commit that last touched it, as of `rev`.
 *
 * Returns a Map of full commit hash -> array of line numbers in `rev`. Line
 * numbers rather than a bare count, because the fact has to carry a command a
 * reader can actually paste: `git blame -L 104,104` reproduces the claim, while
 * `git blame -L <deleted-range>` is a placeholder, not evidence.
 */
export async function blameRanges({ cwd, rev, file, ranges }) {
  const byCommit = new Map();
  for (const range of ranges) {
    const end = range.start + range.count - 1;
    const out = await git(
      ['blame', '--porcelain', '-L', `${range.start},${end}`, rev, '--', file],
      { cwd, allowFailure: true }
    );
    if (!out) continue;

    let current = null;
    // Porcelain emits `<sha> <origLine> <finalLine> [<groupSize>]`. `origLine`
    // is the line number in the commit that introduced the line, which is NOT
    // where the line sits in the revision being blamed; `finalLine` is. Using
    // the wrong one produces a command that looks right and blames other lines.
    let lineNumber = null;
    for (const raw of out.split('\n')) {
      const header = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(raw);
      if (header) {
        current = header[1];
        lineNumber = Number(header[3]);
        continue;
      }
      if (raw.startsWith('\t') && current && lineNumber !== null) {
        const list = byCommit.get(current) ?? [];
        list.push(lineNumber);
        byCommit.set(current, list);
        lineNumber++;
      }
    }
  }
  return byCommit;
}

/**
 * Compress sorted line numbers into inclusive ranges, so a command can name
 * them as `git blame -L 104,104 -L 114,114` instead of enumerating every line.
 */
export function compressRanges(lineNumbers) {
  const sorted = [...new Set(lineNumbers)].sort((a, b) => a - b);
  const ranges = [];
  for (const line of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && line === last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }
  return ranges;
}

/** Classify a commit subject. Returns 'security', 'fix', or 'none'. */
export function classifySubject(subject, { securityPattern = SECURITY_PATTERN, fixPattern = FIX_PATTERN } = {}) {
  if (!subject) return 'none';
  if (securityPattern.test(subject)) return 'security';
  if (fixPattern.test(subject)) return 'fix';
  return 'none';
}

/**
 * Collect history facts for a revision range.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.base
 * @param {string} options.head
 * @param {boolean} [options.pickaxe]  also look for reintroduced lines
 * @param {number} [options.maxPickaxe] cap on pickaxe probes (reported when hit)
 */
export async function collectHistoryFacts({
  cwd,
  base,
  head = 'HEAD',
  pickaxe = false,
  maxPickaxe = 40,
  securityPattern = SECURITY_PATTERN,
  fixPattern = FIX_PATTERN
} = {}) {
  const facts = [];
  const evaluated = [];
  const notEvaluated = [];
  let counter = 0;

  // NUL-separated so filenames containing newlines survive.
  const fileList = await git(['diff', '--name-only', '-z', `${base}..${head}`], { cwd });
  const files = fileList.split('\0').filter(Boolean);

  if (files.length === 0) {
    notEvaluated.push(
      notEvaluatedEntry('history', `范围 ${base}..${head} 内没有文件变更，没有可归属的删除行`)
    );
    return { facts, evaluated, notEvaluated, files, measured: true };
  }

  // Deleted code whose origin commit was itself removed by the range is not
  // attributable to an earlier commit, so it is reported rather than dropped.
  const blameByCommit = new Map();
  const linesByFile = new Map();

  for (const file of files) {
    const diff = await git(['diff', '--unified=0', `${base}..${head}`, '--', file], { cwd });
    const ranges = parseDeletedRanges(diff);
    if (ranges.length === 0) continue;

    const deletedLines = ranges.reduce((sum, r) => sum + r.count, 0);
    linesByFile.set(file, { ranges, deletedLines });

    const byCommit = await blameRanges({ cwd, rev: base, file, ranges });
    for (const [hash, lineNumbers] of byCommit) {
      const entry = blameByCommit.get(hash) ?? { lines: 0, byFile: new Map() };
      const existing = entry.byFile.get(file) ?? [];
      entry.byFile.set(file, [...existing, ...lineNumbers]);
      entry.lines += lineNumbers.length;
      blameByCommit.set(hash, entry);
    }
  }

  evaluated.push({
    kind: KIND.HISTORY,
    producer: 'euthyna-history',
    count: [...linesByFile.values()].reduce((sum, v) => sum + v.deletedLines, 0)
  });

  if (linesByFile.size === 0) {
    // Files changed but nothing was deleted. Saying nothing here would render as
    // "no facts", which a reader could mistake for "measured and clean".
    notEvaluated.push(
      notEvaluatedEntry(
        'history',
        `范围 ${base}..${head} 内有 ${files.length} 个文件变更，但没有任何一行被删除，` +
          '因此没有可归属的历史来源'
      )
    );
  }

  const summaries = await commitSummaries(cwd, [...blameByCommit.keys()]);

  // Report the security-relevant origins first: they are what an adjudicator
  // must look at, and the ordering is stable so two runs produce the same report.
  const ranked = [...blameByCommit.entries()]
    .map(([hash, entry]) => {
      const summary = summaries.get(hash) ?? { subject: '(提交信息不可读)', author: null, date: null };
      return { hash, entry, summary, classification: classifySubject(summary.subject, { securityPattern, fixPattern }) };
    })
    .sort((a, b) => rank(a.classification) - rank(b.classification) || b.entry.lines - a.entry.lines);

  for (const { hash, entry, summary, classification } of ranked) {
    const byFile = [...entry.byFile.entries()]
      .map(([file, lineNumbers]) => ({
        file,
        lines: lineNumbers.length,
        ranges: compressRanges(lineNumbers)
      }))
      .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

    const fileCount = byFile.length;
    // Say how many files the lines are spread over. Reporting a total against a
    // single file path reads as "all of these are here", which sends a reader to
    // the wrong place and makes an accurate attribution look wrong.
    const statement =
      `本次变更删除了 ${entry.lines} 行来自提交 ${hash.slice(0, 10)} 的代码` +
      (fileCount > 1 ? `，分布在 ${fileCount} 个文件` : `（文件：${byFile[0].file}）`) +
      `。提交信息：${JSON.stringify(summary.subject)}，分类：${classification}`;

    // Multiple -L flags reproduce every attributed line in the primary file.
    const primary = byFile[0];
    const lineFlags = primary.ranges.map(r => `-L ${r.start},${r.end}`).join(' ');

    facts.push(
      makeFact({
        id: `history-${++counter}`,
        kind: KIND.HISTORY,
        statement,
        status: STATUS.ESTABLISHED,
        evidence: { file: primary.file, commit: hash, files: byFile.map(f => f.file) },
        method: 'command',
        command: `git blame --porcelain ${lineFlags} ${base} -- ${shellQuote(primary.file)}`,
        detail: {
          classification,
          commitSubject: summary.subject,
          commitAuthor: summary.author,
          commitDate: summary.date,
          blamedLines: entry.lines,
          byFile,
          // Stated explicitly so a reader is not left thinking the command above
          // covers lines in the other files too.
          reproductionNote:
            fileCount > 1
              ? `上面的命令只复现「${primary.file}」中的归属；其余 ${fileCount - 1} 个文件的行区间见 byFile`
              : '上面的命令复现本事实涉及的全部行'
        }
      })
    );
  }

  if (ranked.length === 0 && linesByFile.size > 0) {
    notEvaluated.push(
      notEvaluatedEntry('history', '有删除行但 blame 未能归属到任何提交（可能是二进制文件或路径异常）')
    );
  }

  if (pickaxe) {
    const reintro = await collectReintroductionFacts({
      cwd,
      base,
      head,
      files,
      maxPickaxe,
      securityPattern,
      fixPattern,
      startCounter: counter
    });
    facts.push(...reintro.facts);
    counter = reintro.counter;
    if (reintro.evaluated) evaluated.push(reintro.evaluated);
    notEvaluated.push(...reintro.notEvaluated);
  } else {
    notEvaluated.push(
      notEvaluatedEntry('reintroduction', '未启用 --pickaxe，未检查「被移除又加回」的代码行')
    );
  }

  return { facts, evaluated, notEvaluated, files, measured: true };
}

function rank(classification) {
  if (classification === 'security') return 0;
  if (classification === 'fix') return 1;
  return 2;
}

/**
 * Reintroduction: an added line that exists nowhere at `base`, yet `git log -S`
 * reports commits that changed its occurrence count before `base`.
 *
 * The inference is sound rather than heuristic: the line is absent at base and
 * present at head, so any earlier commit that changed its count must have
 * removed it. Adding it back is the reintroduction.
 */
async function collectReintroductionFacts({
  cwd,
  base,
  head,
  files,
  maxPickaxe,
  securityPattern,
  fixPattern,
  startCounter
}) {
  const facts = [];
  const notEvaluated = [];
  let counter = startCounter;
  let probed = 0;
  let candidates = 0;

  for (const file of files) {
    const diff = await git(['diff', '--unified=0', `${base}..${head}`, '--', file], { cwd });
    const added = diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1));

    // Longest first: a longer line is the more specific probe.
    const unique = [...new Set(added.map(l => l.trim()))]
      .filter(l => l.length >= MIN_PICKAXE_LINE_LENGTH)
      .sort((a, b) => b.length - a.length);
    candidates += unique.length;

    for (const line of unique) {
      if (probed >= maxPickaxe) break;
      probed++;

      const log = await git(
        ['log', '--format=%H', `-S${line}`, base, '--', file],
        { cwd, allowFailure: true }
      );
      const hashes = log.split('\n').map(s => s.trim()).filter(Boolean);
      if (hashes.length === 0) continue;

      // Present at head by construction; confirm it is genuinely absent at base.
      const atBase = await git(['grep', '-F', '-q', '-e', line, base, '--', file], {
        cwd,
        allowFailure: true
      });
      if (atBase.trim()) continue;

      const summaries = await commitSummaries(cwd, hashes.slice(0, 5));
      const classified = [...summaries.entries()].map(([hash, summary]) => ({
        hash,
        summary,
        classification: classifySubject(summary.subject, { securityPattern, fixPattern })
      }));
      const securityOrigin = classified.find(c => c.classification === 'security');

      facts.push(
        makeFact({
          id: `reintroduction-${++counter}`,
          kind: KIND.REINTRODUCTION,
          statement:
            `本次变更加回了一行在 ${base} 中不存在的代码，而该行的出现次数曾被 ${hashes.length} 个提交改变` +
            (securityOrigin
              ? `，其中提交 ${securityOrigin.hash.slice(0, 10)} 的提交信息含安全关键词`
              : ''),
          status: STATUS.ESTABLISHED,
          evidence: { file, snippet: line.slice(0, 160), commit: hashes[0] },
          method: 'command',
          command: `git log --format=%H -S${shellQuote(line.slice(0, 60))} ${base} -- ${shellQuote(file)}`,
          detail: {
            line: line.slice(0, 400),
            candidateCommits: classified.map(c => ({
              hash: c.hash,
              subject: c.summary.subject,
              classification: c.classification
            })),
            securityOrigin: securityOrigin ? securityOrigin.hash : null
          }
        })
      );
    }

    if (probed >= maxPickaxe) break;
  }

  if (probed >= maxPickaxe && candidates > probed) {
    notEvaluated.push(
      notEvaluatedEntry(
        'reintroduction',
        `pickaxe 探针上限 ${maxPickaxe} 已用尽，另有 ${candidates - probed} 行新增代码未检查`
      )
    );
  }

  return {
    facts,
    counter,
    evaluated: { kind: KIND.REINTRODUCTION, producer: 'euthyna-history', count: probed },
    notEvaluated
  };
}
