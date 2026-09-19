# euthyna Competitive Positioning Analysis

English · [中文](positioning-zh.md)

> Search method: **all categories**, with no filtering by `category`. Filtering by category
> would miss peer tools scattered across categories such as `tools` / `git` / `dev`,
> systematically skewing the gap assessment.
> Every conclusion below marks its evidence base.
>
> Data: `data/dsh-plugins.json` (3931 plugins, 2026-09-18 snapshot)
> Tool: `tools/probe-audit-space.js` (positioning probe with match context)
> Full probe output: `data/audit-space.txt`

---

## 0. Summary of Conclusions

**"Deterministic measurement" is fully occupied, and "evidence gates" are fully occupied too. The real gap is the layer in between:**

> Nothing feeds measured facts into a **security-specific discipline for adjudicating conclusions**, or, on that basis, **blocks failing deliveries**.

All three tracks are occupied in their own right, but they are **three isolated islands**:

| Track | Occupancy | Representatives |
|---|---|---|
| Deterministic measurement | **Crowded**: 8+ dedicated tools, each covering one slice | `dsh-tool-lens`, `dsh-blast-radius`, `dsh-code-coverage`, `dsh-dep-vuln-scan`, `dsh-code-security` |
| Delivery gates / enforcement mechanisms | **Crowded and already productized** | `dsh-doublecheck`, `formalswarm`, `dsh-expert-team`, `loopx` |
| Evidence-lifecycle workbench | **Taken** | `dsh-omv` (evidence-first vulnerability research workbench) |

---

## 1. Track 1: Deterministic Measurement (Crowded, but Mutually Disconnected)

Eight tools of comparable size, each measuring one slice and **each defining its own output shape**. Verification points:

| Tool | What it measures | Engine | Output shape |
|---|---|---|---|
| `dsh-tool-lens` (5★, dl=2186) | AST code graph, call chains, circular dependencies, impact surface, diff impact | In-house, on the TypeScript compiler API | `CodeGraphResult{ nodes, edges, impactTiers, … }` |
| `dsh-blast-radius` (0★, dl=517) | **Symbol-level** blast radius of edits pending commit: production call sites vs **test references** | Wraps `tsserver` (an LSP client) | `BlastRadius{ impacts, risk, uncovered, reachedFiles }` |
| `dsh-code-coverage` (1★, dl=267) | AI-written files × real execution coverage from c8, AI vs human coverage comparison | Wraps `c8` + reads DSH session logs for attribution | CLI `--json` / `dsh-fix-plan.json` |
| `dsh-code-security` (1★, dl=1024) | 48 regex rules + secret entropy detection + diff review | **Zero-dependency in-house rule table** | **SARIF 2.1.0** / Markdown |
| `dsh-dep-vuln-scan` (0★) | Lockfile dependencies × OSV, 8 ecosystems, with fix versions | In-house lockfile parsing + OSV HTTP | Markdown table + `presentationMeta` |
| `dsh-cve-audit` (2★) | Same as above but only 3 ecosystems, no fix versions; self-described as "not yet run on a real dsh" | In-house + OSV | Structured JSON |
| `dsh-trust-check` (0★, dl=1665) | Capability disclosure of **DSH plugins** (8 capability classes + 5 red lines) | In-house static scanning, the rule table is the data | **Versioned integration contract** `schemaVersion:1` + 5 stable gate fields |
| `dsh-plugin-gate` (0★, dl=1099) | Signature scanning of **plugin source** (60 rules) + destructive-command guard | In-house regex + in-house tar.gz reading | `verdict: BLOCK\|WARN\|PASS` |

### Key Observations

1. **The scope is cut into three blocks that do not intersect**: your own source (tool-lens / blast-radius / code-security / code-coverage), your own dependencies (dep-vuln-scan / cve-audit), and DSH plugins (trust-check / plugin-gate).
2. **No two of them share a machine-readable fact schema.** Eight output shapes; only `dsh-code-security` emits SARIF, and only `dsh-trust-check` has a versioned contract.
3. **None of them has a process exit-code contract.** The gate is expressed only as a tool-result field (`verdict` / `redLines` / `failOn`) or a hook decision. Unusable for CI.
4. "Test coverage" gets **half-covered twice**: `dsh-blast-radius` uses static **test references** (by symbol, without verifying execution), and `dsh-code-coverage` uses real execution coverage (by file/line, no call graph). **Neither answers whether the callers of a changed symbol have test coverage** — that join does not exist.
5. **`dsh-blast-radius` is not an invocable tool at all.** It attaches only to a `tools/pre-execute` waterfall hook — no tool, no file artifact, no exit code; and it supports only TS/JS, so dynamic calls (reflection / `eval` / string indexing) cannot be captured. Its `unavailable` field means "unknown" and is **never rendered as safe** — that "unknown ≠ safe" treatment is worth borrowing.
6. **`dsh-tool-lens`'s "recommended tests" are graph adjacency, not coverage.** In `src/analytics/git-diff.ts`, `affectedTestFiles` comes from nodes on the graph traversal whose paths match test-file patterns — that is, **structurally adjacent** test files, not tests that cover the changed symbol. The name looks like coverage; it is not.
7. **`dsh-trust-check` has the contract design most worth borrowing**: it narrows the gate surface down to 5 fields (`name` / `version` / `spec` / `capabilities` / `redLines`), **states in writing "do not gate on `score` or `band`"**, and is fail-closed — a non-empty `errors` is always treated as a scan failure, never as `clear`. This is exactly what a "fact contract" should look like.
8. **`dsh-dep-vuln-scan`'s confirmation criterion is worth borrowing**: it does not take the OSV response at face value; a finding counts as confirmed only via "query with `version` so OSV filters + a local re-check of the `introduced ≤ version < fixed` range".

---

## 2. Track 2: Delivery Gates (Crowded, Mechanisms Already Productized)

This track is already productized. The following projects all do this, and they go deeper than "a configPath":

| Project | What it does |
|---|---|
| **`dsh-doublecheck`** (35★, dl=3120, updated 2026-09-18) | **Two native Cordis plugin lines**; `intensity: remind/warn/block` three-level enforcement; a **red/green test evidence gate** (listens on `edit`/`write` and `bash`/`pwsh` test commands, using regex to decide what counts as "having run the tests"); a requirements-interrogation gate; delivery report + per-dimension verification workflow |
| **`formalswarm`** (2★) | **"The verdict is computed from real exit codes and test-case counts, never from prose"**; a three-party structure (thesis / critics / seal); a missing check or an empty green is always `INCONCLUSIVE`, fail-closed; spans the three runtimes Claude Code / ZCode / DSH; ships `.claude-plugin/marketplace.json` |
| **`dsh-expert-team`** (1★, dl=2495) | "Quality gates are **enforced by plugin code rather than requested in prompts**: an unfinished task cannot be marked complete" |
| `loopx` (5893★) | A persisted state kernel of Goal / Todo / **gates** / evidence / quota |
| `review-gate` / `dsh-ocr-review` | Turns code review into a hard gate; merge is forbidden until it passes |
| `dsh-humanize` / `dsh-plan-lattice` / `dsh-punky-swarm` | Adjudication stage / HMAC final-review gate / engine-level quality gate |

**Significance**: `formalswarm` has already stated euthyna's core thesis in full — "an agent saying it is done does not count; the verdict must be recomputable from artifacts."
The only difference is that it is **not about security**, and `dsh-doublecheck` is equally **not about security**.

---

## 3. Track 3: Evidence-First Vulnerability Auditing (Taken, but a Different Shape)

**`dsh-omv`** (2★, MIT, `evidence-first vulnerability audit workbench`) is the closest neighbor at present:

- Five evidence-maturity states `unmapped / developing / supported / verified / contested`
- A finding ledger `candidate / confirmed / blocked / archived`
- `source → sink → guard` evidence-chain checks
- Deduplication, adversarial review, report-ready signals
- A **Docker-isolated PoC lab** (draft → explicit approval → `/output/result.json` → artifact hashes)
- A versioned HTTP contract `contracts/dsh-omv-api.v2.json`

**But it has two hard boundaries**:

1. **The form factor is a heavyweight UI workbench**: 52 `.ts` files + 6 `.tsx` files + a React client + SSE + 29 tools + 19 commands.
2. **It does no code measurement**: the engine is the external npm package `oh-my-vul`, and persistence is governed by `.omv` files and the `oh-my-vul` schema. No call graph, no coverage, no git history.

---

## 4. The Direct Competitor Skill Pack: Missing Exactly the Adjudication Link

The 8 skills of `dsh-skill-pack-security` (13★, Apache-2.0), from the actual repository file tree:

```
secret-scan · dependency-audit · supply-chain-review · prompt-injection-review
security-audit · threat-model · vuln-intel · incident-response
```

**No commands, no agents, no hooks.** The 5 stages of the main skill `security-audit` are:
fix the audit target → scoping → asset inventory → risk ranking → item-by-item verification → report.

Its discipline is **"the reviewer must be able to re-check every finding in the report with a single command"**,
and it states explicitly **"the re-check command gets no evidence → downgrade to an 'observation' or delete"**.

**This means**: "downgrade to an observation when no evidence can be produced" — the thing euthyna treats as its differentiator — **the competitor already has**.
At its core it is a **tool orchestrator + report format** (gitleaks / trivy / checkov / pnpm audit).

**What it lacks** (checked item by item against the original text of the three Trail of Bits plugins,
fetched into `.refs/trail-of-bits/` with `node tools/fetch-references.js trail-of-bits`):

| Mechanism in fp-check / differential-review | Does the competitor have it |
|---|---|
| Data-flow tracing, trust boundaries, source→sink | ❌ absent throughout the text |
| Exploitability adjudication (attacker control, reachability proof) | ❌ |
| 6 gates (process/reachability/real impact/PoC/mathematical bounds/environment) | ❌ |
| The 13-item false-positive checklist | ❌ |
| The 13 devil's-advocate questions (including 2 guarding against misses) | ❌ |
| **Default-assumption inversion** for 9 defect classes | ❌ |
| The primary-control vs defense-in-depth dichotomy | ❌ |
| PoC requirements (including Negative PoC; a hand-crafted bypass voids it) | ❌ (`dsh-omv` has a PoC lab) |
| Mathematical bound proofs | ❌ |
| The 7-stage change surface + blast radius + security regression | ❌ (only blast radius is covered by another plugin) |

---

## 5. Confirmed Gaps (Eight Items, Each with an Evidence Base)

1. **No join for "symbol × real-execution coverage".** `dsh-blast-radius` uses test **references**; `dsh-code-coverage` is file-level with no call graph. Evidence: the limitations self-described in the two READMEs.
2. **No git-history regression analysis.** A full-text search of the eight READMEs for `git log -S` / blame / reintroduce / 重加 returns not a single hit. `dsh-tool-lens`'s `diff_impact` only does working-tree / commit-range diffs.
   → See §6 (independent verification).
3. **No exploitability / reachability adjudication.** Searching the eight READMEs for taint / data flow / reachability: 0 hits. `dsh-code-security` states explicitly that "findings contain only objective evidence and a CWE number, with no fix advice attached".
4. **No shared fact schema.** Eight mutually incompatible shapes.
5. **No process exit-code / CI return contract.** Searching `exit code|exitCode`: 0 hits.
6. **No cross-repository aggregation.**
7. **No portable suppression/baseline interchange format.** Three mutually incompatible baselines (`secure_baseline` / `.dsh/gate-baseline.json` / blast-radius `records`).
8. **No single plugin covers "callers ∧ tests ∧ dependencies ∧ secrets" all at once**, and no artifact ties them together.

---

## 6. Independent Verification of Git-History Regression Analysis: **The Hypothesis Was Refuted**

The refutation search for this hypothesis found direct counterexamples.

### 6.1 Direct Evidence

Line 14 of `commands/diff-audit.md` in `solanabr/auditor-skill` (54★, MIT, a Claude Code plugin):

> Risk-classify changed files (auth / crypto / value-transfer / **validation-removal = HIGH**).
> **Git-blame removed security code — code deleted in a "fix" / "CVE" commit is a CRITICAL regression.**

That single sentence covers two of the hypothesis's items: (a) blaming already-deleted code and (c) verifying removed markers.
Its `/auditor:re-audit` also has a **REGRESSED** state (a previously fixed issue has come back).
Its `ATTRIBUTION.md` self-identifies its source as Trail of Bits' `differential-review` → "Mode 4 — Differential Audit".

The second independent occupant of this ground: `plugins/appsec/skills/regression` in `florianbuetow/claude-code`,
whose skill purpose reads verbatim "check for **reintroduced vulnerabilities**", with `REGRESSION` defined as
"the fix was reverted, removed, or bypassed". But what it reads is its own ledger,
`.appsec/fixed-history.json` — **it does not read git** (searching that repository for `git log`/`git blame`/`git show` returns 0 hits).

### 6.2 But the Refutation Refutes Only Half, and the Remaining Half Is What Matters

**Both occupants are model instructions in Markdown, not deterministic engines.**

Of the 270 files in the `auditor-skill` repository, only **6 are `.sh` (14 KB combined)**; everything else is
Markdown checklists / agents / commands. Its `allowed-tools` is
`Read, Grep, Glob, Bash, Task` — that is, **the LLM is left to run `git blame` itself and then read the commit messages to judge**.
No script produces structured facts, no mechanical adjudication via `git log -S`, no reproducible adjudication criterion.

**This is precisely the territory of the "supply the deterministic facts an agent cannot compute" layer, and it survived the refutation above intact.**

### 6.3 The DSH-Side Sub-Hypothesis Still Holds

Across all 3931 DSH plugins, the term frequencies of every one of these are **0**:
`git blame` / `pickaxe` / `git log -S` / `reintroduc` / `重加` / `deleted code` /
`removed validation` / `removed check` / `security fix` / `churn` / `bisect`.

The only plugin doing line-level git history is `dsh-backstory`, and it blames **lines that survived** (explaining "why is this line here"),
with zero security framing and no involvement with deleted code.

(Noise comparison: `历史` 165 / `history` 129 / `provenance` 14 / `溯源` 16 / `regression` 11 / `回归` 8.
The Chinese word `回归` means both regression and **statistical regression** — `Stata-AI-Skill` is a perfect example of a false hit;
the largest noise source is `provenance`/`溯源`, which in about 16 memory-type plugins refers to **the origin of a memory**, not the origin of a code line.)

### 6.4 One Item Not Fully Tested (Not Stated as a Conclusion)

**Untested**: PowerShell treats a query containing `-S` as a command-line switch
(`unknown shorthand flag: 'S'`), so the query `"git log -S" security` **never actually ran**.
Whether "(b) detecting re-added code with pickaxe" is done by no one therefore **remains untested, not proven**.

> Switching to a URL-encoded query through `gh api` gets around PowerShell parsing: `"git log -S" vulnerability`
> returns 1080 results, the top ranks are all security-advisory-type skills and `AGENTS.md`, **not one hits pickaxe re-add detection**.
> This is still weak evidence (GitHub code search tokenizes, and phrase matching is not strict); settling it would take a narrower query.

---

## 7. Implications for euthyna

### 7.1 Three Claims to Abandon

| Original claim | Why it is abandoned |
|---|---|
| "Deterministic measurement is an ecosystem gap" | 8+ dedicated tools already exist, each covering one slice |
| "Evidence gates / no-calling-it-done is a gap" | `dsh-doublecheck`, `formalswarm`, `dsh-expert-team`, `loopx` already do it, with mechanisms deeper than expected |
| "No one does git-history security regression" | Already occupied by `auditor-skill` and `florianbuetow/claude-code` — **but at the prompt layer, not the deterministic-engine layer** |

### 7.2 The Claims That Hold

> **Wire the deterministic facts that already exist into a security-specific discipline for adjudicating conclusions, and make the adjudication result the delivery gate.**

Broken into three verifiable actions:

1. **Do not rebuild measurement.** Callers / coverage / dependencies / secrets all have existing tools. euthyna defines a **fact contract** that normalizes their outputs into one shape (exactly gaps #4 and #5).
2. **Add the two deterministic measurements that truly no one does**:
   - **Mechanical adjudication of git security regressions** — not "have the model run blame", but producing structured facts such as
     "this deleted line of code comes from commit X, whose message matches `fix|security|CVE`"
     or "this added code re-adds the pattern removed in commit Y".
   - **The join of "symbol × real-execution coverage"** (see §5, gap #1).
3. **The adjudication layer is the core asset**: turn fp-check's 6 gates / 13-item checklist / 13 devil's-advocate questions / 9 classes of default assumptions
   into an adjudication process that **consumes the fact contract**, and use the verified enforcement mechanism
   (`exit 2` + stderr, see `docs/dsh-stop-gate.md`) to block failing deliveries.

### 7.3 The Differentiation in One Sentence

`dsh-doublecheck` handles **general engineering discipline**, `dsh-skill-pack-security` handles **tool orchestration and report formats**,
`dsh-omv` handles **the finding lifecycle and the PoC lab**, and `auditor-skill` handles **prompt-layer methodology**.

**No one handles "does this security conclusion actually hold", and no one turns measurement results into facts a machine can adjudicate.**
That is euthyna's position.

### 7.4 The Methodological Lesson

**"No one does X" must be written as "no one does X — and which layer of X no one does."**
All three hypotheses were refuted in exactly the same way: mistaking **prompt-layer methodology** for a **deterministic engine**,
or looking only at the DSH ecosystem (3931 plugins) and extrapolating to the Claude Code / Codex ecosystems.
