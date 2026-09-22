# Fact producers: when to run them, how, and how to read the output

> This skill ships two **deterministic measurements**, provided by a zero-dependency Node CLI.
> They answer questions the model cannot compute accurately — **not** "what vulnerabilities exist".
>
> This page is the operations manual: when you must run them, how to write the commands, and which section of the output decides what conclusion you may draw.
> For what you can and cannot infer from a fact once you have it, see `fact-contract.md`.

---

## 1. First, where the commands live

The CLI is **not in the skill directory** — it is a separate program of this project. In order of availability:

| Situation | How to write it | Notes |
|---|---|---|
| Installed | `euthyna history …` | `euthyna` is the command name declared by the package |
| Project checkout available | `node <euthyna repo>/bin/euthyna.js history …` | the most common form |
| Neither | — | **mark the criterion as "not evaluable"**; do not substitute a manual estimate |

### ⚠️ A real pitfall: relative paths only work inside the euthyna repository

`node bin/euthyna.js …` only works **when the current directory happens to be the euthyna repository**.
When auditing, your current directory is the **audited project**, so:

```
Error: Cannot find module 'D:\axe-core\axe-core\bin\euthyna.js'
```

`history` has `--repo` — pass the repository path explicitly and it runs from any directory:

```powershell
node <euthyna repo>/bin/euthyna.js history --base <rev> --repo <audited repo>
```

- `--repo` refers to the **audited repository**, not the euthyna path
- `--base` / `--head` both resolve relative to the **audited repository**, independent of the current directory
- the coverage command has no `--repo` — write the coverage file as an **absolute path**

Both commands were verified: run from `D:\` with `--repo` pointing at another repository, exit codes matched expectations.

---

## 2. `history` — the origin of deleted code

### When you must run it

| Trigger scenario | Corresponding stage |
|---|---|
| Reviewing a change (PR / diff / commit) where **code was deleted** | Stage B |
| The user asks "did this change weaken some protection" | Stage B |
| You need to determine whether some code was "removed and added back" | Stage B |

**If the diff contains deleted lines, run it first.** This is not optional: a diff that looks "very clean" because a check was deleted
is exactly what a security regression usually looks like, and a model cannot blame hundreds of deleted lines one by one and then trace back through commit history.

### Commands

```powershell
# basic: which commits do this change's deleted lines come from, and do those commits look like security fixes
node <euthyna repo>/bin/euthyna.js history --base <pre-change revision> --repo <audited repo>

# additionally check for "removed and added back" lines (has a probe cap; slower than the basic version)
node <euthyna repo>/bin/euthyna.js history --base <pre-change revision> --pickaxe --repo <audited repo>

# attribute deleted lines to the commit that "originally introduced" the content (not blame's "last modifier"; has a probe cap)
node <euthyna repo>/bin/euthyna.js history --base <pre-change revision> --origins --repo <audited repo>
```

`--base` is the **pre-change revision** (the PR's fork point); `--head` defaults to `HEAD`.
When the fork point is uncertain, use the result of `git merge-base <target branch> HEAD`.

### Attribution semantics (two inherent approximations; established ≠ exact)

`history`'s attribution and classification each carry a **hard-coded approximation** — know them before reading the output:

1. **Attribution: blame is "last modified", not "originally introduced".** If a security-fix line was later touched by formatting/refactoring (moved, copied), blame attributes the origin to the last commit that touched it. `--origins` uses `git log -S <line content>` to locate the commit that **originally introduced** the content; when the two differ, the fact writes out both commits (`detail.blameCommit` = last modified, `evidence.commit` = originally introduced) and states so. `--origins` only traces lines ≥ 12 characters long (for overly generic lines, `-S` would point at the first commit of the entire history, which is not the origin); when it is not enabled, the output states this under "criteria not evaluated".
2. **Classification: look at the commit message first, then the commit diff, then the deleted line itself.** When the message is vague ("update utils") but the diff touches a dangerous API, or the deleted line is itself security code (e.g. `if (!authorized) return`), it is marked `security` — the basis is recorded in `detail.classificationBasis` (`message` / `diff` / `deleted-line`). The deliberately wide bias is intentional: missing a security commit is more dangerous than over-reporting.

### What the output looks like (real capture)

```
euthyna euthyna-history — attribution and security classification of deleted code
Target: D:/axe-core/axe-core
Range: 8390a5a9…..397f5fce…

Established (8)
  • This change deleted 4 lines of code from commit ab877f9d70, spread across 2 files. Commit message: "fix(link-in-text-block): don't match style or script text (#3775)", classification: fix
       Evidence: lib/checks/color/link-in-text-block-evaluate.js (ab877f9d70)
       Reproduce: git blame --porcelain -L 104,104 -L 114,114 8390a5a9… -- lib/checks/…

⚠ Criteria not evaluated (missing data is not clean):
  • reintroduction: --pickaxe not enabled; reintroduced lines were not checked

Evaluated criteria:
  • history: 105 (euthyna-history)
```

### How to read it

| What you see | What it means |
|---|---|
| `classification: security` under "Established" | **Raise the risk to maximum**, unless you can prove that code is no longer needed |
| `classification: fix` | Not a security fix, but **read the commit message itself** — the classifier is biased wide; do not rely on the label alone |
| `spread across N files` | The file in the evidence **does not contain all** deleted lines. Do not assume only that one file is affected |
| The "⚠ Criteria not evaluated" section at the bottom | When this section is non-empty, you **must not** read this run as "checked, no problem" |
| `Established (0)` with an empty not-evaluated section | There really are no deleted lines. This is a **completed measurement**, not a failure |

**Do not run `git blame` yourself and read commit messages by eye.** The machine adjudicates the same diff twice with identical results; a human may read it twice with different results.

---

## 3. `coverage` — symbol invocation counts

### When you must run it

| Trigger scenario | Corresponding stage |
|---|---|
| The report will say "this function **has test coverage**" | Stage B / C |
| The report will say "this function **has no test coverage**" | Stage B / C |
| A conclusion depends on "that path was exercised by tests" | Stage C |

In other words: **run it before writing anything about "tested or not tested"**.

### Commands

```powershell
node <euthyna repo>/bin/euthyna.js coverage `
  --coverage <absolute path to coverage file> `
  --symbol <symbol name> --symbol <symbol name>
```

`--symbol` is repeatable — query several at once. Add `--file` to restrict to a single file.

**Both coverage formats are read** (auto-detected, no parameters needed):

| Format | Source | Notes |
|---|---|---|
| c8 / v8-to-istanbul `coverage-final.json` | JS projects (c8 lands at `coverage/coverage-final.json` by default) | Per-file `fnMap` + `f` (invocation-count array) |
| coverage.py JSON (format 3) | Python projects (produced by `coverage json`) | Top-level `{meta, files}`; in `functions`, "function name → list of executed lines", **no invocation counts**. Functions never called are still in the list with empty `executed_lines` |

The coverage.py production commands (Python targets):

```powershell
uv run --with coverage python -m coverage run `
  --include="*/src/<package>/<file>.py" `
  -m pytest <test-file> -o addopts="" -p no:randomly
uv run --with coverage python -m coverage json -o <output path>.json
```

> Two Python-specific caveats (measured in the crewAI case study):
> 1. **Disable xdist** (`-o addopts=""`) — coverage does not collect subprocess traces by default, so with `-n auto`
>    the report is empty. Override the repository's xdist defaults with `-o addopts=""`.
> 2. Restricting by file path with `--include` is more reliable than `--source` for src layouts (`--source=<package name>` may report
>    `module-not-imported`).

Where the coverage file comes from: if the project produces one, use it. When the project does not, **either run its tests once with the project's own tooling to produce it, or mark the criterion as "not evaluable"**.

### What the output looks like (real capture; one query hitting both result kinds)

```
euthyna euthyna-coverage — symbol invocation counts (can only falsify)

Established (1)
  • Symbol cleanup was never invoked in this test run (invocation count 0) — any behavior depending on it was never exercised
       Evidence: …\src\handlers.js:29

Unknown (1)
  • Symbol checkPermission was invoked 2 time(s), but a non-zero invocation count **cannot** prove any specific call site ran — this fact can only falsify, never confirm
       Evidence: …\src\authz.js:4
```

### How to read it (this section is the easiest part of the whole tool to misuse)

| Fact | What it lets you infer |
|---|---|
| Count 0, `status: established` | ✅ **Really never invoked**. You may say "this path was never exercised" on that basis |
| Count > 0, `status: unknown` | ❌ **Nothing can be inferred**. Having entered the function ≠ the specific call site you asked about ran |

The reason is fully explained in `fact-contract.md`: the underlying coverage data reports **call sites that never executed as covered**
(straight-line code after a thrown exception is the classic case), so the "covered" direction is unreliable in itself.
**The producer has no "executed" output at all — this is deliberate.**

Corollary: **do not** use "non-zero count" to close a "not tested here" concern. To prove something actually executed,
only a demonstration that truly reaches that call site can do it (Gate 4 of Stage C).

---

## 4. Exit codes: what to do with each code

| Code | Meaning | What you should do |
|---|---|---|
| `0` | Measured, no security-related findings | Continue. **But remember to read the "Criteria not evaluated" section** |
| `10` | Measured, at least one `security`-classified fact exists | **Raise priority**, then run each one through Stage C. Do not treat it as a conclusion directly |
| `1` | Usage error | Fix the command (`--base` mistyped, empty symbol name, etc.). This is not a measurement result |
| **`2`** | **Could not measure at all** | **Must not be read as clean**. Either switch measurement methods or mark the relevant criteria as "not evaluable" |

The difference between `2` and `0` is the essence of why this contract exists: **failing to measure and measuring clean are two different things.**

### Common situations that reach `2`

| Situation | What the output says | Handling |
|---|---|---|
| The directory is not inside a git repository | Not evaluated: not in any git repository | Switch to a real repository, or mark not evaluable |
| The coverage file does not exist | Not evaluated: `ENOENT`, tests not run | Produce coverage, or mark not evaluable |
| The symbol name is misspelled / does not exist | Symbol not found | Verify the symbol name; if it truly does not exist, state that it is outside the measurement scope |

**None of these count as "clean".** The report must write them into "Criteria not evaluated" with the reason stated.

---

## 5. Where they fit into the workflow

```
Stage B (change-surface audit)
  ├─ deleted lines present ────► history            → the result decides whether risk is raised to maximum
  ├─ regression judgment ──────► history --pickaxe  → the result decides whether to treat it as a "regression"
  └─ test coverage to discuss ─► coverage           → can only falsify; a non-zero count is not evidence

Stage C (claim verification)
  └─ conclusion depends on "tested or not" ──► coverage → it constrains the truth of Gate 4 (demonstration)
```

**Producers give facts, not verdicts.** They say "this line comes from a security-fix commit",
**not** "deleting it is a vulnerability" — the latter is Stage C's business.

---

## 6. `gate` — programmatic gate validation (not a measurement)

`history` / `coverage` produce facts; `gate` **does not measure** — it checks whether an audit report's self-declaration
conforms to the 6-gate contract. The report format is in SKILL.md's "adjudication format" section.

```powershell
node <euthyna repo>/bin/euthyna.js gate <report file>
node <euthyna repo>/bin/euthyna.js gate <report file> --verify --cwd <audited repo>
```

| What you see | What it means |
|---|---|
| Exit code `0` | Every finding carries the evidence it should: TP has `path:L123` evidence + reproduce command + impact + all six gates passed; FP has a FAIL gate; INCONCLUSIVE has a not-evaluated gate |
| Exit code `10` | Some finding was **downgraded to "observation"** — missing evidence / missing reproduction / gates contradicting the verdict. Read the downgrade reason; fill the gap or change the conclusion to an observation |
| Exit code `2` | The report cannot be read, or contains no verifiable findings. **Not clean** |
| `--verify`'s reproduction-check ✗ | The reproduce command actually ran but did not succeed — "says it reproduces" does not count |

`gate` only validates what the report itself says; it does not audit the target repository. So it cannot replace adjudication — it only guarantees
that a conclusion without evidence is not handed over wearing the face of "established".

---

## 7. Known limits (do not use beyond them)

- `history`'s classifier is **biased wide**: missing a security commit is more dangerous than over-reporting, so it would rather report `fix` too. The classification is a **lead** — read the commit message yourself.
- `history`'s attribution defaults to blame's "last modified" semantics; use `--origins` for "originally introduced" (has a probe cap, and only traces lines ≥ 12 characters). Both approximations are documented in this file's "Attribution semantics" section.
- `history` only covers **deleted lines**. It does not handle newly added code (except with `--pickaxe`).
- `coverage` **can only falsify**. See above.
- `coverage` relies on invocation counts and **does not handle dynamic dispatch, reflection, or string-based calls**. Conclusions of count 0 must be discounted when such mechanisms exist.
- Neither **produces scores, severity, or fix suggestions**. That is the contract, not an omission.
