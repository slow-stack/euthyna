// Empirical verification of the DSH Stop-gate contract by running the REAL
// bridge plugin (dsh-hooks-claude-code) end to end against a stub shell
// executor. Read-only: imports the local DSH install, spawns nothing, and
// writes only a temp hooks.json under the OS temp dir.
//
// Questions this answers — each one decides whether Trail of Bits' fp-check
// `hooks.json` can be ported to DSH unchanged:
//
//   Q1. Does a `{"type":"prompt"}` hook survive into a registered listener?  (no)
//   Q2. Does `exit 2` + stderr reach `agent.steer()` as the block reason?    (yes)
//   Q3. Does fp-check's `{"ok":false}` stdout shape block anything?          (no)
//   Q4. What does the Stop payload actually carry?                  (no conversation)
//
// Run: node tools/check-stop-gate.mjs [--dsh <path-to-@deepseek-ai>]
//
// The DSH install location is discovered rather than hardcoded, because a
// reproduction step that only runs on the author's machine reproduces nothing.

import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

/** Candidate locations for the `@deepseek-ai` package directory. */
function findDshPackages() {
  const argIndex = process.argv.indexOf('--dsh');
  const explicit = argIndex >= 0 ? process.argv[argIndex + 1] : process.env.DSH_APP_ROOT;

  // The standard in-app path, relative to an install root.
  const inApp = (...parts) =>
    join(...parts.filter(Boolean), 'resources', 'app', 'node_modules', '@deepseek-ai');

  const candidates = [
    explicit,
    explicit ? join(explicit, 'node_modules', '@deepseek-ai') : null,
    process.platform === 'win32' ? inApp(process.env.ProgramFiles) : null,
    process.platform === 'win32' ? inApp(process.env['ProgramFiles(x86)']) : null,
    process.platform === 'win32' ? inApp(process.env.LOCALAPPDATA, 'Programs') : null,
    process.platform === 'darwin'
      ? '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai'
      : null,
    '/opt/DSH Desktop/resources/app/node_modules/@deepseek-ai',
    join(process.cwd(), 'node_modules', '@deepseek-ai')
  ].filter(Boolean);

  // A desktop app can be installed on any drive, and on Windows the install
  // root is not derivable from the environment: an app in D:\Program Files is
  // invisible to %ProgramFiles%, which points at C:. Probing the standard
  // relative path on each drive letter is cheap - a miss fails immediately.
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      candidates.push(inApp(`${letter}:\\Program Files`, 'DSH Desktop'));
      candidates.push(inApp(`${letter}:\\Program Files (x86)`, 'DSH Desktop'));
    }
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'dsh-hook-protocol'))) return candidate;
  }

  console.error(
    'Could not locate the DSH install.\n\n' +
      'This script imports two packages from the local DeepSeek Harness installation\n' +
      'to exercise the real hook bridge. Point it at the `@deepseek-ai` package\n' +
      'directory, which lives under the app resources:\n\n' +
      '  node tools/check-stop-gate.mjs --dsh "<app>/resources/app/node_modules/@deepseek-ai"\n\n' +
      'or set DSH_APP_ROOT to the app directory itself.\n\n' +
      `Tried ${candidates.length} locations, starting with:\n` +
      `${candidates.slice(0, 4).map(c => `  ${c}`).join('\n')}\n`
  );
  process.exit(2);
}

const DSH = findDshPackages();
const load = (p) => import(pathToFileURL(join(DSH, p)).href);

const { parseHookOutput, mergeHookOutputs } = await load('dsh-hook-protocol/lib/index.js');
const { apply: applyBridge } = await load('dsh-hooks-claude-code/lib/index.js');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
};

// ---------------------------------------------------------------- fixtures
const dir = mkdtempSync(join(tmpdir(), 'euthyna-hookcheck-'));
const configPath = join(dir, 'hooks.json');
writeFileSync(configPath, JSON.stringify({
  hooks: {
    Stop: [
      { matcher: '*', hooks: [{ type: 'prompt', prompt: 'were all 6 gates evaluated?', timeout: 30 }] },
      { matcher: '*', hooks: [{ type: 'command', command: 'gate.sh', timeout: 30 }] },
    ],
  },
}, null, 2), 'utf8');

const warnings = [];
const listeners = new Map();
const clock = { turnBoundary: { lastTurn: 1 } };
const ctx = {
  logger: { warn: (m) => warnings.push(m), info: () => {}, error: () => {} },
  on: (event, handler) => listeners.set(event, handler),
  effect: () => {},
  sessionProjections: { stateOf: () => clock },
  shell: {},   // replaced per scenario
};

const steered = [];
const appended = [];
const agent = {
  session: {
    header: { id: 'sess-1', cwd: process.cwd() },
    append: (event, payload) => appended.push({ event, payload }),
  },
  steer: (message) => steered.push(message),
};

// ------------------------------------------------- Q1: prompt hook is skipped
console.log('=== Q1: is a `type: "prompt"` hook registered? ===');
let lastRequest = null;
ctx.shell = {
  resolve: (r) => r,
  run: async (r) => {
    lastRequest = r;
    return { exitCode: 0, stdout: { text: '{}' }, stderr: { text: '' } };
  },
};
applyBridge(ctx, { configPath, defaultTimeoutMs: 600_000, stderrSummaryMaxChars: 500 });

const skippedWarning = warnings.find((w) => w.includes('skipping unsupported "prompt"'));
check('bridge warns that the prompt hook is skipped', typeof skippedWarning === 'string', true);
if (skippedWarning) console.log(`        logged: ${skippedWarning}`);
check('a Stop listener was still registered for the command hook',
  typeof listeners.get('agent/turn-stopping'), 'function');

// --------------------------------------- Q2: exit 2 + stderr blocks via steer
console.log('\n=== Q2: does exit code 2 + stderr reach agent.steer()? ===');
ctx.shell = {
  resolve: (r) => r,
  run: async (r) => {
    lastRequest = r;
    return { exitCode: 2, stdout: { text: '' }, stderr: { text: 'GATE 5 FAIL: math bounds not proven' } };
  },
};
steered.length = 0;
await listeners.get('agent/turn-stopping')({ agent, turn: 1, signal: undefined });
const steerText = steered.length ? steered[0].content.map((b) => b.text).join('') : null;
check('agent.steer() was called', steered.length, 1);
check('the reason is the hook stderr, verbatim', steerText, 'GATE 5 FAIL: math bounds not proven');

console.log('\n  -- what the hook process received on stdin --');
const payload = JSON.parse(lastRequest.stdin);
// Print the workspace path as a placeholder so the output is stable and matches
// the shape documented in docs/dsh-stop-gate-zh.md on any machine.
console.log(`     ${JSON.stringify({ ...payload, cwd: '<workspace absolute path>' })}`);
check('Stop payload carries NO conversation content',
  Object.keys(payload).sort(),
  ['cwd', 'hook_event_name', 'session_id', 'stop_hook_active', 'transcript_path'].sort());
check('transcript_path is always empty (unusable)', payload.transcript_path, '');
check('stop_hook_active is always false (no loop guard)', payload.stop_hook_active, false);

// ------------------------------ Q3: fp-check's own stdout shape does not block
console.log('\n=== Q3: fp-check stdout shape {"ok":false} vs real blocking shapes ===');
const fpShape = parseHookOutput(0, JSON.stringify({ ok: false, reason: 'gates missing' }), '', 'Stop');
check('fp-check shape -> no block', mergeHookOutputs([fpShape]).decision, 'none');

const ccShape = parseHookOutput(0, JSON.stringify({
  hookSpecificOutput: { hookEventName: 'Stop', permissionDecision: 'deny', permissionDecisionReason: 'gates missing' },
}), '', 'Stop');
check('Claude Code hookSpecificOutput shape -> blocks', mergeHookOutputs([ccShape]).decision, 'deny');

const exit2 = parseHookOutput(2, '', 'gates missing', 'Stop');
check('exit 2 + stderr -> blocks', mergeHookOutputs([exit2]).decision, 'deny');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
