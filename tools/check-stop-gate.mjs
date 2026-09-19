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
// Run: node tools/check-stop-gate.mjs

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DSH = 'D:/Program Files/DSH Desktop/resources/app/node_modules/@deepseek-ai';
const load = (p) => import(pathToFileURL(`${DSH}/${p}`).href);

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
console.log(`     ${JSON.stringify(payload)}`);
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
