'use strict';

/**
 * Score adjudication results against the ground truth.
 *
 *   node bench/score.js verdicts.json
 *
 * verdicts.json maps case id to one of TRUE POSITIVE / FALSE POSITIVE /
 * INCONCLUSIVE. Comparing them to meta.json produces the confusion matrix that
 * the benchmark exists to fill in.
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
  const verdict = normalise(submitted[id]);
  if (!verdict) {
    unparsed.push(`${id}: could not parse ${JSON.stringify(submitted[id])}`);
    continue;
  }
  rows.push({ id, truth, verdict, meta });
}

const correct = rows.filter(r => r.verdict === r.truth);
const missed = rows.filter(r => r.truth === 'TRUE POSITIVE' && r.verdict === 'FALSE POSITIVE');
const falseAlarm = rows.filter(r => r.truth === 'FALSE POSITIVE' && r.verdict === 'TRUE POSITIVE');
const abstained = rows.filter(r => r.verdict === 'INCONCLUSIVE');

console.log('\ncase                                  truth            verdict          result');
console.log('-'.repeat(84));
for (const r of rows) {
  const result =
    r.verdict === 'INCONCLUSIVE'
      ? 'abstained'
      : r.verdict === r.truth
        ? 'correct'
        : r.truth === 'TRUE POSITIVE'
          ? 'MISSED A REAL BUG'
          : 'FALSE ALARM';
  console.log(
    `  ${r.id.padEnd(34)}  ${r.truth.padEnd(15)}  ${r.verdict.padEnd(15)}  ${result}`
  );
}

const decided = rows.length - abstained.length;
const pct = (n, d) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`);

console.log('\nconfusion matrix');
console.log('-'.repeat(84));
const realBugs = rows.filter(r => r.truth === 'TRUE POSITIVE');
const notBugs = rows.filter(r => r.truth === 'FALSE POSITIVE');
console.log(`  real bugs        : ${realBugs.length}`);
console.log(`    caught         : ${realBugs.filter(r => r.verdict === 'TRUE POSITIVE').length}`);
console.log(`    missed         : ${missed.length}   <-- the dangerous cell`);
console.log(`    abstained      : ${realBugs.filter(r => r.verdict === 'INCONCLUSIVE').length}`);
console.log(`  not bugs         : ${notBugs.length}`);
console.log(`    correctly cleared : ${notBugs.filter(r => r.verdict === 'FALSE POSITIVE').length}`);
console.log(`    false alarms      : ${falseAlarm.length}`);
console.log(`    abstained         : ${notBugs.filter(r => r.verdict === 'INCONCLUSIVE').length}`);
console.log(`\n  recall on real bugs   : ${pct(realBugs.filter(r => r.verdict === 'TRUE POSITIVE').length, realBugs.length)}`);
console.log(`  specificity on non-bugs: ${pct(notBugs.filter(r => r.verdict === 'FALSE POSITIVE').length, notBugs.length)}`);
console.log(`  decided (not abstained): ${decided}/${rows.length}`);

if (unparsed.length) {
  console.log('\nproblems');
  for (const p of unparsed) console.log(`  ${p}`);
}

console.log(
  '\nnote: this measures whether the discipline reaches the right verdict on a claim.\n' +
    'It does not measure whether the claims would be found in the first place, and the\n' +
    'sample is small enough that the numbers are a directional signal, not a rate.\n'
);

process.exitCode = missed.length + falseAlarm.length + unparsed.length === 0 ? 0 : 1;
