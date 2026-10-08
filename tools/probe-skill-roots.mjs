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
import { readdir, stat } from 'node:fs/promises';
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

// Provider warnings are part of the measurement: a file it refused to parse explains a name that
// is missing from the output. Forward them instead of silencing them.
const warnings = [];
const logger = {
  warn: (message) => warnings.push(`warn: ${message}`),
  error: (message) => warnings.push(`error: ${message}`),
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
 * Skill directory names under `dir`, plus every problem met on the way.
 *
 * A directory counts when it holds a `SKILL.md`, whether it is a real directory or a symlink to
 * one. Anything other than ENOENT is recorded: an empty result must be distinguishable from a
 * scan that never happened.
 */
async function skillDirs(dir) {
  const names = [];
  const problems = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') problems.push(`readdir ${dir}: ${error.code ?? error.message}`);
    return { names, problems };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const marker = path.join(dir, entry.name, 'SKILL.md');
    try {
      const info = await stat(marker); // stat follows symlinks
      if (info.isFile()) names.push(entry.name);
    } catch (error) {
      if (error.code !== 'ENOENT') problems.push(`${marker}: ${error.code ?? error.message}`);
    }
  }
  return { names, problems };
}

// Read the compared directories off the provider instance. The provider resolves agentsHome as
// `config.agentsHome ?? DSH_AGENTS_HOME ?? ~/.agents`, so assuming the default would compare a
// directory the provider never reads whenever that variable is set.
const agentsDir = path.join(provider.agentsHome, 'skills');
const claudeDir = path.join(os.homedir(), '.claude', 'skills');
console.log(
  `\nagentsHome the provider resolved: ${provider.agentsHome}` +
    (process.env.DSH_AGENTS_HOME ? ` (DSH_AGENTS_HOME=${process.env.DSH_AGENTS_HOME})` : ' (DSH_AGENTS_HOME unset → default)')
);

const [agentsScan, claudeScan] = await Promise.all([skillDirs(agentsDir), skillDirs(claudeDir)]);
const { names: agents } = agentsScan;
const { names: claude } = claudeScan;
const problems = [...agentsScan.problems, ...claudeScan.problems];
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

console.log(`\ndisk: agents-root ${agents.length} skills at ${agentsDir}, .claude ${claude.length}, overlap ${agents.length - agentsOnly.length}`);
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

// A measurement that hit anything on the way is reported, never folded into a count.
if (warnings.length) console.log(`\nprovider said (${warnings.length}): ${[...new Set(warnings)].slice(0, 8).join(' | ')}`);
if (problems.length) {
  console.log(`\nINCOMPLETE — ${problems.length} read/stat problem(s), so the counts above are not full measurements:`);
  for (const problem of problems) console.log(`  ${problem}`);
}

controller.abort();
process.exitCode = problems.length ? 1 : 0;
