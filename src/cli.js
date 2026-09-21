/**
 * euthyna CLI.
 *
 * Exit code contract. The positioning work found that none of the eight
 * measurement plugins in this ecosystem publish a process exit code, so their
 * output cannot gate anything in CI. This one does:
 *
 *   0   measured; nothing security-classified found
 *   10  measured; at least one security-classified fact found
 *   1   usage error
 *   2   could not measure at all (no facts and a recorded reason)
 *
 * 2 is deliberately distinct from 0: a run that could not measure must never be
 * read as a clean run.
 */
import process from 'node:process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { collectHistoryFacts } from './facts/history.js';
import { collectCoverageFacts } from './facts/coverage.js';
import { collectDependencyFacts } from './facts/deps.js';
import { parseGateReport, validateFindings, verifyFinding, renderGateReport } from './gate.js';
import { makeReport, renderReport, safeTextLines, KIND } from './contract.js';
import { repoToplevel, revParse } from './git.js';

export const EXIT = Object.freeze({
  CLEAN: 0,
  FLAGGED: 10,
  USAGE: 1,
  UNMEASURED: 2
});

const HISTORY_PRODUCER = {
  name: 'euthyna-history',
  version: '0.1.0',
  purpose: '被删除代码的来源归属与安全分类'
};
const COVERAGE_PRODUCER = {
  name: 'euthyna-coverage',
  version: '0.1.0',
  purpose: '符号调用计数（只能证伪）'
};
const DEPS_PRODUCER = {
  name: 'euthyna-deps',
  version: '0.1.0',
  purpose: '依赖锁定版本（读取 lockfile，不含漏洞判定）'
};

const HELP = `
euthyna —— 给 AI 编码 agent 用的确定性事实产出器

它不是扫描器。它只回答两个模型算不准的问题，并把答案写成带证据的事实。

用法:
  euthyna history  --base <rev> [--head <rev>] [--repo <dir>] [--pickaxe] [--json]
  euthyna coverage --coverage <file> --symbol <name> [--file <path>] [--json]
  euthyna deps     [--repo <dir>] [--lockfile <file>] --dep <name> [--dep <name>] [--json]
  euthyna gate     <报告文件> [--verify] [--cwd <dir>] [--json]

命令:
  history    本次变更删掉了哪些代码、它们分别由哪个提交引入、该提交是不是安全修复
             --base    必填，比较的基线版本（如 main、HEAD~5、某个 commit）
             --head    可选，默认 HEAD
             --pickaxe 额外检查「曾被移除又加回来」的新增行（有探针上限）
  coverage   某个符号在测试运行中到底有没有被调用过
             --coverage  覆盖率数据文件，c8 的 coverage-final.json
             --symbol    要查询的符号名，可重复
             --file      可选，限定到某个文件
  deps       某个依赖在 lockfile 里被锁定/声明成什么版本（供应链声明的裁决依据）
             --repo      可选，依赖清单所在目录（默认当前目录，自动检测）
             --lockfile  可选，显式指定清单文件（支持 package-lock.json / Cargo.lock / go.mod）
             --dep       要查询的依赖名，可重复
             注：只报版本事实，不判「是否含漏洞」——版本到 CVE 的映射归判定层
  gate       检查一份审计报告是否符合 6 门禁契约（不测量，只核对报告的自我声明）
             <报告文件>   报告的 markdown 文件，裁定格式见技能 SKILL.md
             --verify     重跑每条 TRUE POSITIVE 的复现命令（白名单内工具）
             --cwd <dir>  --verify 的工作目录（默认当前目录）

退出码:
  0   已测量，没有安全相关的发现；或 gate 报告全部通过门禁契约
  10  已测量，且存在被分类为 security 的事实；或 gate 报告有 finding 被降级
  1   用法错误
  2   完全无法测量（此时**不得**当作干净）；或 gate 报告无法读取/没有可校验的 finding

注意: 缺数据不等于干净。无法测量的判据会列在输出的「未评估的判据」一节。
`;

/**
 * Minimal argv parser: `--key value`, `--flag`, and repeated `--key` flags.
 *
 * A repeated flag accumulates into an array. Overwriting instead would silently
 * drop all but the last value, which for `--symbol` means reporting on one
 * symbol while the user asked about several - a wrong answer delivered
 * confidently, which is the failure mode this project exists to remove.
 */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};

  const record = (key, value) => {
    if (key in flags) {
      flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
    } else {
      flags[key] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      record(key, true);
    } else {
      record(key, next);
      i++;
    }
  }
  return { positional, flags };
}

/** Collect repeatable flags into an array. */
function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function runHistory(flags) {
  const cwd = path.resolve(flags.repo ? String(flags.repo) : process.cwd());

  const toplevel = await repoToplevel(cwd);
  if (!toplevel) {
    return {
      exit: EXIT.UNMEASURED,
      report: makeReport({
        producer: HISTORY_PRODUCER,
        subject: { repo: cwd },
        facts: [],
        notEvaluated: [
          { kind: KIND.HISTORY, reason: `${cwd} 不在任何 git 仓库内，无法测量历史` }
        ]
      })
    };
  }

  if (!flags.base) {
    return { exit: EXIT.USAGE, error: 'history 需要 --base <rev>' };
  }

  const base = await revParse(toplevel, String(flags.base));
  if (!base) {
    return { exit: EXIT.USAGE, error: `无法解析 --base "${flags.base}" 为一个提交` };
  }

  const head = await revParse(toplevel, String(flags.head ?? 'HEAD'));
  if (!head) {
    return { exit: EXIT.USAGE, error: `无法解析 --head "${flags.head ?? 'HEAD'}" 为一个提交` };
  }

  const { facts, evaluated, notEvaluated, measured } = await collectHistoryFacts({
    cwd: toplevel,
    base,
    head,
    pickaxe: flags.pickaxe === true
  });

  const report = makeReport({
    producer: HISTORY_PRODUCER,
    subject: { repo: toplevel, base, head },
    facts,
    evaluated,
    notEvaluated
  });

  const flagged = facts.some(
    f => f.kind === KIND.HISTORY && f.detail && f.detail.classification === 'security'
  );

  // "Nothing was deleted" is a completed measurement whose answer is empty, not
  // a measurement failure. Only `measured === false` means we could not answer.
  return {
    exit: !measured ? EXIT.UNMEASURED : flagged ? EXIT.FLAGGED : EXIT.CLEAN,
    report
  };
}

async function runCoverage(flags) {
  const coverageFile = path.resolve(
    String(flags.coverage ?? 'coverage/coverage-final.json')
  );
  const symbols = asArray(flags.symbol).map(String);
  const file = flags.file ? String(flags.file) : undefined;

  // Asking for nothing is a caller mistake, not a measurement failure.
  if (symbols.length === 0) {
    return { exit: EXIT.USAGE, error: 'coverage 需要至少一个 --symbol <name>' };
  }

  const targets = symbols.map(symbol => ({ symbol, ...(file ? { file } : {}) }));
  const { facts, evaluated, notEvaluated, measured } = await collectCoverageFacts({
    coverageFile,
    targets
  });

  const report = makeReport({
    producer: COVERAGE_PRODUCER,
    subject: { coverageFile, symbols, file },
    facts,
    evaluated,
    notEvaluated
  });

  return { exit: measured ? EXIT.CLEAN : EXIT.UNMEASURED, report };
}

async function runDeps(flags) {
  const cwd = path.resolve(flags.repo ? String(flags.repo) : process.cwd());
  const deps = asArray(flags.dep).map(String);
  const lockfile = flags.lockfile ? String(flags.lockfile) : undefined;

  // Asking for nothing is a caller mistake, not a measurement failure.
  if (deps.length === 0) {
    return { exit: EXIT.USAGE, error: 'deps 需要至少一个 --dep <name>' };
  }

  const { facts, evaluated, notEvaluated, measured } = await collectDependencyFacts({
    cwd,
    lockfile,
    deps
  });

  const report = makeReport({
    producer: DEPS_PRODUCER,
    subject: { repo: cwd, lockfile: lockfile ?? '(自动检测)', deps },
    facts,
    evaluated,
    notEvaluated
  });

  return { exit: measured ? EXIT.CLEAN : EXIT.UNMEASURED, report };
}
async function runGate(flags, positional) {
  const file = positional[1];
  if (!file) {
    return { exit: EXIT.USAGE, error: 'gate 需要 <报告文件>（markdown，裁定格式见技能 SKILL.md）' };
  }

  let text;
  try {
    text = await readFile(path.resolve(file), 'utf8');
  } catch (error) {
    // An unreadable report is not a clean pass: there is nothing to check, and
    // "nothing was checked" must not read as "everything passed".
    return { exit: EXIT.UNMEASURED, error: `无法读取报告 ${file}: ${error.message}` };
  }

  const { findings, unparseable } = parseGateReport(text);
  if (findings.length === 0 && unparseable.length === 0) {
    return { exit: EXIT.UNMEASURED, error: `报告 ${file} 中没有可校验的 finding（需要 BUG #N <VERDICT> — 说明 形式）` };
  }

  const validated = validateFindings(findings);
  for (const line of unparseable) {
    validated.push({ unparseableLine: line, violations: ['无法解析的 BUG 行'], downgraded: true });
  }

  if (flags.verify) {
    const cwd = path.resolve(flags.cwd ? String(flags.cwd) : process.cwd());
    for (const entry of validated) {
      if (entry.unparseableLine) continue;
      entry.verification = await verifyFinding(entry.finding, { cwd });
      if (entry.verification.status === 'failed') {
        const v = entry.verification;
        entry.violations.push(`复现命令未通过（exit ${v.exitCode ?? '?'}${v.detail ? `: ${v.detail}` : ''}）`);
        entry.downgraded = true;
      }
    }
  }

  const downgraded = validated.filter(e => e.downgraded).length;
  const result = { file, findings: validated, unparseable, downgraded };

  if (flags.json) {
    return {
      exit: downgraded > 0 ? EXIT.FLAGGED : EXIT.CLEAN,
      json: JSON.stringify(
        {
          command: 'gate',
          file,
          findings: validated.map(e => ({
            ...(e.unparseableLine
              ? { unparseable: e.unparseableLine }
              : {
                  number: e.finding.number,
                  verdict: e.finding.verdict,
                  claim: e.finding.claim,
                  evidence: e.finding.evidence,
                  reproduce: e.finding.reproduce,
                  impact: e.finding.impact,
                  gates: e.finding.gates
                }),
            violations: e.violations,
            downgraded: e.downgraded
          })),
          downgraded
        },
        null,
        2
      )
    };
  }

  renderGateReport(result);
  return { exit: downgraded > 0 ? EXIT.FLAGGED : EXIT.CLEAN, report: null };
}

/** Entry point. Returns the process exit code. */
export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return EXIT.CLEAN;
  }

  let result;
  if (command === 'history') {
    result = await runHistory(flags);
  } else if (command === 'coverage') {
    result = await runCoverage(flags);
  } else if (command === 'deps') {
    result = await runDeps(flags);
  } else if (command === 'gate') {
    result = await runGate(flags, positional);
  } else {
    // stderr boundary, mirroring the render boundary in contract.js: text that
    // reaches the error channel may carry user or repo-controlled bytes (an
    // unknown command echoes argv; a usage error embeds flag values), so it is
    // made terminal-safe once, here. HELP is multi-line and static; safeTextLines
    // preserves its line structure and is a no-op on its plain text.
    process.stderr.write(safeTextLines(`未知命令: ${command}\n${HELP}`));
    return EXIT.USAGE;
  }

  if (result.error) {
    process.stderr.write(safeTextLines(`${result.error}\n`));
    return result.exit;
  }

  if (result.json) {
    process.stdout.write(`${result.json}\n`);
    return result.exit;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else if (result.report) {
    renderReport(result.report);
  }

  return result.exit;
}
