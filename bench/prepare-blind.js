'use strict';

/**
 * Produce blind copies of the benchmark cases for adjudication.
 *
 * Three things have to be true for an adjudication to measure anything:
 *
 *   1. meta.json must not be readable, so the answer is absent rather than
 *      merely off-limits.
 *   2. The case must not be identifiable. Directory names such as
 *      "p1b-prototype-pollution-guarded" or "c1-comment-only" state the answer
 *      outright, so the blind copies use opaque ids and the mapping lives
 *      outside the blind tree.
 *   3. The id assignment must not outlive the round that created it. A sorted,
 *      stable mapping is reproducible — and once one round's results exist in a
 *      report or a memory store, that same mapping is an answer key for every
 *      later round. Each run therefore shuffles the ids under a seed (recorded
 *      in the mapping file, never inside the blind tree), so a new round
 *      invalidates what earlier rounds put into an adjudicator's context.
 *
 *   node bench/prepare-blind.js [--seed <n>] [--mapping <path>]
 *
 *   --seed     re-run a known shuffle (default: a fresh random seed)
 *   --mapping  where the blindId -> realId record goes
 *              (default: .scratch/blind-mapping.json)
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');

const CASES = path.join(__dirname, 'cases');
const OUT = path.join(__dirname, '..', '.scratch', 'blind');

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

const MAPPING = path.resolve(
  process.cwd(),
  flag('--mapping') ?? path.join(__dirname, '..', '.scratch', 'blind-mapping.json')
);

const seedArg = flag('--seed');
const seed = seedArg === undefined ? randomInt(0, 2 ** 31) : Number(seedArg);
if (!Number.isInteger(seed) || seed < 0 || seedArg === '') {
  console.error('--seed must be a non-negative integer');
  process.exit(1);
}

// mulberry32: 32-bit state, no dependencies, deterministic for a given seed.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Opaque ids: case-01..case-NN, but in seed-shuffled order — see the header
// comment, point 3. Same seed, same shuffle; new seed, new round.
const shuffled = [...ids];
const rand = mulberry32(seed);
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

const mapping = {};
shuffled.forEach((id, index) => {
  const blindId = `case-${String(index + 1).padStart(2, '0')}`;
  mapping[blindId] = id;
  copyBlind(path.join(CASES, id), path.join(OUT, blindId));
});

fs.mkdirSync(path.dirname(MAPPING), { recursive: true });
const record = {
  seed,
  note: 'blindId -> realId. The seed reproduces this exact shuffle; this file must never reach an adjudicator.',
  cases: mapping
};
fs.writeFileSync(MAPPING, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

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
  console.log(`seed: ${seed}`);
  console.log(`mapping kept outside the blind tree at ${path.relative(process.cwd(), MAPPING)}\n`);
  for (const blindId of Object.keys(mapping)) {
    console.log(`  ${blindId}  =  (withheld)`);
  }
}
