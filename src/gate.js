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

/**
 * A finding header: `BUG #N <VERDICT> — <claim>`. The em dash is the skill's
 * form, a hyphen is tolerated, and the claim may be empty (that is itself a
 * violation, but it is still parsed so the report says so).
 */
const HEADER = /^BUG\s+#?(\d+)\s+(TRUE POSITIVE|FALSE POSITIVE|INCONCLUSIVE)\s*(?:[—\-]\s*)?(.*)$/;

/** A line that starts like a finding but does not parse - reported, not dropped. */
const BUGLIKE = /^BUG\b/i;

const FIELDS = {
  evidence: /^证据\s*[:：]\s*(.+)$/,
  reproduce: /^复现\s*[:：]\s*(.+)$/,
  impact: /^影响\s*[:：]\s*(.+)$/,
  exploitability: /^可利用性\s*[:：]\s*(.+)$/,
  gate: /^门禁\s*(\d+)\s*(?:[（(]([^）)]*)[）)])?\s*(PASS|通过|FAIL|未评估)\s*[:：]?\s*(.*)$/
};

/** `门禁全部通过。` may share its line with the evidence that follows it. */
const ALL_PASS = /^门禁全部通过[。.]?/;

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
export function validateFindings(findings) {
  return findings.map((finding) => {
    const violations = [];
    const fails = finding.gates.filter((g) => g.status === 'FAIL');
    const notEval = finding.gates.filter((g) => g.status === '未评估');
    const passes = finding.gates.filter((g) => g.status === 'PASS' || g.status === '通过');

    for (const gate of finding.gates) {
      if (!(gate.number in GATE_NAMES)) {
        violations.push(`门禁编号 ${gate.number} 不在 1..6 内`);
      }
      if ((gate.status === 'FAIL' || gate.status === '未评估') && !gate.reason.trim()) {
        violations.push(`门禁 ${gate.number} ${gate.status} 缺少理由`);
      }
    }

    if (!finding.claim.trim()) violations.push('缺少结论描述（BUG 标题后的说明）');

    if (finding.verdict === 'TRUE POSITIVE') {
      if (!finding.evidence) {
        violations.push('缺少证据（TRUE POSITIVE 必须带 证据：path:L123）');
      } else if (finding.evidence.line === null) {
        violations.push('证据缺少行号（需要 path:L123 形式，禁止只写文件名）');
      }
      if (!finding.reproduce) {
        violations.push('缺少复现命令（TRUE POSITIVE 必须带 复现：<命令> 或 PoC）');
      }
      if (!finding.impact) violations.push('缺少影响说明（门禁 3 的证据）');
      const allPassed = finding.allPass || passes.length === 6;
      if (!allPassed) violations.push('门禁未全部通过（需要 门禁全部通过。 或六条 PASS）');
      if (fails.length) violations.push(`TRUE POSITIVE 含 FAIL 门禁（${fails.map((g) => g.number).join(', ')}）——应裁定为 FALSE POSITIVE`);
      if (notEval.length) violations.push(`TRUE POSITIVE 含未评估门禁（${notEval.map((g) => g.number).join(', ')}）——应裁定为 INCONCLUSIVE`);
    } else if (finding.verdict === 'FALSE POSITIVE') {
      if (fails.length === 0) violations.push('FALSE POSITIVE 必须至少有一条 门禁 N FAIL：<具体证据>');
    } else {
      if (notEval.length === 0) violations.push('INCONCLUSIVE 必须至少有一条 门禁 N 未评估：<为什么>');
      if (fails.length) violations.push('INCONCLUSIVE 含 FAIL 门禁——应裁定为 FALSE POSITIVE');
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
export function renderGateReport(result, { write: rawWrite = console.log } = {}) {
  const write = (line) => rawWrite(safeTextLines(line));
  const { file, findings, unparseable, downgraded, verify } = result;

  write('');
  write('euthyna gate — 6 门禁契约校验（不测量，只核对报告的自我声明）');
  write(`报告: ${file}`);
  if (verify) {
    write('⚠ --verify 以当前用户权限执行报告中的复现命令（按 argv 执行，不经过 shell）。');
    write('  默认只执行 git 命令；解释器命令（node/npm/python）需要显式 --allow-exec。');
    write('  它不是一个安全沙箱：只对你自己信任的报告使用。');
  }
  write('');

  for (const entry of findings) {
    const f = entry.finding;
    const head = `  BUG #${f.number} ${f.verdict} — ${f.claim || '(无结论描述)'}`;
    if (entry.downgraded) {
      write(`${head} — ✗ 降级为「观察」`);
    } else {
      write(`${head} — ✓ 通过`);
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
              ? `(拒绝运行 ${v.tool} —— 不在白名单)`
              : v.status === 'needs-consent'
                ? `(未执行 ${v.tool} 解释器命令 —— 需要 --allow-exec)`
                : v.status === 'unparseable'
                  ? '(命令无法拆分为 argv)'
                  : '(无复现命令)';
      write(`     复现核验 ${mark} ${how}`);
    }
    for (const violation of entry.violations) {
      write(`     缺: ${violation}`);
    }
  }

  if (unparseable.length) {
    write('');
    write('⚠ 无法解析的 BUG 行（计入降级）：');
    for (const line of unparseable) write(`  • ${line}`);
  }

  write('');
  if (downgraded === 0) {
    write('全部 finding 通过门禁契约。');
  } else {
    write(`⚠ ${downgraded} 个 finding 被降级为「观察」——缺证据、缺复现或门禁不一致，不得当作已确证的结论。`);
  }
  write('');
}
