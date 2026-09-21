'use strict';

/**
 * Collect one round's adjudication verdicts from the blind result files.
 *
 *   node bench/collect-verdicts.js [--round 4] [--out bench/verdicts-round4.json]
 *        [--seeds <s1,s2,s3>] [--models <m1,m2,m3>] [--note "..."]
 *
 * The orchestrator must not read report bodies into its own context while the
 * round is running, so this script is the only thing that touches the report
 * files, and it prints verdicts only. Per report it checks, without printing
 * content:
 *
 *   - the file exists and is non-empty;
 *   - exactly one line starts with "VERDICT:" (the closing block);
 *   - none of the three verdict words appears anywhere outside that line
 *     (protocol: the body argues in 实锤/误报/无法判定, the verdict word
 *     exists only on the final line);
 *   - the GATES / REASONING / CONTEXT DECLARATION closing blocks are present.
 *
 * The verdict is mapped blindId -> realId through the per-run mapping files
 * that prepare-blind.js wrote, and emitted as { realId: [run1, run2, run3] },
 * ordered like score.js reads cases. A make-up report named
 * case-NN-runN-b.md, when present, replaces the runN report (round-3 rule:
 * a voided or superseded run is re-adjudicated against the same seed's blind
 * tree and recorded as runN-b).
 */

const fs = require('node:fs');
const path = require('node:path');

const { resultsDir } = require('./results-dir.js');

const CASES = path.join(__dirname, 'cases');

const argv = process.argv.slice(2);
const flag = name => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  if (i + 1 >= argv.length) {
    console.error(`missing value for ${name}`);
    process.exit(1);
  }
  return argv[i + 1];
};

const ROUND = Number(flag('--round') ?? 4);
// Round 0 is reserved for the deterministic CI plumbing round (bench/adjudicate.js
// --adjudicator golden); it must never be quoted as an adjudication result.
if (!Number.isInteger(ROUND) || ROUND < 0) {
  console.error('--round must be a non-negative integer');
  process.exit(1);
}

const RUNS = 3;
// Same definition the harness writes with (bench/results-dir.js) — the writer
// and the collector must resolve the identical absolute directory.
const RESULTS_DIR = resultsDir(ROUND);
const SCRATCH = path.join(__dirname, '..', '.scratch');
const OUT = path.resolve(process.cwd(), flag('--out') ?? path.join(__dirname, `verdicts-round${ROUND}.json`));
const seeds = (flag('--seeds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const models = (flag('--models') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const note = flag('--note');
// --runs lets a mid-round invocation validate one run's reports while later
// runs have no mapping files yet; the final collection uses the default all.
const requestedRuns = (flag('--runs') ?? Array.from({ length: RUNS }, (_, i) => i + 1).join(','))
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isInteger(n) && n >= 1 && n <= RUNS);
if (requestedRuns.length === 0) {
  console.error(`--runs must list run numbers within 1..${RUNS}`);
  process.exit(1);
}

const VERDICTS = ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE'];
const CLOSING_BLOCKS = ['GATES', 'REASONING', 'CONTEXT DECLARATION'];

function normalise(raw) {
  const value = String(raw).trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return VERDICTS.find(v => value.startsWith(v)) ?? null;
}

const ids = fs
  .readdirSync(CASES, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

const perRun = Array.from({ length: RUNS }, () => ({}));
const runFiles = Array.from({ length: RUNS }, () => ({}));
const problems = [];

for (const run of requestedRuns) {
  const mappingFile = path.join(SCRATCH, `blind-mapping-round${ROUND}-run${run}.json`);
  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8')).cases;
  } catch (error) {
    problems.push(`run ${run}: cannot read mapping ${mappingFile}: ${error.message}`);
    continue;
  }

  for (const [blindId, realId] of Object.entries(mapping)) {
    const nn = blindId.startsWith('case-') ? blindId.slice('case-'.length) : blindId;
    const stem = path.join(RESULTS_DIR, `case-${nn}-run${run}`);
    const makeUp = `${stem}-b.md`;
    const file = fs.existsSync(makeUp) ? makeUp : `${stem}.md`;
    const label = path.basename(file);

    if (!fs.existsSync(file)) {
      problems.push(`run ${run} ${blindId}: report missing (${label})`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) {
      problems.push(`run ${run} ${blindId}: ${label} is empty`);
      continue;
    }

    const lines = text.split(/\r?\n/);
    const verdictLines = lines.filter(l => /^VERDICT:/.test(l));
    if (verdictLines.length !== 1) {
      problems.push(`run ${run} ${blindId}: ${label} has ${verdictLines.length} VERDICT line(s), expected exactly 1`);
      continue;
    }

    const body = lines.filter(l => !/^VERDICT:/.test(l)).join('\n').toUpperCase();
    for (const word of VERDICTS) {
      if (body.includes(word)) {
        problems.push(`run ${run} ${blindId}: verdict word "${word}" appears outside the VERDICT line`);
        break;
      }
    }
    for (const block of CLOSING_BLOCKS) {
      if (!text.toUpperCase().includes(block)) {
        problems.push(`run ${run} ${blindId}: ${label} is missing the ${block} block`);
      }
    }

    const verdict = normalise(verdictLines[0].slice('VERDICT:'.length));
    if (!verdict) {
      problems.push(`run ${run} ${blindId}: could not parse ${JSON.stringify(verdictLines[0])}`);
      continue;
    }

    perRun[run - 1][realId] = verdict;
    runFiles[run - 1][realId] = label;
  }
}

const verdicts = {};
for (const id of ids) {
  const runs = requestedRuns.map(run => perRun[run - 1][id]);
  if (runs.some(v => v)) verdicts[id] = runs;
  else problems.push(`${id}: no verdicts in any run`);
}

// Only runs that were actually requested can be expected. A one-run round
// (--runs 1, e.g. the CI plumbing round) must not fail on runs 2 and 3.
for (const id of ids) {
  if (!verdicts[id]) continue;
  for (const run of requestedRuns) {
    if (!perRun[run - 1][id]) problems.push(`${id}: run ${run} missing`);
  }
}

const headerParts = [
  `Round-${ROUND} verdicts. Each case maps to ${RUNS} independent runs; every run reshuffled the blind ids under its own seed.`,
  seeds.length === RUNS ? `Seeds per run: ${seeds.join(', ')}.` : null,
  models.length === RUNS ? `Model per run: ${models.join(' -> ')}.` : null,
  note ?? null
].filter(Boolean);
headerParts.push(
  'Reports were machine-validated by bench/collect-verdicts.js (existence, single VERDICT line, ' +
    'closing blocks, no verdict words in the body); the orchestrator never read report bodies during the round.'
);

const output = { '//': headerParts.join(' '), ...verdicts };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const collected = Object.values(verdicts).flat().filter(Boolean).length;
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
console.log(`${Object.keys(verdicts).length}/${ids.length} case(s), ${collected} verdict(s) of ${ids.length * RUNS} expected`);
const makeUps = runFiles.flat().filter(f => /-b\.md$/.test(f));
if (makeUps.length) console.log(`make-up reports used: ${makeUps.join(', ')}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
}
process.exitCode = problems.length ? 1 : 0;
