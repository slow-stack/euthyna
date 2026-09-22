/**
 * The six-gate contract, enforced on adjudication reports.
 *
 * The skill's gates live in Markdown, which is discipline a model must choose
 * to follow. This module is the part that does not depend on the choice: it
 * reads an adjudication report and checks, mechanically, that every finding
 * carries the evidence its verdict claims to have, and that the verdict is
 * consistent with the gates it reports.
 *
 *   TRUE POSITIVE   requires evidence `path:L123`, a reproduce command, an
 *                   impact statement, and every one of the six gates passing.
 *   FALSE POSITIVE  requires at least one gate to FAIL with a reason.
 *   INCONCLUSIVE    requires at least one gate to be not evaluated, and none
 *                   to FAIL.
 *
 * A finding that fails its required shape is downgraded to an observation -
 * the same rule the skill states in prose, now enforced by a process exit
 * code instead of an agent's memory.
 *
 * `--verify` goes one step further: it re-runs each reproduce command (argv
 * split, no shell; only an allowlist of tools) so a claim that "this command
 * reproduces it" is actually checked rather than repeated.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeTextLines } from './contract.js';
import { T, DEFAULT_LANG } from './lang.js';

const execFileAsync = promisify(execFile);

export const VERDICTS = ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE'];

/** The six gates, by the numbers the report format uses. */
export const GATE_NAMES = Object.freeze({
  1: '流程',
  2: '可达性',
  3: '真实影响',
  4: 'PoC 验证',
  5: '数学边界',
  6: '环境'
});

/** The gate statuses as written in a report, in either language. */
const GATE_STATUSES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PASS_ZH: '通过',
  NOT_EVALUATED_ZH: '未评估',
  NOT_EVALUATED_EN: 'NOT EVALUATED'
});

/** True when a parsed status means "the gate passed". */
export function isPassStatus(status) {
  return status === GATE_STATUSES.PASS || status === GATE_STATUSES.PASS_ZH;
}

/** True when a parsed status means "the gate failed". */
export function isFailStatus(status) {
  return status === GATE_STATUSES.FAIL;
}

/** True when a parsed status means "the gate could not be evaluated". */
export function isNotEvaluatedStatus(status) {
  return status === GATE_STATUSES.NOT_EVALUATED_ZH || /^not evaluated$/i.test(status);
}

/**
 * A finding header: `BUG #N <VERDICT> — <claim>`. The em dash is the skill's
 * form, a hyphen is tolerated, and the claim may be empty (that is itself a
 * violation, but it is still parsed so the report says so).
 */
const HEADER = /^BUG\s+#?(\d+)\s+(TRUE POSITIVE|FALSE POSITIVE|INCONCLUSIVE)\s*(?:[—\-]\s*)?(.*)$/;

/** A line that starts like a finding but does not parse - reported, not dropped. */
const BUGLIKE = /^BUG\b/i;

/**
 * Field markers, accepted in either language. The parser is bilingual on
 * purpose and independent of the output language: a report is data, and a
 * Chinese-written report must validate under an English session and vice
 * versa. The English keywords are case-insensitive; the Chinese ones are
 * unaffected by the flag.
 */
const FIELDS = {
  evidence: /^(?:证据|Evidence)\s*[:：]\s*(.+)$/i,
  reproduce: /^(?:复现|Reproduce)\s*[:：]\s*(.+)$/i,
  impact: /^(?:影响|Impact)\s*[:：]\s*(.+)$/i,
  exploitability: /^(?:可利用性|Exploitability)\s*[:：]\s*(.+)$/i,
  gate: /^(?:门禁|Gate)\s*(\d+)\s*(?:[（(]([^）)]*)[）)])?\s*(PASS|通过|FAIL|未评估|NOT EVALUATED|Not evaluated)\s*[:：]?\s*(.*)$/i
};

/** `门禁全部通过。` / `All gates passed.` may share its line with the evidence that follows it. */
const ALL_PASS = /^(?:门禁全部通过|All gates passed)[。.]?\s*/i;

/**
 * Extract {file, line, commit} from an evidence string. Both `src/a.js:123`
 * and the skill's documented `src/a.js:L123` form are accepted — the skill
 * states the evidence form as `path:L123`, so a validator that only accepted
 * the bare numeric form would downgrade every report written to spec.
 */
export function parseEvidence(text) {
  const value = String(text).trim();
  const withLine = /^(.*?):L?(\d+)\s*(?:\(([^)]*)\))?$/.exec(value);
  if (withLine) {
    return { file: withLine[1], line: Number(withLine[2]), commit: withLine[3] ?? null, raw: value };
  }
  return { file: value, line: null, commit: null, raw: value };
}

/**
 * Parse an adjudication report (the skill's 裁定格式) into findings.
 * Lines before the first BUG header, and free-form body lines that match no
 * field, are ignored: the discipline lives in the fields, not the prose.
 *
 * @returns {{ findings: object[], unparseable: string[] }}
 */
export function parseGateReport(text) {
  const findings = [];
  const unparseable = [];
  let current = null;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (BUGLIKE.test(trimmed)) {
      const header = HEADER.exec(trimmed);
      if (!header) {
        unparseable.push(trimmed.slice(0, 160));
        continue;
      }
      current = {
        number: Number(header[1]),
        verdict: header[2],
        claim: header[3] ?? '',
        evidence: null,
        reproduce: null,
        impact: null,
        exploitability: null,
        allPass: false,
        gates: [],
        lines: []
      };
      findings.push(current);
      continue;
    }

    if (!current) continue;

    // One body line can carry several markers (`门禁全部通过。证据：…`), so the
    // fields are consumed as prefixes in a loop. A gate line is terminal: the
    // rest of it is that gate's reason, not another field.
    let rest = trimmed;
    while (rest) {
      const gate = FIELDS.gate.exec(rest);
      if (gate) {
        current.gates.push({
          number: Number(gate[1]),
          name: gate[2] ?? '',
          status: gate[3],
          reason: gate[4] ?? ''
        });
        break;
      }
      const allPass = ALL_PASS.exec(rest);
      if (allPass && !current.allPass) {
        current.allPass = true;
        rest = rest.slice(allPass[0].length);
        continue;
      }
      if (current.evidence === null) {
        const evidence = FIELDS.evidence.exec(rest);
        if (evidence) {
          current.evidence = parseEvidence(evidence[1]);
          break;
        }
      }
      if (current.reproduce === null) {
        const reproduce = FIELDS.reproduce.exec(rest);
        if (reproduce) {
          current.reproduce = reproduce[1].trim();
          break;
        }
      }
      if (current.impact === null) {
        const impact = FIELDS.impact.exec(rest);
        if (impact) {
          current.impact = impact[1].trim();
          break;
        }
      }
      if (current.exploitability === null) {
        const exploitability = FIELDS.exploitability.exec(rest);
        if (exploitability) {
          current.exploitability = exploitability[1].trim();
          break;
        }
      }
      current.lines.push(trimmed);
      break;
    }
  }

  return { findings, unparseable };
}

/**
 * Validate findings against the gate contract. Returns one result per finding:
 * `violations` names every way it fails, `downgraded` is true when any fail.
 * Unparseable BUG-like lines are returned separately as downgrade candidates.
 */
export function validateFindings(findings, { lang = DEFAULT_LANG } = {}) {
  const t = T(lang);
  return findings.map((finding) => {
    const violations = [];
    const fails = finding.gates.filter((g) => isFailStatus(g.status));
    const notEval = finding.gates.filter((g) => isNotEvaluatedStatus(g.status));
    const passes = finding.gates.filter((g) => isPassStatus(g.status));

    for (const gate of finding.gates) {
      if (!(gate.number in GATE_NAMES)) {
        violations.push(
          t(`门禁编号 ${gate.number} 不在 1..6 内`, `gate number ${gate.number} is not in 1..6`)
        );
      }
      if ((isFailStatus(gate.status) || isNotEvaluatedStatus(gate.status)) && !gate.reason.trim()) {
        violations.push(
          t(`门禁 ${gate.number} ${gate.status} 缺少理由`, `gate ${gate.number} ${gate.status} lacks a reason`)
        );
      }
    }

    if (!finding.claim.trim()) {
      violations.push(
        t('缺少结论描述（BUG 标题后的说明）', 'missing claim description (the note after the BUG header)')
      );
    }

    if (finding.verdict === 'TRUE POSITIVE') {
      if (!finding.evidence) {
        violations.push(
          t(
            '缺少证据（TRUE POSITIVE 必须带 证据：path:L123）',
            'missing evidence (a TRUE POSITIVE must carry Evidence: path:L123)'
          )
        );
      } else if (finding.evidence.line === null) {
        violations.push(
          t(
            '证据缺少行号（需要 path:L123 形式，禁止只写文件名）',
            'evidence lacks a line number (path:L123 form required; a bare file name is not allowed)'
          )
        );
      }
      if (!finding.reproduce) {
        violations.push(
          t(
            '缺少复现命令（TRUE POSITIVE 必须带 复现：<命令> 或 PoC）',
            'missing reproduce command (a TRUE POSITIVE must carry Reproduce: <command> or a PoC)'
          )
        );
      }
      if (!finding.impact) {
        violations.push(
          t('缺少影响说明（门禁 3 的证据）', 'missing impact statement (the evidence for gate 3)')
        );
      }
      const allPassed = finding.allPass || passes.length === 6;
      if (!allPassed) {
        violations.push(
          t(
            '门禁未全部通过（需要 门禁全部通过。 或六条 PASS）',
            'not all gates pass (requires "All gates passed." or six PASS lines)'
          )
        );
      }
      if (fails.length) {
        violations.push(
          t(
            `TRUE POSITIVE 含 FAIL 门禁（${fails.map((g) => g.number).join(', ')}）——应裁定为 FALSE POSITIVE`,
            `TRUE POSITIVE contains FAIL gates (${fails.map((g) => g.number).join(', ')}) — should be ruled FALSE POSITIVE`
          )
        );
      }
      if (notEval.length) {
        violations.push(
          t(
            `TRUE POSITIVE 含未评估门禁（${notEval.map((g) => g.number).join(', ')}）——应裁定为 INCONCLUSIVE`,
            `TRUE POSITIVE contains not-evaluated gates (${notEval.map((g) => g.number).join(', ')}) — should be ruled INCONCLUSIVE`
          )
        );
      }
    } else if (finding.verdict === 'FALSE POSITIVE') {
      if (fails.length === 0) {
        violations.push(
          t(
            'FALSE POSITIVE 必须至少有一条 门禁 N FAIL：<具体证据>',
            'a FALSE POSITIVE must have at least one Gate N FAIL: <specific evidence>'
          )
        );
      }
    } else {
      if (notEval.length === 0) {
        violations.push(
          t(
            'INCONCLUSIVE 必须至少有一条 门禁 N 未评估：<为什么>',
            'an INCONCLUSIVE must have at least one Gate N NOT EVALUATED: <why>'
          )
        );
      }
      if (fails.length) {
        violations.push(
          t(
            'INCONCLUSIVE 含 FAIL 门禁——应裁定为 FALSE POSITIVE',
            'INCONCLUSIVE contains FAIL gates — should be ruled FALSE POSITIVE'
          )
        );
      }
    }

    return { finding, violations, downgraded: violations.length > 0 };
  });
}

/**
 * Minimal POSIX-ish word splitter, used so a reproduce command is executed as
 * argv with no shell between the report and the process. Handles single and
 * double quotes and backslash escapes; throws on an unterminated quote.
 */
export function splitCommand(line) {
  const argv = [];
  let current = '';
  let mode = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (mode === 'single') {
      if (ch === "'") mode = null;
      else current += ch;
      i++;
      continue;
    }
    if (mode === 'double') {
      if (ch === '"') mode = null;
      else if (ch === '\\' && ['"', '\\', '$', '`'].includes(line[i + 1])) {
        current += line[i + 1];
        i += 2;
        continue;
      } else current += ch;
      i++;
      continue;
    }
    if (ch === "'") { mode = 'single'; i++; continue; }
    if (ch === '"') { mode = 'double'; i++; continue; }
    if (ch === '\\') { current += line[i + 1] ?? ''; i += 2; continue; }
    if (ch === ' ' || ch === '\t') { if (current) { argv.push(current); current = ''; } i++; continue; }
    current += ch;
    i++;
  }
  if (mode) throw new Error('未闭合的引号');
  if (current) argv.push(current);
  return argv;
}

/**
 * Tools a reproduce command may invoke under --verify, split by what they can
 * do. A report is written by the agent under audit, so its reproduce commands
 * are untrusted input that `--verify` would execute with the user's
 * privileges; the allowlist is a blast-radius limit, not a sandbox.
 *
 * `git` is a reproduce tool: it reads repository history, which is what the
 * facts are about. Interpreters (node, npm, python) can run arbitrary code by
 * construction — `node -e`, `python -c`, an npm script — so they are NOT
 * reachable by default: running one requires `--allow-exec`, which is the
 * caller saying "I trust this report". Narrowing the list further would not
 * close the hole (git itself can reach a pager or `-c core.…`); the honest
 * boundary is the explicit consent, not the list.
 */
export const SAFE_VERIFY_TOOLS = new Set(['git']);
export const INTERPRETER_VERIFY_TOOLS = new Set(['node', 'npm', 'python', 'python3']);
export const ALLOWED_VERIFY = new Set([...SAFE_VERIFY_TOOLS, ...INTERPRETER_VERIFY_TOOLS]);

/**
 * Re-run one finding's reproduce command.
 *
 * @param {{allowInterpreters?: boolean}} [options] set from --allow-exec
 * @returns {{status: 'verified'|'failed'|'refused'|'needs-consent'|'no-command'|'unparseable', tool?, exitCode?, detail?}}
 */
export async function verifyFinding(
  finding,
  { cwd = process.cwd(), timeoutMs = 30000, allowInterpreters = false } = {}
) {
  if (!finding.reproduce) return { status: 'no-command' };
  let argv;
  try {
    argv = splitCommand(finding.reproduce);
  } catch (error) {
    return { status: 'unparseable', detail: error.message };
  }
  if (argv.length === 0) return { status: 'no-command' };
  if (INTERPRETER_VERIFY_TOOLS.has(argv[0]) && !allowInterpreters) {
    // Deliberately not executed: an interpreter command from an untrusted
    // report is arbitrary code, and running it is the caller's decision.
    return { status: 'needs-consent', tool: argv[0] };
  }
  if (!ALLOWED_VERIFY.has(argv[0])) return { status: 'refused', tool: argv[0] };
  try {
    await execFileAsync(argv[0], argv.slice(1), { cwd, timeout: timeoutMs, env: process.env });
    return { status: 'verified', tool: argv[0] };
  } catch (error) {
    const stderr = (error.stderr || '').toString().split('\n')[0];
    return {
      status: 'failed',
      tool: argv[0],
      exitCode: typeof error.code === 'number' ? error.code : null,
      detail: stderr || error.message || ''
    };
  }
}

/**
 * Render the gate result for a terminal reader. Report-derived text passes the
 * render boundary here exactly once, like the fact report channel.
 */
export function renderGateReport(result, { write: rawWrite = console.log, lang = DEFAULT_LANG } = {}) {
  const t = T(lang);
  const write = (line) => rawWrite(safeTextLines(line));
  const { file, findings, unparseable, downgraded, verify } = result;

  write('');
  write(
    t(
      'euthyna gate — 6 门禁契约校验（不测量，只核对报告的自我声明）',
      'euthyna gate — six-gate contract check (no measurement; only the report\'s own claims are checked)'
    )
  );
  write(`${t('报告: ', 'Report: ')}${file}`);
  if (verify) {
    write(
      t(
        '⚠ --verify 以当前用户权限执行报告中的复现命令（按 argv 执行，不经过 shell）。',
        '⚠ --verify runs the report\'s reproduce commands with your privileges (as argv, no shell).'
      )
    );
    write(
      t(
        '  默认只执行 git 命令；解释器命令（node/npm/python）需要显式 --allow-exec。',
        '  Only git commands run by default; interpreter commands (node/npm/python) need explicit --allow-exec.'
      )
    );
    write(
      t(
        '  它不是一个安全沙箱：只对你自己信任的报告使用。',
        '  It is not a sandbox: use it only on reports you trust.'
      )
    );
  }
  write('');

  for (const entry of findings) {
    const f = entry.finding;
    const head = `  BUG #${f.number} ${f.verdict} — ${f.claim || t('(无结论描述)', '(no claim)')}`;
    if (entry.downgraded) {
      write(`${head} — ✗ ${t('降级为「观察」', 'downgraded to "observation"')}`);
    } else {
      write(`${head} — ✓ ${t('通过', 'passed')}`);
    }
    if (entry.verification && f.verdict === 'TRUE POSITIVE') {
      const v = entry.verification;
      const mark = v.status === 'verified' ? '✓' : v.status === 'failed' ? '✗' : '·';
      const how =
        v.status === 'verified'
          ? `(${v.tool})`
          : v.status === 'failed'
            ? `(exit ${v.exitCode ?? '?'}${v.detail ? `: ${v.detail}` : ''})`
            : v.status === 'refused'
              ? t(`(拒绝运行 ${v.tool} —— 不在白名单)`, `(refused to run ${v.tool} — not on the allowlist)`)
              : v.status === 'needs-consent'
                ? t(`(未执行 ${v.tool} 解释器命令 —— 需要 --allow-exec)`, `(interpreter command ${v.tool} not run — needs --allow-exec)`)
                : v.status === 'unparseable'
                  ? t('(命令无法拆分为 argv)', '(command could not be split into argv)')
                  : t('(无复现命令)', '(no reproduce command)');
      write(`${t('     复现核验 ', '     Reproduce check ')}${mark} ${how}`);
    }
    for (const violation of entry.violations) {
      write(`${t('     缺: ', '     missing: ')}${violation}`);
    }
  }

  if (unparseable.length) {
    write('');
    write(t('⚠ 无法解析的 BUG 行（计入降级）：', '⚠ Unparseable BUG lines (counted as downgrades):'));
    for (const line of unparseable) write(`  • ${line}`);
  }

  write('');
  if (downgraded === 0) {
    write(t('全部 finding 通过门禁契约。', 'All findings pass the gate contract.'));
  } else {
    write(
      t(
        `⚠ ${downgraded} 个 finding 被降级为「观察」——缺证据、缺复现或门禁不一致，不得当作已确证的结论。`,
        `⚠ ${downgraded} finding${downgraded === 1 ? '' : 's'} downgraded to "observation" — missing evidence, missing reproduction, or inconsistent gates; must not be read as established findings.`
      )
    );
  }
  write('');
}
