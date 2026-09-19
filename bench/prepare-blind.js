'use strict';

/**
 * Produce blind copies of the benchmark cases for adjudication.
 *
 * Two things have to be true for an adjudication to measure anything:
 *
 *   1. meta.json must not be readable, so the answer is absent rather than
 *      merely off-limits.
 *   2. The case must not be identifiable. Directory names such as
 *      "p1b-prototype-pollution-guarded" or "c1-comment-only" state the answer
 *      outright, so the blind copies use opaque ids and the mapping lives
 *      outside the blind tree.
 *
 *   node bench/prepare-blind.js
 */

const fs = require('node:fs');
const path = require('node:path');

const CASES = path.join(__dirname, 'cases');
const OUT = path.join(__dirname, '..', '.scratch', 'blind');
const MAPPING = path.join(__dirname, '..', '.scratch', 'blind-mapping.json');

/** Recursive copy that skips meta.json at any depth. */
function copyBlind(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'meta.json') continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyBlind(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// The copies live outside bench/, so they do not inherit bench/package.json and
// would otherwise be resolved as ESM under the repository root's "type":
// "module" - making require() of a perfectly valid CommonJS case return an empty
// namespace. Three adjudicators hit exactly that and had to work around it with
// Node's own CJS compile path. Scoping the blind tree the same way removes the
// artefact instead of asking every reader to recognise it.
fs.writeFileSync(
  path.join(OUT, 'package.json'),
  `${JSON.stringify({ '//': 'The blind copies are CommonJS, matching bench/.', type: 'commonjs', private: true }, null, 2)}\n`,
  'utf8'
);

const ids = fs
  .readdirSync(CASES, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

// Opaque, stable ids: sorted case order mapped to case-01..case-NN. Sorting
// keeps the mapping reproducible across runs without encoding any hint.
const mapping = {};
ids.forEach((id, index) => {
  const blindId = `case-${String(index + 1).padStart(2, '0')}`;
  mapping[blindId] = id;
  copyBlind(path.join(CASES, id), path.join(OUT, blindId));
});

fs.mkdirSync(path.dirname(MAPPING), { recursive: true });
fs.writeFileSync(MAPPING, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

// Fail loudly if any answer leaked into the blind copy.
const leaked = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === 'meta.json') leaked.push(p);
  }
};
walk(OUT);

// The id must not hint at anything either.
const hints = Object.keys(mapping).filter(k => !/^case-\d{2}$/.test(k));

if (leaked.length || hints.length) {
  if (leaked.length) console.error(`answer leaked into the blind copy:\n  ${leaked.join('\n  ')}`);
  if (hints.length) console.error(`blind id reveals something: ${hints.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`${ids.length} blind case(s) -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`mapping kept outside the blind tree at ${path.relative(process.cwd(), MAPPING)}\n`);
  for (const [blindId, realId] of Object.entries(mapping)) {
    console.log(`  ${blindId}  =  (withheld)`);
  }
}
