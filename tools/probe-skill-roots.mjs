/**
 * Which skill roots does the REAL provider read, and does `~/.claude/skills` ever enter it?
 *
 * AGENTS.md's "Skill discovery paths" section used to rest on a directory count taken from one
 * live session ("65 only in ~/.agents appeared, 5 only in ~/.claude did not"). That evidence
 * aged: the two trees now share most of their names, so the comparison is no longer decisive on
 * its own, and the harness has moved from 0.1.5-rc.2 to 0.1.6-alpha.1. This drives the installed
 * provider instead, which answers the question structurally: `roots()` is the list of
 * directories it will read, and `list()` is what it actually finds from here.
 *
 * Read-only. It creates nothing, writes nothing, and never modifies a skill directory — the
 * `.claude`-only and agents-only names are read off disk and matched against the provider's own
 * output, so no marker skill has to be installed anywhere to test the claim.
 *
 * Needs the harness's provider module, which is not a dependency of this package. Point it at
 * the installed copy (the desktop app bundles it; nothing is installed into this repository):
 *
 *   node tools/probe-skill-roots.mjs "<harness>/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js"
 *
 * Two things this probe has to get right, because both were wrong in review and both would
 * report a confident number for a measurement that silently did not happen:
 *   - a skill directory can be a **symlink** (on this machine `~/.dsh/skills` holds links into
 *     the agents tree), so `Dirent.isDirectory()` alone undercounts;
 *   - a read or stat that fails for a reason **other than absence** is a broken measurement, not
 *     an empty directory, and provider warnings are evidence — neither may be swallowed.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const providerEntry = process.argv[2];
if (!providerEntry) {
  console.error('usage: node tools/probe-skill-roots.mjs <path to @deepseek-ai/dsh-skill-filesystem/lib/index.js>');
  process.exit(2);
}

// pathToFileURL, not a hand-assembled `file:///` string: a path containing `#`, `?` or `%` is
// URL syntax, and the import would target something else while appearing to succeed.
const { FileSystemSkillProvider } = await import(pathToFileURL(path.resolve(providerEntry)).href);

// Provider messages are part of the measurement: a file it refused to parse explains a name that
// is missing from the output, and an error means the result is partial. Neither may be silenced,
// and an error must not be able to exit 0.
const notices = [];
const failures = [];
const logger = {
  warn: (message) => notices.push(`warn: ${message}`),
  error: (message) => failures.push(`error: ${message}`),
  info() {},
  debug() {}
};

const controller = new AbortController();
const provider = new FileSystemSkillProvider(
  { get: () => undefined, logger },
  { invalidate() {}, signal: controller.signal },
  { includeDefaultRoots: true, watch: false, logger }
);

const roots = await provider.roots(process.cwd());
console.log(`provider ${provider.name} — roots it reads, in rank order (lower wins):`);
for (const root of roots) console.log(`  rank ${String(root.rank).padEnd(4)} ${root.path}`);
if (!roots.some((root) => root.path.includes('.claude'))) console.log('  → no `.claude` path at any rank');

/**
 * Skill names under `dir`, plus every problem met on the way.
 *
 * Two things this has to match about the provider, or the comparison is between different
 * things: it reports the name a SKILL.md **declares**, which is not always the directory's
 * basename, and an entry that is a symlink to a plain file is not a skill directory at all —
 * it is a perfectly ordinary absence, not a broken scan. Anything other than ENOENT is
 * recorded, so an empty result stays distinguishable from a measurement that never happened.
 */
async function skillDirs(dir) {
  const names = new Set();
  const problems = [];
  const refused = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') problems.push(`readdir ${dir}: ${error.code ?? error.message}`);
    return { names: [...names], problems, refused };
  }
  for (const entry of entries) {
    const here = path.join(dir, entry.name);
    let target;
    try {
      target = await stat(here); // follows a symlink; a link to a file is then not a directory
    } catch (error) {
      if (error.code !== 'ENOENT') problems.push(`${here}: ${error.code ?? error.message}`);
      continue; // a dangling link holds no skill, and says nothing about the roots
    }
    if (!target.isDirectory()) continue;
    const marker = path.join(here, 'SKILL.md');
    let text;
    try {
      text = await readFile(marker, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') problems.push(`${marker}: ${error.code ?? error.message}`);
      continue;
    }
    const name = declaredName(text);
    // Only names the provider could index enter the comparison. A folder with no `name:`, or one
    // outside the provider's pattern, is refused outright, and substituting its directory name
    // would invent a skill the listing can never contain — turning a refusal into a false miss.
    if (name === undefined || !isSkillName(name)) {
      refused.push(`${entry.name}${name === undefined ? '' : ` (name: ${name})`}`);
      continue;
    }
    names.add(name);
  }
  return { names: [...names], problems, refused };
}

/**
 * The `name:` a SKILL.md declares in its frontmatter — the identifier the provider reports.
 *
 * A YAML scalar may carry an inline comment after whitespace (`name: foo # note`), which a real
 * parser drops and a naive match would swallow into the value. Quoted values are left alone:
 * inside quotes the `#` is part of the name.
 *
 * Two limits, recorded rather than papered over, because both would need a YAML parser and a
 * second filesystem pass to close completely:
 *   - a quoted scalar containing an escape sequence (`"a\tb"`) is taken literally here, not with
 *     YAML semantics; measured 2026-10-09, none of the 264 skill files in the compared roots
 *     uses that form;
 *   - the stability check compares names, so a file edited **in place** between the two scans —
 *     same name, different content — is not drift. Detecting it means hashing every SKILL.md
 *     twice, which turns a read-only glance at the roots into a content audit.
 */
function declaredName(text) {
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[1];
  const raw = frontmatter ? /^name:[ \t]+(\S.*)$/m.exec(frontmatter)?.[1] : undefined;
  if (raw === undefined) return undefined;
  const value = raw.trim();
  const quoted = /^"([^"]*)"|'([^']*)'$/.exec(value);
  if (quoted) return (quoted[1] ?? quoted[2]).trim() || undefined;
  return value.replace(/[ \t]+#.*$/, '').trim() || undefined;
}

/** The provider's own gate: a name outside this pattern is refused, so it can never be discovered. */
const isSkillName = (name) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);

// Read the compared directories off the provider instance. The provider resolves agentsHome as
// `config.agentsHome ?? DSH_AGENTS_HOME ?? ~/.agents`, so assuming the default would compare a
// directory the provider never reads whenever that variable is set. `??` is a *nullish* check, so
// an empty `DSH_AGENTS_HOME=` is a value the provider honours (it resolves to the cwd), not an
// unset one — reported as set, and quoted so the empty case is visible.
const agentsDir = path.join(provider.agentsHome, 'skills');
const claudeDir = path.join(os.homedir(), '.claude', 'skills');
const envSet = 'DSH_AGENTS_HOME' in process.env;
console.log(
  `\nagentsHome the provider resolved: ${provider.agentsHome}` +
    (envSet ? ` (DSH_AGENTS_HOME=${JSON.stringify(process.env.DSH_AGENTS_HOME)})` : ' (DSH_AGENTS_HOME unset → default)')
);

const [agentsScan, claudeScan] = await Promise.all([skillDirs(agentsDir), skillDirs(claudeDir)]);
const { names: agents } = agentsScan;
const { names: claude } = claudeScan;
let problems = [...agentsScan.problems, ...claudeScan.problems];
const agentsOnly = agents.filter((n) => !claude.includes(n));
const claudeOnly = claude.filter((n) => !agents.includes(n));

const listed = await provider.list({ cwd: process.cwd() });
const candidates = Array.isArray(listed) ? listed : listed.candidates;

// Which root a name came from, not merely whether the name appeared: a skill can be discovered
// through a third root and still prove nothing about the two directories under comparison, so
// counts are attributed to the provider's own `source` label.
const sourcesOf = new Map();
for (const candidate of candidates) {
  if (!sourcesOf.has(candidate.name)) sourcesOf.set(candidate.name, new Set());
  sourcesOf.get(candidate.name).add(candidate.source ?? 'unknown');
}
const anywhere = (names) => names.filter((n) => sourcesOf.has(n)).length;
const bySource = (names) => {
  const tally = {};
  for (const n of names) for (const s of sourcesOf.get(n) ?? []) tally[s] = (tally[s] ?? 0) + 1;
  return JSON.stringify(tally);
};

console.log(
  `\ndisk: agents-root ${agents.length} indexable skills at ${agentsDir}, .claude ${claude.length}, ` +
    `overlap ${agents.length - agentsOnly.length}` +
    ` — excluded (provider would refuse them): agents ${agentsScan.refused.length}, .claude ${claudeScan.refused.length}`
);
if (agentsScan.refused.length || claudeScan.refused.length)
  console.log(`  refused examples: ${[...agentsScan.refused, ...claudeScan.refused].slice(0, 6).join(', ')}`);
console.log(`discovered ${candidates.length} candidates for cwd=${process.cwd()}`);
console.log(
  `  .claude-only (${claudeOnly.length}): discovered ${anywhere(claudeOnly)} [${claudeOnly.join(', ')}] ` +
    `→ attributed to a root: ${bySource(claudeOnly)}`
);
console.log(
  `  agents-only (${agentsOnly.length}): discovered ${anywhere(agentsOnly)} by source ${bySource(agentsOnly)}` +
    (anywhere(agentsOnly) < agentsOnly.length ? ' — the rest were refused or unparseable (see provider warnings)' : '')
);

const ours = candidates.filter((c) => c.name === 'euthyna' || c.name === 'euthyna-en');
console.log('\nthis project, as the real provider sees it:');
for (const candidate of ours) {
  console.log(`  ${candidate.name} rank=${candidate.rank} source=${candidate.source} invocation=${JSON.stringify(candidate.invocation)}`);
}

// The provider indexes skills by name, so a name declared twice would be counted as discovered
// once here and attributed to every directory carrying it. Measured on this machine: no
// duplicates (169 names in the agents root, 95 in `.claude`, none repeated within a root), so
// the probe asserts it instead of trusting it — a silent double count would be invisible.
const duplicated = (names) => [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
const collisions = [...duplicated(agents), ...duplicated(claude)];
if (collisions.length)
  console.log(`\nNOTE — ${collisions.length} name(s) declared by more than one directory in a root: ${collisions.join(', ')}; per-name counts cannot separate them`);

// These two homes are directories other programs edit — a running DSH session installs into them.
// The scan and provider.list() are not one atomic read, so re-scan and report if the ground moved.
// Comparison is by content, not length: a skill replaced or renamed between the passes keeps the
// count identical while the two halves of the measurement describe different trees.
const after = await Promise.all([skillDirs(agentsDir), skillDirs(claudeDir)]);
const drift = [];
for (const [label, before, again] of [
  ['agents', agents, after[0].names],
  ['.claude', claude, after[1].names]
]) {
  const added = again.filter((n) => !before.includes(n));
  const gone = before.filter((n) => !again.includes(n));
  if (added.length || gone.length)
    drift.push(`${label}: -[${gone.join(', ')}] +[${added.join(', ')}]`);
}
if (drift.length)
  console.log(
    `\nUNSTABLE — the tree moved while measuring (${drift.join('; ')}); ` +
      'the counts above describe two different moments and are not one measurement'
  );

// A name declared by two directories is the same kind of defect: the per-name tally below
// cannot attribute a discovery to one of them, so the number it prints is not a count of skills.
if (collisions.length) drift.push(`duplicate declarations: ${collisions.join(', ')}`);
problems = [...problems, ...after[0].problems, ...after[1].problems, ...drift];

// A measurement that hit anything on the way is reported, never folded into a count.
if (notices.length) {
  const unique = [...new Set(notices)];
  const shown = unique.slice(0, 8);
  console.log(`
provider said (${unique.length} unique): ${shown.join(' | ')}` +
    (unique.length > shown.length ? `
  … ${unique.length - shown.length} more omitted` : ''));
}
const incomplete = [...problems, ...failures];
if (incomplete.length) {
  console.log(`
INCOMPLETE — ${incomplete.length} scan problem(s), so the counts above are not full measurements:`);
  for (const problem of incomplete) console.log(`  ${problem}`);
}

controller.abort();
process.exitCode = incomplete.length ? 1 : 0;
