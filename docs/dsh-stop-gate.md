# Fact-checking the DSH delivery gate (Stop hook)

English · [中文](dsh-stop-gate-zh.md)

> This document examines whether DSH's Stop hook can serve as the delivery gate, and records one conclusion that **direct testing has refuted**.
> Every conclusion below was reached by **actually running** `tools/check-stop-gate.mjs`, not by inferring from reading the source code.
> Reproduce: `node tools/check-stop-gate.mjs` (read-only, starts no processes, modifies no configuration).

---

## 1. The refuted conclusion

The conclusion that had been adopted was:

> fp-check's `hooks.json` **can be copied over as-is**; the enforcement mechanism requires no JavaScript.

**This does not hold.** Tested: configure Trail of Bits `fp-check`'s `hooks.json` into DSH as-is and **not a single hook runs**. The reasons come in two layers, each independently fatal.

---

## 2. First layer: `prompt`-type hooks are skipped outright

The two hooks in `fp-check/hooks/hooks.json` **are both `"type": "prompt"`**: one on Stop ("check whether all 6 gates have been run through"), one on SubagentStop ("check the completeness of subagent output").

The DSH bridge executes only handlers in **shell command** form. Measured output:

```
hooks-claude-code: skipping unsupported "prompt" hook on Stop (only command hooks run)
```

Source locations: `dsh-hooks-claude-code/lib/index.js:73` (`if (type !== "command") { … skipped … }`) and `:147` (emits the warning above). The `dsh-hook-protocol` README also states it explicitly: "Only command hooks run; `http`, `mcp_tool`, `prompt`, and `agent` handlers are skipped with a warning."

**Consequence**: to port this gate, the natural-language judgment in the prompt must be **rewritten as an executable script**. Option B is not "0 lines of JS" but "one gate script + one configPath".

---

## 3. Second layer (more fatal): the Stop hook cannot see the conversation

Even rewritten as a command hook, its stdin carries only these fields. The complete payload, as captured in testing:

```json
{"session_id":"sess-1","transcript_path":"","cwd":"<工作区绝对路径>",
 "hook_event_name":"Stop","stop_hook_active":false}
```

For fp-check's purposes, every entry is bad news:

| Field | Measured value | Why it is fatal |
|---|---|---|
| `transcript_path` | **Always the empty string** | The bridge documentation says it outright: "the persistence seam does not expose artifact paths, and the session logs, zstd-compressed by default, cannot be read by hook scripts" |
| `last_assistant_message` | **Does not exist** | What the agent last said cannot be seen |
| `stop_hook_active` | **Always `false`** | No "already blocked last time" marker |
| Conversation content | **Entirely absent** | The payload contains no message array |

**Conclusion**: the core action of fp-check's gate is "scan the conversation and check whether each bug's 5 phases and all 6 gates have been run through". On DSH's command hook that action is **physically impossible** — the hook cannot get the conversation.

The only things it can get are `cwd` (the workspace path) and a session id. A gate on DSH must therefore be **artifact-based**, not **conversation-based**:

```
Feasible:    check whether .euthyna/evidence.jsonl exists and covers every phase,
             whether the report file was written to disk, whether a given test
             command actually ran (ledger kept by PreToolUse)
Not feasible: check whether the agent completed the devil's-advocate 13 questions
             "in the conversation"
```

`PreToolUse` / `PostToolUse` hooks **can** get `tool_name` / `tool_input` / `tool_response`, so the right way to do this is: **keep the ledger with Pre/PostToolUse, entry by entry, and settle the books at Stop.**

---

## 4. What still holds: blocking does work

The gate mechanism itself was not refuted; only the implementation changed. Three paths were measured:

| Form | Result |
|---|---|
| Script **exit code 2**, reason written to **stderr** | ✅ Blocks; the reason reaches the agent verbatim |
| stdout prints `{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny","permissionDecisionReason":"…"}}` | ✅ Blocks |
| stdout prints fp-check's `{"ok":false,"reason":"…"}` (and exit code 0) | ❌ **Does not block** — treated as plain stdout |

The model-visible message after a block is `continue: blocked by Stop hook` (the default when no reason is provided); when a reason is provided, that reason is passed through verbatim. Fold order: `deny > ask > allow`; exit code 2 decodes to `block`, at the same rank as `deny` (rank 3).

---

## 5. Three pitfalls you must handle yourself

### 5.1 The gate must rate-limit itself, or it loops forever

DSH has no turn budget. `agent/turn-stopping` fires only when "the turn is about to end and the pending queue is empty", while blocking works by pushing a message onto that queue via `agent.steer()`, which keeps the loop going. The host README, verbatim:

> **No built-in turn budget**: a tool call or steering keeps the current turn going;
> a policy that limits runaway turns must perform cancellation from an existing lifecycle extension point (such as `agent/turn-stopping`).

And `stop_hook_active` is always `false`; the bridge documentation also warns: "an unconditionally blocking hook forces a continuation on every step unless it self-limits."

**Requirement**: the gate script must write its own state (for example, "already blocked 3 times this session") and let the turn through once the limit is exceeded.

### 5.2 Hook configuration is per-process and read once at startup

The bridge documentation: "one configuration applies to the entire process: it is read only once, at startup." Changing `hooks.json` requires restarting `dsh web` — **unlike skill Markdown's hot reload**. While iterating on gate logic, this is a real point of friction.

### 5.3 Subagents cannot be gated

`SubagentStop` is **observe-only and cannot block** (the SubagentStop branch in the bridge source does no decision folding). And `SubagentStop` always reports `agent_type: "general-purpose"`, so fp-check's approach of "checking output completeness separately by agent type" does not work here.

---

## 6. Impact on the implementation shape

| Option | Earlier assessment | After testing |
|---|---|---|
| A. Pure Markdown skill | 0 lines of JS | ✅ Unchanged. It should still be the **starting point** — a gate presupposes that the methodology itself works |
| B. Hook gate | "0 lines of JS, one `configPath`" | ❌ In fact: **one gate script (roughly 100–200 lines) + configPath**, and only artifact-based gating is possible |
| C. Native plugin | "roughly 20–130 lines of TS" | ✅ But its value has gone up: a native plugin, on `agent/turn-stopping`, can get the `agent` object and the session, **can do conversation-based gating**, and needs neither a restart nor an external script |

**Corollary**: if euthyna's gate wants to check **in-conversation facts** such as "whether all 6 gates were really run through", the command-hook route is a dead end; it has to be C (native plugin). B suits only **artifact-based facts** such as "whether the report file was written to disk" and "whether the test command actually ran".

---

## 7. Reproduction

```powershell
node tools/check-stop-gate.mjs
```

What the script does: it fabricates a minimal `ctx`, uses the **real** `dsh-hooks-claude-code` plugin to `apply()` a temporary `hooks.json` (containing both a prompt hook and a command hook), captures the listeners it registers and the warnings it logs, then, with a stub executor returning `exitCode: 2`, asserts that the text `agent.steer()` receives equals the hook's stderr.

If it prints `ALL CHECKS PASSED`, every conclusion in this document holds. The script makes no network calls, spawns no processes, and writes no configuration.
