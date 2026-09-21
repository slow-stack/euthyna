'use strict';

/**
 * Score adjudication results against the ground truth.
 *
 *   node bench/score.js verdicts.json
 *
 * verdicts.json maps a case id to its verdict. Two shapes are accepted:
 *
 *   { "p1-prototype-pollution": "TRUE POSITIVE" }              one run per case
 *   { "p1-prototype-pollution": ["TRUE POSITIVE", "TRUE POSITIVE", "FALSE POSITIVE"] }
 *
 * The array form is what a repeat run produces, and it answers a question the
 * single-run form cannot: whether the verdict is stable. An LLM adjudicator is
 * a noisy instrument, so a 100% score from one run per case is a directional
 * signal; the same score from N runs per case, with no case disagreeing with
 * itself, is a much stronger claim - and a case that flips between runs is the
 * finding, not an inconvenience.
 *
 * The dangerous cell is a real vulnerability adjudicated as a false positive.
 * It is counted separately from an honest INCONCLUSIVE, because those are
 * different failures: one is a wrong answer, the other is a refusal to answer.
 */

const fs = require('node:fs');
const path = require('node:path');

const CASES = path.join(__dirname, 'cases');

const VERDICTS = ['TRUE POSITIVE', 'FALSE POSITIVE', 'INCONCLUSIVE'];

function normalise(raw) {
  const value = String(raw).trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return VERDICTS.find(v => value.startsWith(v)) ?? null;
}

const verdictsPath = process.argv[2];
if (!verdictsPath) {
  console.error('usage: node bench/score.js <verdicts.json>');
  process.exitCode = 1;
  return;
}

const submitted = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));

const ids = fs
  .readdirSync(CASES, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

const rows = [];
const unparsed = [];

for (const id of ids) {
  const meta = JSON.parse(fs.readFileSync(path.join(CASES, id, 'meta.json'), 'utf8'));
  const truth = meta.groundTruth === 'true_positive' ? 'TRUE POSITIVE' : 'FALSE POSITIVE';

  if (!(id in submitted)) {
    unparsed.push(`${id}: no verdict submitted`);
    continue;
  }

  const rawRuns = Array.isArray(submitted[id]) ? submitted[id] : [submitted[id]];
  const runs = [];
  for (const raw of rawRuns) {
    // A null slot is a missing run (e.g. a one-run round), not a parse failure;
    // it simply does not count toward any cell.
    if (raw === null || raw === undefined) continue;
    const verdict = normalise(raw);
    if (!verdict) unparsed.push(`${id}: could not parse ${JSON.stringify(raw)}`);
    else runs.push(verdict);
  }
  if (runs.length === 0) continue;

  rows.push({
    id,
    truth,
    runs,
    meta,
    stable: new Set(runs).size === 1,
    allCorrect: runs.every(r => r === truth)
  });
}

const allRuns = rows.flatMap(r => r.runs.map(verdict => ({ id: r.id, truth: r.truth, verdict })));

const missed = allRuns.filter(r => r.truth === 'TRUE POSITIVE' && r.verdict === 'FALSE POSITIVE');
const falseAlarm = allRuns.filter(r => r.truth === 'FALSE POSITIVE' && r.verdict === 'TRUE POSITIVE');
const abstained = allRuns.filter(r => r.verdict === 'INCONCLUSIVE');
const correct = allRuns.filter(r => r.verdict === r.truth);

const runsPerCase = rows.length ? rows[0].runs.length : 0;
const uniformRunCount = rows.every(r => r.runs.length === runsPerCase);
const width = Math.max(...rows.map(r => r.runs.length), 1);

console.log(
  `\n${rows.length} case(s) x ${uniformRunCount ? runsPerCase : 'mixed'} run(s) = ${allRuns.length} adjudication(s)\n`
);
console.log(
  'case'.padEnd(34) + 'truth'.padEnd(16) + Array.from({ length: width }, (_, i) => `run${i + 1}`.padEnd(12)).join('') +
    'stable   correct'
);
console.log('-'.repeat(34 + 16 + 12 * width + 17));

for (const r of rows) {
  const cells = Array.from({ length: width }, (_, i) => {
    const v = r.runs[i];
    if (!v) return '-'.padEnd(12);
    const short = v === 'TRUE POSITIVE' ? 'TRUE+' : v === 'FALSE POSITIVE' ? 'FALSE' : 'INCONC';
    return short.padEnd(12);
  }).join('');
  console.log(
    `  ${r.id.padEnd(32)}${r.truth.padEnd(16)}${cells}${(r.stable ? 'yes' : 'NO').padEnd(9)}${r.allCorrect ? 'yes' : 'NO'}`
  );
}

const pct = (n, d) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`);

console.log('\nconfusion matrix, counted over all runs');
console.log('-'.repeat(72));
const realBugRuns = allRuns.filter(r => r.truth === 'TRUE POSITIVE');
const notBugRuns = allRuns.filter(r => r.truth === 'FALSE POSITIVE');
console.log(`  real bugs        : ${realBugRuns.length} run(s)`);
console.log(`    caught         : ${realBugRuns.filter(r => r.verdict === 'TRUE POSITIVE').length}`);
console.log(`    missed         : ${missed.length}   <-- the dangerous cell`);
console.log(`    abstained      : ${realBugRuns.filter(r => r.verdict === 'INCONCLUSIVE').length}`);
console.log(`  not bugs         : ${notBugRuns.length} run(s)`);
console.log(`    correctly cleared : ${notBugRuns.filter(r => r.verdict === 'FALSE POSITIVE').length}`);
console.log(`    false alarms      : ${falseAlarm.length}`);
console.log(`    abstained         : ${notBugRuns.filter(r => r.verdict === 'INCONCLUSIVE').length}`);
console.log(`\n  recall on real bugs    : ${pct(realBugRuns.filter(r => r.verdict === 'TRUE POSITIVE').length, realBugRuns.length)}`);
console.log(`  specificity on non-bugs: ${pct(notBugRuns.filter(r => r.verdict === 'FALSE POSITIVE').length, notBugRuns.length)}`);
console.log(`  decided (not abstained): ${allRuns.length - abstained.length}/${allRuns.length}`);

if (runsPerCase > 1) {
  const unstable = rows.filter(r => !r.stable);
  const notAllCorrect = rows.filter(r => !r.allCorrect);

  console.log('\nrepeat-run stability');
  console.log('-'.repeat(72));
  console.log(`  cases where every run agreed with every other run : ${rows.length - unstable.length}/${rows.length}`);
  console.log(`  cases where every run matched ground truth        : ${rows.length - notAllCorrect.length}/${rows.length}`);

  if (unstable.length) {
    console.log('\n  cases that disagreed with themselves (verdict noise):');
    for (const r of unstable) {
      const tally = {};
      for (const v of r.runs) tally[v] = (tally[v] ?? 0) + 1;
      const shape = Object.entries(tally).map(([v, n]) => `${v} x${n}`).join(', ');
      console.log(`    ${r.id.padEnd(34)} truth=${r.truth.padEnd(15)} ${shape}`);
    }
  }

  if (notAllCorrect.length && !unstable.length) {
    console.log('\n  cases that were consistently WRONG (a stable error, not noise):');
    for (const r of notAllCorrect) {
      console.log(`    ${r.id.padEnd(34)} truth=${r.truth.padEnd(15)} always ${r.runs[0]}`);
    }
  }
}

// Near-neighbour pairs: same claim text, one guard apart. This is the
// benchmark's sharpest instrument - a pair the discipline fails to separate
// means the verdict came from recognising the shape, not from reading the
// guard. Rows are paired through meta.json's neighbourOf, so an unpaired case
// (the c-series) simply does not appear here.
const byId = new Map(rows.map(r => [r.id, r]));
const seenPairs = new Set();
const pairRows = [];
for (const r of rows) {
  const otherId = r.meta && r.meta.neighbourOf;
  const other = otherId && byId.get(otherId);
  if (!other) continue;
  const key = [r.id, other.id].sort().join(' | ');
  if (seenPairs.has(key)) continue;
  seenPairs.add(key);
  const truthRow = r.truth === 'TRUE POSITIVE' ? r : other;
  const guardRow = truthRow === r ? other : r;
  pairRows.push({ truthRow, guardRow, separated: truthRow.allCorrect && guardRow.allCorrect });
}
if (pairRows.length) {
  console.log('\nnear-neighbour pairs (same claim, one guard apart)');
  console.log('-'.repeat(72));
  for (const p of pairRows) {
    console.log(
      `  ${p.truthRow.id.padEnd(32)} vs ${p.guardRow.id.padEnd(32)} ${p.separated ? 'separated' : 'NOT SEPARATED'}`
    );
  }
  const separated = pairRows.filter(p => p.separated).length;
  console.log(`\n  pairs fully separated: ${separated}/${pairRows.length}`);
}

if (unparsed.length) {
  console.log('\nproblems');
  for (const p of unparsed) console.log(`  ${p}`);
}

console.log(
  '\nnote: this measures whether the discipline reaches the right verdict on a claim.\n' +
    'It does not measure whether the claims would be found in the first place, and eighteen\n' +
    'cases are few enough that the numbers are a directional signal, not a rate.\n'
);

process.exitCode = missed.length + falseAlarm.length + unparsed.length === 0 ? 0 : 1;
