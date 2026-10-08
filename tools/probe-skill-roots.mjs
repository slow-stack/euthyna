/**
 * Which skill roots does the REAL provider read, and does `~/.claude/skills` ever enter it?
 *
 * AGENTS.md's "Skill discovery paths" section used to rest on a directory count taken from one
 * live session ("65 only in ~/.agents appeared, 5 only in ~/.claude did not"). That evidence
 * aged: the two trees now share most of their names, so the disjoint remainder that made the
 * comparison decisive is a fraction of what it was. This drives the installed provider instead,
 * which answers the question structurally: `roots()` is the list of directories it will read,
 * and `list()` is what it actually finds from here.
 *
 * Read-only. It creates nothing, writes nothing, and never modifies a skill directory — the
 * `.claude`-only and `.agents`-only names are read off disk and matched against the provider's
 * own output, so no marker skill has to be installed anywhere to test the claim.
 *
 * Needs the harness's provider module, which is not a dependency of this package. Point it at
 * the installed copy (the desktop app bundles it, nothing is installed into this repository):
 *
 *   node tools/probe-skill-roots.mjs "<harness>/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js"
 *
 * Measured with this command on 2026-10-09 against @deepseek-ai/dsh-skill-filesystem
 * 0.1.6-alpha.1: four roots (project `.dsh` 100, project `.agents` 200, dshHome 400,
 * agentsHome 500), no `.claude` path at any rank, 178 candidates, 0 of the 5 `.claude`-only
 * skills discovered, and both skill editions reporting
 * `{"modelInvocable":false,"userInvocable":true}` at each rank they appear.
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

// pathToFileURL, not a hand-assembled `file:///` string: a path containing `#`,
// `?` or `%` is URL syntax, and the import would silently target something else.
const { FileSystemSkillProvider } = await import(pathToFileURL(path.resolve(providerEntry)).href);

const quietLogger = { warn() {}, info() {}, debug() {}, error() {} };
const controller = new AbortController();
const provider = new FileSystemSkillProvider(
  { get: () => undefined, logger: quietLogger },
  { invalidate() {}, signal: controller.signal },
  { includeDefaultRoots: true, watch: false, logger: quietLogger }
);

const roots = await provider.roots(process.cwd());
console.log(`provider ${provider.name} — roots it reads, in rank order (lower wins):`);
for (const root of roots) console.log(`  rank ${String(root.rank).padEnd(4)} ${root.path}`);
if (!roots.some((root) => root.path.includes('.claude'))) console.log('  → no `.claude` path at any rank');

/** Skill directory names under `dir`: an entry counts only if it holds a SKILL.md. */
async function skillDirs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(path.join(dir, entry.name, 'SKILL.md'));
      found.push(entry.name);
    } catch {
      /* not a skill directory */
    }
  }
  return found;
}

// Read the directories off the provider instance, not off os.homedir(): the
// provider resolves agentsHome as `config.agentsHome ?? DSH_AGENTS_HOME ??
// ~/.agents`, so assuming the default would compare a directory the provider
// never reads whenever that variable is set.
const agentsDir = path.join(provider.agentsHome, 'skills');
const claudeDir = path.join(os.homedir(), '.claude', 'skills');
console.log(`\nagentsHome the provider resolved: ${provider.agentsHome}` +
  (process.env.DSH_AGENTS_HOME ? ` (DSH_AGENTS_HOME=${process.env.DSH_AGENTS_HOME})` : ' (DSH_AGENTS_HOME unset → default)'));
const [agents, claude] = await Promise.all([skillDirs(agentsDir), skillDirs(claudeDir)]);
const agentsOnly = agents.filter((n) => !claude.includes(n));
const claudeOnly = claude.filter((n) => !agents.includes(n));

const listed = await provider.list({ cwd: process.cwd() });
const candidates = Array.isArray(listed) ? listed : listed.candidates;

// Which root a name came from, not merely whether the name appeared: a skill can
// be discovered through a third root and still prove nothing about the two being
// compared, so counts are attributed to the provider's own `source` label.
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
  `\ndisk: agents-root ${agents.length} skill dirs at ${agentsDir}, .claude ${claude.length}, ` +
    `overlap ${agents.length - agentsOnly.length}`
);
console.log(`discovered ${candidates.length} candidates for cwd=${process.cwd()}`);
console.log(
  `  .claude-only (${claudeOnly.length}): discovered ${anywhere(claudeOnly)} [${claudeOnly.join(', ')}] ` +
    `— none of these directories is a root, so any hit would have to come from elsewhere: ${bySource(claudeOnly)}`
);
console.log(
  `  agents-only (${agentsOnly.length}): discovered ${anywhere(agentsOnly)} by source ${bySource(agentsOnly)}` +
    (anywhere(agentsOnly) < agentsOnly.length
      ? ' — the remainder fail to parse as skills (their files, not this question)'
      : '')
);

const ours = candidates.filter((c) => c.name === 'euthyna' || c.name === 'euthyna-en');
console.log('\nthis project, as the real provider sees it:');
for (const candidate of ours) {
  console.log(`  ${candidate.name} rank=${candidate.rank} source=${candidate.source} invocation=${JSON.stringify(candidate.invocation)}`);
}

controller.abort();
