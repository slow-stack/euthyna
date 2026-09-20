# Case Study: A Validation Run of euthyna on crewAI (2026-09-20)

English · [中文](case-study-crewai-zh.md)

> **What this document is**: it records a **method-validation run** of euthyna — running euthyna's
> two deterministic measurements (`history`, `coverage`) and its six-gate adjudication discipline
> against a real **Python** codebase. The previous case study ran on a JavaScript codebase
> (axe-core); this run is the Python counterpart: does the method hold up on a large Python
> project with a real history, real tests, and real maintenance?
>
> **Conclusion first**: the method holds up. `history` worked on a Python repository unchanged
> (git blame is language-independent), and the **coverage producer was extended to read
> coverage.py JSON (format 3)** — previously it only read c8/V8 output, so Python was an
> explicit unverified gap. Both states (never-invoked vs. invoked) were verified against real
> coverage.py data from crewAI's own test run.
>
> **This is not an evaluation of crewAI**: this report is not an endorsement of crewAI's
> security posture. 0 true positives is only the result of this one run under a limited scope;
> the criteria not evaluated are listed in Section 1.

**Audit mode**: quick (limited scope, for measuring the **false positive rate** and validating Python support)
**Target repository**: crewAI (upstream `crewAIInc/crewAI`), main package `lib/crewai/src/crewai` (105,778 source lines)
**Baseline commit**: `0374c6312` (2026-09-20, local synced to latest upstream)
**Stages executed**: C (conclusion-surface validation) + B (change surface, one commit) + both deterministic measurements
**Where the report was written**: the report lives inside the euthyna repository and was **not written into the repository under test**.

---

## 0. Executive summary

| Metric | Value |
|---|---|
| Coarse-screen candidates | 3 (2 subprocess sites treated as one family, + 1 pickle) |
| TRUE POSITIVE | **0** |
| FALSE POSITIVE | 2 (subprocess machine fingerprint; lock-move change surface) |
| INCONCLUSIVE | 1 (pickle deserialization) |
| Non-security observations | 2 |
| **False positive rate of this coarse screen** | **2/3 = 67%** |

**Method-validation results**:

| Validation point | Result |
|---|---|
| `history` on a Python repository | ✅ Real run: commit `32f5e7444` deleted 12 lines originating from `c5a8fef118`; attribution and classification correct |
| `coverage` reading coverage.py JSON (format 3) | ✅ Real run: `PickleHandler.load` invoked by tests (UNKNOWN), `FileHandler.log` never invoked (ESTABLISHED); both states correct |
| Six-gate discipline on Python code | ✅ Three candidates died at different gates or lacked in-code proof, each with concrete evidence |

**Conclusion**: on this one target, **67% of the pattern-matched candidates were false positives**,
and the remaining one is a real risk class whose complete attack chain depends on a supply-chain
assumption outside the repository. This is another quantified sample of the gap euthyna exists
to close: **"looks dangerous" and "is a vulnerability" are not the same thing**.

---

## 1. Coverage table (what was not tested comes first)

| Criterion | Status | Reason |
|---|---|---|
| Whole-repo vulnerability scan | ❌ Not evaluated | Quick mode: high-risk patterns only, not a full audit |
| Dependency vulnerabilities (OSV etc.) | ❌ Not evaluated | No dependency query run |
| Secret scanning (full) | ⚠️ Partial | 0 hits in coarse screen; 0 hits does not mean no secrets |
| SQL injection | ❌ Not evaluated | 0 hits at the string-interpolation pattern; ORM layer not audited |
| Concurrency / TOCTOU (whole repo) | ⚠️ Partial | Only the lock-move change surface was checked |
| Build / CI configuration | ❌ Not evaluated | Outside quick tier's scope |

**This report therefore cannot serve as an endorsement that "crewAI has no security issues".**
It says only: under the scope and criteria this run limited itself to, no true positives were
found, and the method itself is reproducibly functional on a Python codebase.

---

## 2. Coarse-screening method and candidate sources

A **scanner without discipline** was simulated: classic high-risk pattern regexes over
`lib/crewai/src/crewai` (excluding `tests/` and `__pycache__`).

| Pattern family | Hits | Note |
|---|---|---|
| `shell=True` / `os.system` / `subprocess` | 2 | Both in `events/listeners/tracing/utils.py` |
| `eval` / `exec` / `pickle` / `yaml.load` | 6 | All 6 in `utilities/file_handler.py` (import + save/load) |
| Hardcoded key literal | 0 | — |
| `requests` without `verify=False` | 0 | — |
| Path traversal (`../`) | 10 | Mostly template strings in console_formatter, not file ops |
| SQL string interpolation | 0 | — |
| `os.environ` secret read | 0 | — |

The screen converged to **3 candidates** (the 2 subprocess sites are one family):

1. `events/listeners/tracing/utils.py:215` — `subprocess.run(["system_profiler", ...])`
2. `events/listeners/tracing/utils.py:234` — `subprocess.run(["wmic.exe", ...])`
3. `utilities/file_handler.py:166` — `pickle.load(file)` (`# noqa: S301`)

Plus one stage-B change-surface candidate:

4. commit `32f5e7444` — "Skip lock acquisition in CrewTrainingHandler.load when file is missing"

---

## 3. Adjudication details

### BUG #1 FALSE POSITIVE — `subprocess.run` at `events/listeners/tracing/utils.py:215`

**Gate 2 (reachability) FAIL**: command and arguments are fully hardcoded
(`/usr/sbin/system_profiler SPHardwareDataType`, `C:\Windows\System32\wbem\wmic.exe csproduct get UUID`),
no `shell=True`, no user input reaches the command or its arguments, and `capture_output=True`
only reads output for a machine fingerprint. An attacker cannot control this command. This is
normal telemetry identification (reading the local hardware UUID), not command injection.

- Evidence: `lib/crewai/src/crewai/events/listeners/tracing/utils.py:215-249`
- Reproduce: `git blame -L 215,249 -- lib/crewai/src/crewai/events/listeners/tracing/utils.py`
- False-positive checklist: item 9 (pattern match ≠ analysis), item 4 (data source context — constants, not network data)

### BUG #2 FALSE POSITIVE — commit `32f5e7444` "deleting lock logic" (change surface)

**Gate 3 (real impact) FAIL**: at first glance a security-fix commit deleted 12 lines
originating from the locking commit `c5a8fef118`. Reading the actual diff, **the lock logic is
substantively preserved**: `store_lock` merely moved from "acquire unconditionally" to "acquire
when the file exists"; the real `open` + `pickle.load` remains inside the lock. The commit
message states the motivation (performance: every kickoff calls `_use_trained_data` → `load()`,
and deployments that never train should not acquire the cross-process Redis-backed lock).

Two behavioural differences, neither a security regression:

1. The `os.path.getsize() == 0` empty-file short-circuit was removed — but `pickle.load` on an
   empty file raises `EOFError`, and the new code catches `(FileNotFoundError, EOFError)` and
   returns `{}`, so behaviour is equivalent.
2. The `os.path.exists` check moved outside the lock — there is no file-deletion path
   (`clear()` does `save({})`, it does not delete), so no TOCTOU surface exists between the
   check and the locked read.

- Evidence: `git show 32f5e7444 -- lib/crewai/src/crewai/utilities/file_handler.py`
- `history` output: 12 lines from `c5a8fef118`, classified `fix`, reproduce command attached
- False-positive checklist: item 1 (trace the full validation chain), item 6 (verify TOCTOU claims)

### BUG #3 INCONCLUSIVE — `pickle.load` at `utilities/file_handler.py:166`

**Claim restated**: `CrewTrainingHandler.load()` → `pickle.load(file)` deserializes without
restriction; an attacker who controls the file contents can execute arbitrary code (CWE-502).

**Gates**:

| Gate | Result | Evidence |
|---|---|---|
| 1 Process | ✅ | Data flow, PoC, and history all completed |
| 2 Reachability | ⚠️ Not proven | An attacker **cannot** write the `.pkl` remotely; the writer is the local `train()` flow (`crew.py:972`, data from LLM evaluation results); the reader reads user-configured paths (`crew.trained_agents_file` field / `CREWAI_TRAINED_AGENTS_FILE_ENV`). Exploitation presupposes "the user loads an attacker-supplied file" (supply chain / config poisoning) — a path that **cannot be proven inside this repository** |
| 3 Real impact | ✅ | pickle RCE = arbitrary code execution, severe |
| 4 PoC validated | ✅ | Executable PoC: a malicious `__reduce__` payload executed `os.getenv("USERNAME")` via `PickleHandler.load()` (real, non-empty output) |
| 5 Mathematical boundary | ✅ | `pickle.load` has no sanitisation or allow-list; the condition necessarily holds |
| 6 Environment | ✅ | No sandbox or guard blocks it |

**Verdict: INCONCLUSIVE** — no gate FAIL, but Gate 2's "attacker control" depends on a
supply-chain assumption outside the repository (the user loading an untrusted file), so the full
attack chain cannot be established in code. Per euthyna's rules this must not be reported as
TRUE POSITIVE, and per Devil's-advocate question 12 it must not be dismissed as FALSE POSITIVE
just because exploitation looks unlikely.

**Recommendation to the project (as an observation, not a finding)**: this is the repo's only
`pickle.load` (the author acknowledged it with `# noqa: S301`). `trained_agents_file` is a public
configuration field; if a user obtains crew configuration or training artifacts from an untrusted
source, this is a genuine supply-chain RCE surface. Suggested: restricted deserialization
(`pickletools` allow-list, or JSON), or documentation that untrusted training files must not be loaded.

- Evidence: `lib/crewai/src/crewai/utilities/file_handler.py:154-166` (the `load` method)
- Data flow: `crew.py:336 (trained_agents_file field)` → `agent/core.py:1442 (_use_trained_data)` → `agent/core.py:724 (apply_training_data)` → `file_handler.py:166 (pickle.load)`
- Writer side: `crew.py:972 (train() flow)` → `training_handler.py:8 (save_trained_data)` → `file_handler.py:152 (pickle.dump)`
- History: `pickle.load` introduced by `d1343b96e` (2025-10-20, v1.0.0); locked by `c5a8fef118` (2026-03-13)
- PoC: payload only executes `os.getenv`, no destructive effect

---

## 4. Method-validation details

### 4.1 `history` on a Python repository (validation point)

```powershell
node <euthyna repo>/bin/euthyna.js history --base 32f5e7444^ --head 32f5e7444 --repo D:\crewAI
```

Real output (excerpt):

```
已确证 (1)
  • 本次变更删除了 12 行来自提交 c5a8fef118 的代码（文件：…/file_handler.py）。
    提交信息："fix: add cross-process and thread-safe locking to unprotected I/O (#4827)"，分类：fix
```

`git blame` is language-independent, so `history` works on a Python repository without any
change. Exit code 0.

### 4.2 `coverage` reading coverage.py JSON — the capability added by this run

Test run (module-scoped; xdist disabled so tracing stays in-process):

```powershell
uv run --with coverage python -m coverage run \
  --include="*/src/crewai/utilities/file_handler.py" \
  -m pytest lib/crewai/tests/utilities/test_file_handler.py -o addopts="" -p no:randomly
uv run --with coverage python -m coverage json -o <path>/crewai-filehandler.json
```

euthyna queries against the real data:

| Symbol | Result | Evidence |
|---|---|---|
| `load` (`PickleHandler.load`, exercised by tests) | UNKNOWN "at least invoked once" | `file_handler.py:154` |
| `log` (`FileHandler.log`, not exercised by tests) | ESTABLISHED "never invoked" | `file_handler.py:65` |

Both states correct, consistent with the c8 path. **The coverage.py format support added by this
run (commit `231e369`) is verified against a real Python project.**

**coverage.py format notes (differences from c8, for future audits)**:

- Top level is `{"meta": {...}, "files": {...}}`; per-file entries live under `files`
- `functions` maps a function name to `{executed_lines, missing_lines, start_line}`; there is
  **no invocation counter**
- Functions never called still appear in `functions` with an empty `executed_lines` → the
  two-state mapping is: empty = ESTABLISHED (never invoked), non-empty = UNKNOWN (invoked)
- Methods are named `Class.method`; euthyna accepts a bare-method-name suffix match

---

## 5. Non-security observations (**not findings**)

### Observation 1: `os.path.getsize() == 0` empty-file short-circuit was dropped

The lock-move commit (`32f5e7444`) removed the empty-file fast path from `load()`. Behaviour is
equivalent (EOFError is caught), but a zero-byte file now goes through the lock and the open
attempt. Performance-only, recorded for completeness.

### Observation 2: `trained_agents_file` is loaded on every task prompt build

`apply_training_data` (`agent/core.py:724`) runs on every prompt construction and opens the
pickle file each time. On deployments that never train, this is a per-kickoff file read unless
the file is absent (the lock-move commit's stated motivation). Recorded as context for the
INCONCLUSIVE finding.

---

## 6. Process record: how one candidate was refuted by execution

The lock-move change surface (BUG #2) is the counterpart of the axe-core run's process record.
There, a plausible escape was refuted by execution; here, a plausible **regression** was refuted
by reading the actual diff rather than trusting the commit summary:

- Step 1: `history` reported "12 lines from the locking commit `c5a8fef118`" — a red flag by the
  book: a fix commit deleting code from another fix commit.
- Step 2: `git show 32f5e7444` revealed the deleted lines were the *unconditional lock
  acquisition*, not the lock itself; the read stays inside `store_lock`.
- Step 3: the two behavioural deltas (empty-file short-circuit removed; `exists` outside the
  lock) were each checked against a file-deletion/TOCTOU possibility — none exists.
- Step 4: verdict FALSE POSITIVE, with the change-surface evidence attached.

**Lesson recorded**: "deleted lines from a fix commit" is a *trigger for inspection*, never a
conclusion. The direction of this case (a regression that looked real but was not) is the mirror
image of the axe-core case (an escape that looked plausible but was not).

---

## 7. Count summary

- TRUE POSITIVE: 0
- FALSE POSITIVE: 2
- INCONCLUSIVE: 1
- Non-security observations: 2

---

## 8. Capability gaps exposed by this run (recorded faithfully)

1. **coverage.py JSON was unreadable before this run** — the previous producer only accepted
   c8/V8 output. Now supported (format 3), with regression tests; the `--source`/`--include`
   semantics of coverage.py still need documentation in the skill's producer manual.
2. **Python method naming**: coverage.py emits `Class.method`; the suffix-match addition is
   validated but its collision behaviour (two classes with the same method name) is not yet
   covered by a test.
3. **`-o addopts=""` was needed** to disable the repo's xdist default for in-process tracing —
   a deployment detail worth recording for Python targets.

---

## 9. Statement of limitations

- Quick mode: only 7 high-risk pattern families screened, not a full audit
- Coverage data covers only `file_handler.py` (focused validation, not whole-repo coverage)
- No dependency-vulnerability query, no deep secret scan, no CI configuration audit
- crewAI has no `SECURITY.md`, so no process comparison was possible
- The INCONCLUSIVE finding's Gate 2 rests on a supply-chain assumption that the repository
  itself cannot prove — that is exactly why it is INCONCLUSIVE and not TRUE POSITIVE
