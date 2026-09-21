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
  // ponytail: 顺序 blame，每个区间一次 git 进程，耗时与删除区间数线性相关
  // （基准见 bench/perf.js）。若吞吐不满足要求：改成每文件一次 blame 覆盖
  // 全部区间，或对单行区间做有界并发。
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

/**
 * Parse `git diff --unified=0` into the deleted lines with their old line
 * numbers: [{ line, content }]. With --unified=0 every hunk is exactly the
 * changed lines, so the old line numbers walk from the hunk's old start across
 * the deleted lines.
 */
export function parseDeletedLines(diffText) {
  const out = [];
  let oldLine = null;
  for (const raw of diffText.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) {
      if (oldLine !== null) out.push({ line: oldLine++, content: raw.slice(1) });
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) continue;
    if (raw.startsWith(' ')) {
      if (oldLine !== null) oldLine++;
      continue;
    }
  }
  return out;
}

/** True when any of the given line contents is itself security vocabulary. */
export function securityRelevantLines(lines, { securityPattern = SECURITY_PATTERN } = {}) {
  return lines.some(line => securityPattern.test(line));
}

/**
 * Classify a commit the way an adjudicator would read it: the message first,
 * and when the message is neutral, whether the commit's own diff touched lines
 * that are themselves security vocabulary — removing or changing a sanitizer,
 * an authorization check, a credential guard. The message stays the primary
 * signal; the diff is the fallback for "update utils" commits whose subject
 * says nothing but whose changed lines are unambiguously security.
 */
export async function classifyCommit(
  cwd,
  hash,
  subject,
  { securityPattern = SECURITY_PATTERN, fixPattern = FIX_PATTERN } = {}
) {
  const byMessage = classifySubject(subject, { securityPattern, fixPattern });
  if (byMessage !== 'none') return byMessage;
  const out = await git(['show', '--format=', '--unified=0', hash], { cwd, allowFailure: true });
  if (!out) return 'none';
  const changed = out.split('\n').filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return changed.some(line => securityPattern.test(line.slice(1))) ? 'security' : 'none';
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
 * Attribution semantics, stated explicitly because they are the point of this
 * function and easy to over-claim:
 *
 *   - blame (the default) answers "who last touched the line" — a security-fix
 *     line that a later formatting/refactor commit moved is attributed to the
 *     formatter, not the fix. `--origins` answers "who FIRST introduced the
 *     line's content" by probing `git log -S` and re-attributes the line when
 *     the introducing commit differs and classifies security or fix.
 *   - classification looks at the commit message first, then at whether the
 *     commit's own diff touched security-vocabulary lines, then at whether the
 *     deleted line content itself is security vocabulary. All three err broad
 *     on purpose: under-classifying hides exactly the deleted-code-origin case
 *     this tool exists to surface.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.base
 * @param {string} options.head
 * @param {boolean} [options.pickaxe]  also look for reintroduced lines
 * @param {number} [options.maxPickaxe] cap on pickaxe probes (reported when hit)
 * @param {boolean} [options.origins]  re-attribute deleted lines to the commit
 *                                     that first introduced their content
 * @param {number} [options.maxOrigins] cap on origin probes (reported when hit)
 */
export async function collectHistoryFacts({
  cwd,
  base,
  head = 'HEAD',
  pickaxe = false,
  maxPickaxe = 40,
  origins = false,
  maxOrigins = 40,
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
  const deletedLinesByFile = new Map();

  for (const file of files) {
    const diff = await git(['diff', '--unified=0', `${base}..${head}`, '--', file], { cwd });
    const ranges = parseDeletedRanges(diff);
    if (ranges.length === 0) continue;

    const deletedLines = ranges.reduce((sum, r) => sum + r.count, 0);
    linesByFile.set(file, { ranges, deletedLines });
    deletedLinesByFile.set(file, parseDeletedLines(diff));

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
  // classifyCommit is cached: the same commit can be a blame owner and an
  // origin, and each costs a `git show`.
  const classifyCache = new Map();
  const classify = async (hash, subject) => {
    if (classifyCache.has(hash)) return classifyCache.get(hash);
    const result = await classifyCommit(cwd, hash, subject, { securityPattern, fixPattern });
    classifyCache.set(hash, result);
    return result;
  };

  // Origin refinement (--origins): a deleted line whose blame owner is not
  // message-classified as security is probed with `git log -S` to find the
  // commit that FIRST introduced its content. If that commit classifies
  // security or fix and differs from the blame owner, the line is
  // re-attributed to it — the format commit that moved a security line stops
  // masquerading as its origin.
  const originGroups = new Map(); // blameHash -> Map<originHash, group>
  if (origins) {
    let probed = 0;
    let capped = false;
    let shortSkipped = 0;
    for (const [hash, entry] of blameByCommit) {
      if (capped) break;
      const summary = summaries.get(hash);
      if (classifySubject(summary?.subject, { securityPattern, fixPattern }) === 'security') continue;
      for (const [file, lineNumbers] of entry.byFile) {
        if (capped) break;
        const deleted = deletedLinesByFile.get(file) ?? [];
        const contentByLine = new Map(deleted.map(d => [d.line, d.content]));
        const contents = [
          ...new Set(
            lineNumbers
              .map(n => contentByLine.get(n))
              .filter(c => typeof c === 'string' && c.length > 0)
          )
        ];
        for (const content of contents) {
          // Generic short lines (a closing brace, `return x;`) occur in almost
          // every commit, so their "-S" answer is the first commit of the whole
          // history, not an origin. Only contents long enough to be specific
          // are probed; the rest keep the blame attribution.
          if (content.length < MIN_PICKAXE_LINE_LENGTH) {
            shortSkipped++;
            continue;
          }
          if (probed >= maxOrigins) {
            capped = true;
            break;
          }
          probed++;
          const log = await git(['log', '--format=%H', `-S${content}`, base, '--', file], {
            cwd,
            allowFailure: true
          });
          const hashes = log.split('\n').map(s => s.trim()).filter(Boolean);
          if (hashes.length === 0) continue;
          // git log lists newest first; the last entry is the oldest, i.e. the
          // commit where the content's occurrence count first rose — the one
          // that introduced it.
          const origin = hashes[hashes.length - 1];
          if (origin === hash) continue;
          const originSummary = (await commitSummaries(cwd, [origin])).get(origin);
          const originClassification = await classify(origin, originSummary?.subject ?? null);
          if (originClassification === 'none') continue;

          const lines = lineNumbers.filter(n => contentByLine.get(n) === content);
          let byOrigin = originGroups.get(hash)?.get(origin);
          if (!byOrigin) {
            byOrigin = {
              classification: originClassification,
              summary: originSummary ?? null,
              byFile: new Map(),
              contents: new Map()
            };
            if (!originGroups.has(hash)) originGroups.set(hash, new Map());
            originGroups.get(hash).set(origin, byOrigin);
          }
          const existing = byOrigin.byFile.get(file) ?? [];
          byOrigin.byFile.set(file, [...existing, ...lines]);
          byOrigin.contents.set(file, content);
        }
      }
    }
    if (capped) {
      notEvaluated.push(
        notEvaluatedEntry(
          'history-origins',
          `git log -S 来源探针上限 ${maxOrigins} 已用尽，其余删除行保留 blame 归属`
        )
      );
    }
    if (shortSkipped > 0) {
      notEvaluated.push(
        notEvaluatedEntry(
          'history-origins',
          `${shortSkipped} 行内容过短（< ${MIN_PICKAXE_LINE_LENGTH} 字符），` +
            '未做来源追溯（太通用时 -S 会指向整个历史的第一个提交而非真实来源），保留 blame 归属'
        )
      );
    }
  } else if (linesByFile.size > 0) {
    notEvaluated.push(
      notEvaluatedEntry(
        'history-origins',
        '未启用 --origins，删除行的归属基于 git blame 的「最后修改」语义；' +
          '被删行本身或提交 diff 含安全关键词时仍会标为 security'
      )
    );
  }

  // Split every blame group into its remainder (blame attribution) and its
  // refined subsets (one fact per origin commit). Each becomes a fact.
  const pending = [];
  for (const [hash, entry] of blameByCommit) {
    const summary = summaries.get(hash) ?? { subject: '(提交信息不可读)', author: null, date: null };
    const groups = originGroups.get(hash);
    if (!groups) {
      pending.push({ hash, entry, summary, originMethod: 'blame' });
      continue;
    }
    const refined = new Set([...groups.values()].flatMap(g => [...g.byFile.values()]).flat());
    const remainderByFile = new Map();
    for (const [file, lineNumbers] of entry.byFile) {
      const rest = lineNumbers.filter(n => !refined.has(n));
      if (rest.length) remainderByFile.set(file, rest);
    }
    if (remainderByFile.size) {
      pending.push({
        hash,
        entry: {
          lines: [...remainderByFile.values()].reduce((sum, a) => sum + a.length, 0),
          byFile: remainderByFile
        },
        summary,
        originMethod: 'blame'
      });
    }
    for (const [originHash, group] of groups) {
      pending.push({
        hash: originHash,
        entry: {
          lines: [...group.byFile.values()].reduce((sum, a) => sum + a.length, 0),
          byFile: group.byFile
        },
        summary: group.summary ?? { subject: '(提交信息不可读)', author: null, date: null },
        originMethod: 'pickaxe',
        blameCommit: hash,
        contents: group.contents
      });
    }
  }

  // Classify each pending fact. Order of signals, from most to least direct:
  // the origin commit's message, then the deleted line content itself (the
  // deleted code is security code even when the commit that owns it says
  // nothing), then the origin commit's own diff (changed security-vocabulary
  // lines in an otherwise neutral commit). The basis is recorded so
  // "分类：security" is never read as stronger than the evidence behind it.
  const ranked = [];
  for (const item of pending) {
    const byMessage = classifySubject(item.summary.subject, { securityPattern, fixPattern });
    let basis = byMessage !== 'none' ? 'message' : 'none';
    let classification = byMessage;
    if (classification === 'none') {
      const contents = [...item.entry.byFile.entries()].flatMap(([file, lineNumbers]) => {
        const deleted = deletedLinesByFile.get(file) ?? [];
        const byLine = new Map(deleted.map(d => [d.line, d.content]));
        return lineNumbers.map(n => byLine.get(n)).filter(c => typeof c === 'string');
      });
      if (securityRelevantLines(contents, { securityPattern })) {
        classification = 'security';
        basis = 'deleted-line';
      }
    }
    if (classification === 'none') {
      classification = await classify(item.hash, item.summary.subject);
      if (classification === 'security') basis = 'diff';
    }
    ranked.push({ ...item, classification, basis });
  }

  // Report the security-relevant origins first: they are what an adjudicator
  // must look at, and the ordering is stable so two runs produce the same report.
  ranked.sort((a, b) => rank(a.classification) - rank(b.classification) || b.entry.lines - a.entry.lines);

  for (const { hash, entry, summary, classification, basis, originMethod, blameCommit, contents } of ranked) {
    const byFile = [...entry.byFile.entries()]
      .map(([file, lineNumbers]) => ({
        file,
        lines: lineNumbers.length,
        ranges: compressRanges(lineNumbers)
      }))
      .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

    const fileCount = byFile.length;
    const primary = byFile[0];
    // Say how many files the lines are spread over. Reporting a total against a
    // single file path reads as "all of these are here", which sends a reader to
    // the wrong place and makes an accurate attribution look wrong.
    const originPhrase =
      originMethod === 'pickaxe'
        ? `本次变更删除了 ${entry.lines} 行代码，其内容最初由提交 ${hash.slice(0, 10)} 引入` +
          `（git blame 的最后修改者是 ${blameCommit.slice(0, 10)}）`
        : `本次变更删除了 ${entry.lines} 行来自提交 ${hash.slice(0, 10)} 的代码`;
    const statement =
      originPhrase +
      (fileCount > 1 ? `，分布在 ${fileCount} 个文件` : `（文件：${byFile[0].file}）`) +
      `。提交信息：${JSON.stringify(summary.subject)}，分类：${classification}`;

    const detail = {
      classification,
      classificationBasis: basis,
      originMethod,
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
    };

    if (originMethod === 'pickaxe') {
      detail.blameCommit = blameCommit;
      detail.originCommit = hash;
      detail.contents = Object.fromEntries(
        [...contents.entries()].map(([file, content]) => [file, content.slice(0, 400)])
      );
    }

    // Multiple -L flags reproduce every attributed line in the primary file.
    const lineFlags = primary.ranges.map(r => `-L ${r.start},${r.end}`).join(' ');
    const command =
      originMethod === 'pickaxe'
        ? // The reproducible claim is "this commit introduced that content".
          `git log --format=%H -S${shellQuote(contents.get(primary.file).slice(0, 200))} ${base} -- ${shellQuote(primary.file)}`
        : `git blame --porcelain ${lineFlags} ${base} -- ${shellQuote(primary.file)}`;

    facts.push(
      makeFact({
        id: `history-${++counter}`,
        kind: KIND.HISTORY,
        statement,
        status: STATUS.ESTABLISHED,
        evidence: { file: primary.file, commit: hash, files: byFile.map(f => f.file) },
        method: 'command',
        command,
        detail
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
