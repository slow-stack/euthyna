'use strict';

/**
 * Run one blind adjudication round end to end.
 *
 *   node bench/adjudicate.js --round 5 --runs 3 --seeds 11,22,33 \
 *        --adjudicator "node my-adjudicator.mjs {case} {results} {blindId} {run}"
 *
 *   node bench/adjudicate.js --round 0 --runs 3 --adjudicator golden
 *
 * This is the loop the benchmark was missing: one command that goes from the
 * cases to a scored round. It prepares the blind tree, drives one adjudicator
 * process per case (blind — it sees only its own case directory), machine-
 * validates the reports, and scores the collected verdicts. The harness never
 * reads report bodies: the reports are the only thing an adjudicator writes,
 * and the verdicts the only thing that comes back.
 *
 * `--adjudicator golden` is NOT an adjudicator. It writes the ground truth
 * into the reports so the whole pipeline can run deterministically — CI can
 * verify the plumbing and that score.js goes red on a wrong verdict, without
 * spending tokens or depending on a model. It reads meta.json by design, so a
 * golden round must never be quoted as an adjudication result.
 *
 * Exit code 0 means every report validated and every verdict scored green.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomInt } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SCRATCH = path.join(ROOT, '.scratch');
const CASES = path.join(__dirname, 'cases');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  if (i + 1 >= argv.length) {
    console.error(`missing value for ${name}`);
    process.exit(1);
  }
  return argv[i + 1];
};

const ROUND = Number(flag('--round') ?? 5);
const RUNS = Number(flag('--runs') ?? 3);
const ADJUDICATOR = flag('--adjudicator');
const SEEDS = (flag('--seeds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(process.cwd(), flag('--out') ?? path.join(__dirname, `verdicts-round${ROUND}.json`));
const TIMEOUT_MS = Number(flag('--timeout-ms') ?? 15 * 60 * 1000);
const RESULTS_DIR = path.join(process.env.TEMP ?? '', `euthyna-blind-results-r${ROUND}`);
const RUNS_LIST = Array.from({ length: RUNS }, (_, i) => i + 1).join(',');

const VERDICTS = ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE'];

if (!ADJUDICATOR) {
  console.error('--adjudicator is required: a command template with {case} {results} {blindId} {run} placeholders, or "golden"');
  process.exit(1);
}
if (!Number.isInteger(ROUND) || ROUND < 0) {
  console.error('--round must be a non-negative integer');
  process.exit(1);
}
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error('--runs must be a positive integer');
  process.exit(1);
}
if (SEEDS.length && SEEDS.length !== RUNS) {
  console.error(`--seeds has ${SEEDS.length} value(s) but --runs is ${RUNS}`);
  process.exit(1);
}
if (!Number.isInteger(TIMEOUT_MS) || TIMEOUT_MS < 1000) {
  console.error('--timeout-ms must be a positive integer (milliseconds)');
  process.exit(1);
}

/**
 * The golden "adjudicator": write a valid report whose verdict is the ground
 * truth. Deliberately not blind — it is the plumbing self-check that lets CI
 * run the whole pipeline deterministically.
 */
function goldenReport(realId, blindId, run, round) {
  const meta = JSON.parse(fs.readFileSync(path.join(CASES, realId, 'meta.json'), 'utf8'));
  const verdict = meta.groundTruth === 'true_positive' ? 'TRUE POSITIVE' : 'FALSE POSITIVE';
  return [
    '# 盲审报告（golden 自检，非真实裁定）',
    '',
    `案例：${blindId}（round ${round}，run ${run}）`,
    '',
    'GATES: 六门禁逐条 pass（golden 自检直接取 ground truth，只验证管线，不测量裁定质量）',
    'REASONING: 无推理（golden 模式不经推理，见 CONTEXT DECLARATION 的 C 项）',
    'CONTEXT DECLARATION:',
    '  模型自报：golden（确定性管线自检）',
    '  A. 无',
    '  B. 无',
    '  C. 是（golden 模式读取 meta.json 的答案，非盲；禁止把 golden 轮当作真实裁定）',
    '',
    `VERDICT: ${verdict}`,
    ''
  ].join('\n');
}

/** Split a command template into argv (quotes and spaces, no shell). */
function splitCommand(line) {
  const words = [];
  let current = '';
  let mode = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (mode === 'single') {
      if (ch === "'") mode = null;
      else current += ch;
      continue;
    }
    if (mode === 'double') {
      if (ch === '"') mode = null;
      else current += ch;
      continue;
    }
    if (ch === "'") { mode = 'single'; continue; }
    if (ch === '"') { mode = 'double'; continue; }
    if (ch === ' ' || ch === '\t') {
      if (current) { words.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}

const problems = [];

console.log(`\nblind adjudication round ${ROUND}, ${RUNS} run(s)`);
console.log(`adjudicator: ${ADJUDICATOR === 'golden' ? 'golden (plumbing self-check, NOT an adjudication)' : ADJUDICATOR}`);
console.log(`results dir: ${RESULTS_DIR}\n`);

fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
fs.mkdirSync(RESULTS_DIR, { recursive: true });

for (let run = 1; run <= RUNS; run++) {
  const seed = SEEDS[run - 1] ?? randomInt(0, 2 ** 31);
  const mappingFile = path.join(SCRATCH, `blind-mapping-round${ROUND}-run${run}.json`);
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'prepare-blind.js'), '--seed', String(seed), '--mapping', mappingFile],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    );
  } catch (error) {
    problems.push(`run ${run}: prepare-blind failed (${error.message.split('\n')[0]})`);
    continue;
  }

  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8')).cases;
  } catch (error) {
    problems.push(`run ${run}: cannot read mapping ${mappingFile}: ${error.message}`);
    continue;
  }

  for (const [blindId, realId] of Object.entries(mapping)) {
    const nn = blindId.slice('case-'.length);
    const reportFile = path.join(RESULTS_DIR, `case-${nn}-run${run}.md`);

    if (ADJUDICATOR === 'golden') {
      fs.writeFileSync(reportFile, goldenReport(realId, blindId, run, ROUND), 'utf8');
      continue;
    }

    const caseDir = path.join(SCRATCH, 'blind', blindId);
    const hasPlaceholders = ADJUDICATOR.includes('{');
    const template = hasPlaceholders
      ? ADJUDICATOR
          .replaceAll('{case}', caseDir)
          .replaceAll('{results}', RESULTS_DIR)
          .replaceAll('{blindId}', blindId)
          .replaceAll('{run}', String(run))
          .replaceAll('{round}', String(ROUND))
      : `${ADJUDICATOR} ${caseDir} ${RESULTS_DIR} ${blindId} ${run}`;
    const cmd = splitCommand(template);
    const result = spawnSync(cmd[0], cmd.slice(1), {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024
    });

    if (result.status !== 0) {
      problems.push(`run ${run} ${blindId}: adjudicator exited ${result.status ?? result.signal}`);
    }
    if (!fs.existsSync(reportFile) || !fs.statSync(reportFile).size) {
      problems.push(`run ${run} ${blindId}: no report written to ${path.basename(reportFile)}`);
    }
  }
}

if (problems.length) {
  console.log(`${problems.length} problem(s) during adjudication:`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
  return;
}

// Collect (machine validation, verdict extraction) then score. Both are run as
// child processes so the harness stays out of the report bodies.
const collect = spawnSync(
  process.execPath,
  [path.join(__dirname, 'collect-verdicts.js'), '--round', String(ROUND), '--runs', RUNS_LIST, '--out', OUT],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
);
process.stdout.write(collect.stdout ?? '');
if (collect.status !== 0) {
  process.stderr.write(collect.stderr ?? '');
  process.exitCode = 1;
  return;
}

const score = spawnSync(process.execPath, [path.join(__dirname, 'score.js'), OUT], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024
});
process.stdout.write(score.stdout ?? '');
if (score.status !== 0) {
  process.stderr.write(score.stderr ?? '');
  process.exitCode = 1;
  return;
}

console.log(`\nround ${ROUND}: reports validated, verdicts collected at ${path.relative(process.cwd(), OUT)}, score green.`);
