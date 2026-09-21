# Fact Contract v0.1

English · [中文](fact-contract-zh.md)

> This is euthyna's **core asset**: it defines what exactly the "measurement layer" hands over to the "adjudication layer".
> The positioning analysis concluded that euthyna does not rebuild measurement; it must therefore define the **interface** — and this document is that interface.
>
> Status: **design draft, not yet validated by a real run**. Fields will be revised after the first real run in quick mode.

---

## 0. Why this contract is needed

### 0.1 The problem

The positioning analysis (`docs/positioning.md`) found eight measurement tools, each measuring a different slice, with **eight mutually incompatible output shapes** — and **not one of them has a process exit-code contract**. This means:

- The adjudication layer (fp-check's scheme of 6 gates / 13 false-positive checklist items) **has no way to consume** their output
- The same question ("how many callers does this symbol have") goes by different field names with different semantics in different tools
- Most dangerous of all: **"not measured" and "measured, and clean" look identical**

### 0.2 Three design principles

| Principle | Meaning | Anti-pattern |
|---|---|---|
| **P1 Facts and judgments are separated** | Only facts run inside the contract. `a check exists at line 98` is a fact; `the underflow is therefore impossible` is a judgment and does not enter the contract | Letting a tool emit `risk: high` directly |
| **P2 Three states enforced** | Every fact must be able to say "I don't know". **Missing data is never the same as clean** | Reporting `PASS` because a scan found no hit |
| **P3 Recomputable** | Every fact must carry **the command that reproduces it** or **the tool + version that produced it**. A third party holding the record can recompute the conclusion independently | Giving just the phrase "it was checked" |

### 0.3 Two borrowed lessons

- **From `dsh-trust-check`**: it narrows the gate surface down to **5 fields** and **says explicitly "do not use `score` or `band` as gates"**;
  a non-empty `errors` is treated as **a scan failure**, never `clear`.
  ⇒ **We likewise publish no scores; gates consume only verifiable fields.**
- **From `formalswarm`**: its verdict can be **independently recomputed** by the reader from `outcome.json`, without trusting any prose.
  ⇒ **The contract must be self-sufficient: the verdict must be reproducible from the record alone.**

---

## 1. The four parts of the contract

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  Subject    │ →  │    Facts     │ →  │   Coverage   │ →  │  Verdict   │
│ 被审对象    │    │  确定性事实   │    │  测了什么/   │    │  判定结果   │
│ + 断言      │    │              │    │  没测什么     │    │            │
└─────────────┘    └──────────────┘    └──────────────┘    └────────────┘
```

**The data flow is one-directional**: the measurement layer writes only `Subject` / `Facts` / `Coverage`;
the adjudication layer writes only `Verdict`. The adjudication layer is **not allowed to back-fill facts** (to prevent "conclusion first, evidence fitted to match").

---

## 2. Subject — the object under audit and its claim

```jsonc
{
  "schemaVersion": "0.1",
  "subject": {
    "id": "F-001",
    "claim": "packet_handler 的整数下溢可被远程未认证用户触发",
    "location": {
      "file": "src/net/packet_handler.c",
      "line": 142,
      "symbol": "handle_packet",
      "commit": "a1b2c3d"        // 可选：被审版本
    },
    "bugClass": "integer",        // 9 类之一，见 methodology §3
    "scope": {
      "repo": "D:/repo/example",
      "baselineCommit": "f703c92" // 变更面审计的基线
    }
  }
}
```

**`claim` must be a single sentence that can be judged true or false.** This is the machine-readable form of Step 0, "restate the claim" —
the methodology document says "half of the false positives collapse at this step", so what this step produces has to land in the contract.

**`bugClass` determines the direction of the default assumption** (methodology M7):
memory-corruption classes default to "almost always a false positive"; logic-defect classes default to "do not let a clean static analysis convince you it is a false positive".

---

## 3. Facts — deterministic facts

### 3.1 The shape of a single fact

```jsonc
{
  "id": "fact-007",
  "kind": "guard",                    // 见 3.2 枚举
  "statement": "第 98 行校验 packet_size >= 16",   // 人可读，一句话
  "status": "established",            // established | refuted | unknown
  "evidence": {
    "file": "src/net/packet_handler.c",
    "line": 98,
    "snippet": "if (packet_size < MIN_PACKET_SIZE) return -1;"
  },
  "method": "static",                 // static | command | tool
  "command": "git grep -n 'MIN_PACKET_SIZE' a1b2c3d -- src/net/",  // method=command 时必填
  "producer": { "name": "euthyna-history", "version": "0.1.0" },   // method=tool 时必填
  "confidence": "exact"               // exact | approximate —— approximate 不得用于门禁
}
```

**Three fields are hard requirements — not one of them may be missing**:

- `status` — three states. `unknown` is a legal value and **must be respected**
- `evidence.file` + `evidence.line` — evidence is mandatory down to `file:line` (methodology M5)
- `method` + (`command` or `producer`) — recomputability (P3)

**Facts with `confidence: approximate` must not take part in gate adjudication.**
This is taken directly from `dsh-blast-radius`: its `approximate` marker (a synthesized scope when no tsconfig is present)
**does not participate in blocking even when `enforce: true`**.

### 3.2 The fact-category enumeration (`kind`)

Organized by which step of the adjudication layer consumes each one:

| kind | Fact content | Produced by | What the adjudication layer does with it |
|---|---|---|---|
| `location` | The location of the audited code and its symbol containment | Engine | Locating |
| `flow` | The `source → sink` chain, with a location for each hop | Engine / data-flow tools | Gate 2 (reachability), checklist 1/3 |
| `guard` | The checks/sanitization on the path, and their **nature** | Engine | Gate 5 (math bounds), checklist 1/2/5 |
| `reachability` | Whether a path exists from the entry point to this location | Call-graph tools | Gate 2 |
| `trust_boundary` | The trust boundary crossed at this location (internal trusted / external untrusted) | Engine | Checklist 4/8 |
| `attacker_control` | Whether the data is attacker-controlled | Back-fill by the adjudication layer is **forbidden**; the engine supplies the raw source | Gate 2, checklist 3 |
| `callers` | The list of call sites (production / test separated) | `dsh-blast-radius` / `dsh-tool-lens` | Blast radius |
| `test_coverage` | **Whether tests actually executed the callers of the changed symbol** | **Built in-house by euthyna** (see §6) | Gate 1, risk escalation |
| `history` | The origin commit of deleted code + its nature | **Built in-house by euthyna** (see §6) | Gate 1, red flags |
| `reintroduction` | Whether this pattern was ever removed and then added back | **Built in-house by euthyna** | Red flag REGRESSION |
| `dependency` | Dependency vulnerabilities (including confirmation criteria) | `dsh-dep-vuln-scan`-class tools | Independent finding source |
| `secret` | Exposed secrets/credentials | `dsh-code-security`-class tools | Independent finding source |
| `artifact` | Report/PoC artifacts: paths, exit codes, case counts | Gate scripts | Gates 1/4 |
| `environment` | Environmental protections, **distinguishing "prevents entirely" from "merely raises the bar"** | Engine | Gate 6 |

> ⚠️ Both `guard` and `environment` require a **binary field**:
> `{"effect": "prevents_entirely" | "raises_bar"}`.
> This is the core of methodology M6, and the thing an LLM most easily conflates —
> the contract must enforce the distinction in the data structure, not rely on a prompt to remember it.
> No existing tool produces this field (all eight measurement tools look only at "whether one exists", never at "how much it actually prevents").

### 3.3 ⛔ What must **not** appear in the contract

| Must not appear | Why |
|---|---|
| Any score (`score` / `risk: high` / 0–100) | Scores cannot be recomputed and turn into "using the score as a gate"; `dsh-trust-check` has warned about this explicitly |
| Severity levels | Severity is a **judgment**, not a fact. Putting it in Facts amounts to letting the measurement layer draw conclusions on behalf of the adjudication layer |
| Fix suggestions | Same as above |
| "Suggests" / "possibly" / "most likely" | The contract is the fact layer; vague words only mask what is missing (methodology M5 explicitly bans `probably` / `likely`) |

---

## 4. Coverage — honestly marking the coverage boundary

This is where P2 lands, and it is the key to **guarding against false negatives**.

```jsonc
{
  "coverage": {
    "evaluated": [
      { "kind": "guard", "producer": "euthyna-static", "count": 3 },
      { "kind": "callers", "producer": "dsh-blast-radius", "count": 12 }
    ],
    "notEvaluated": [
      { "kind": "test_coverage",
        "reason": "c8 未运行：项目无测试命令，profile 探测失败" },
      { "kind": "reachability",
        "reason": "动态调用无法解析：目标语言使用反射" }
    ]
  }
}
```

**Hard rules**:

1. **While `notEvaluated` is non-empty, no gate may conclude `pass`** — only `not_evaluated` or `fail`.
   This is a direct port of `formalswarm`'s fail-closed behavior and of `dsh-trust-check`'s `errors` semantics.
2. **`notEvaluated` must carry a `reason`**, and the `reason` must be specific about **why** (not "a tool was unavailable",
   but "which tool, unavailable for what reason").
3. **Empty results must be explicitly distinguished**: "ran but found nothing" is recorded as `evaluated` + `count: 0`;
   "never ran at all" is recorded as `notEvaluated`. The two must never look the same in any report.

---

## 5. Verdict — the adjudication result

```jsonc
{
  "verdict": {
    "gates": [
      { "gate": "process",       "outcome": "pass",          "reason": "5 阶段均有证据", "evidenceRefs": ["fact-001","fact-004"] },
      { "gate": "reachability",  "outcome": "pass",          "reason": "入口点可达",     "evidenceRefs": ["fact-009"] },
      { "gate": "real_impact",   "outcome": "not_evaluated", "reason": "影响分类未完成" },
      { "gate": "poc",           "outcome": "fail",          "reason": "PoC 使用了 mock，判定无效", "evidenceRefs": ["fact-021"] },
      { "gate": "math_bounds",   "outcome": "pass",          "reason": "见代数证明",     "evidenceRefs": ["fact-007","fact-008"] },
      { "gate": "environment",   "outcome": "pass",          "reason": "无彻底阻止的防护", "evidenceRefs": ["fact-030"] }
    ],
    "disposition": "inconclusive",   // true_positive | false_positive | inconclusive
    "reason": "门禁 3 未评估、门禁 4 失败"
  }
}
```

**Adjudication rules** (hard-coded; no room for interpretation):

| Condition | disposition |
|---|---|
| **All** 6 gates `pass` | `true_positive` |
| Any gate `fail` | `false_positive` |
| No `fail`, but at least one `not_evaluated` | **`inconclusive`** ← must not be downgraded to `false_positive` |

The last row is the most important one. The fp-check text quoted in the methodology document says "a FALSE POSITIVE adjudication is issued only after all phases are complete" —
**`inconclusive` is a more honest exit than `false_positive`**, and the DSH ecosystem already has `formalswarm` proving
that this three-state exit is workable (`CONFIRM` / `REVISE` / `INCONCLUSIVE`).

> ⚠️ Difference from the fp-check original: the original has only two states (TRUE/FALSE POSITIVE),
> because its hook can force continuations indefinitely until everything has been filled in. On DSH this **cannot be done** (the Stop hook must rate-limit itself; see
> `docs/dsh-stop-gate.md`), so the honest exit `inconclusive` must exist.

---

## 6. The two kinds of facts euthyna itself must produce

Per the engine boundary already settled, only these two are built (everything else consumes existing tools):

### 6.1 `history` — the **mechanical** adjudication of git security regressions

**The question to answer**: is the code this change deleted a security fix?

```
输入：baselineCommit..headCommit 的 diff
产出：
  - 被删除的行 → git blame → 该行来自哪个提交
  - 该提交的 message 是否命中 fix|security|CVE|vuln（正则，可配置，命中即标注）
  - 该提交是否触碰过安全敏感路径（可配置）
输出 fact：
  { kind: "history", status: "established",
    statement: "第 142 行删除的校验由提交 abc123 引入，其 message 含 'CVE-2024-xxxx'",
    evidence: {file, line, commit: "abc123"},
    command: "git blame -L 142,142 f703c92 -- src/...",
    effect: "security_fix_removed" }     // ← 判定层据此直接触发 CRITICAL 红旗
```

**The difference from the existing placeholder**: `auditor-skill` has the LLM run `git blame` itself and then read the commit message itself to reach a judgment;
here it is **adjudicated mechanically, producing a structured fact** — the same diff run twice must give the same result.

### 6.2 `test_coverage` — the symbol × real-execution join

**The question to answer**: of the callers of the symbol I changed, which ones have **no test that actually executed them**?

This is the most indisputable gap in the positioning analysis (`dsh-blast-radius` holds the "test references" half,
`dsh-code-coverage` holds the "execution coverage" half, and nobody can piece the two together).

#### ✅ Feasibility verified (2026-09-19, including a real run)

**Verdict: feasible, but the design must change — this fact can by nature only falsify, never confirm.**

The single most important finding: **V8 coverage reports call sites that were never executed as "covered"**.
A subagent reproduced `nodejs/node#57435`:

```js
boom();                                    // 必然抛异常
return checkPermission(user, 'never');     // 从未执行，但 c8 报 hits=1
```

A naive implementation of "line covered ⇒ call executed" would report **the never-executed** as **executed** —
**wrong in exactly the direction a security audit can least afford to be wrong** (real gaps missed + a false sense of security).

Hence the hard constraints at the contract level:

| Status | Meaning | Inferences allowed |
|---|---|---|
| `not_executed` | **Proves** not executed | ✅ A conclusion may be drawn |
| `unknown` | Cannot be determined | ✅ The conservative exit |
| ~~`executed`~~ | ~~Proves executed~~ | ❌ **Designated an unreachable state; must not be emitted under any circumstances** |

**The adjudication layer may draw conclusions only from "a count of 0"; any non-zero count must never be escalated to "executed".**

#### Three-tier implementation (in ascending cost; Tier 0 first)

| Tier | Size | What it can produce | Reliability |
|---|---|---|---|
| **Tier 0** | **~40 lines** | The **call count** of the changed symbol (c8's `fnMap` + `f{}`). A count of 0 ⇒ **every caller lacks coverage** | Exact; zero AST, zero false positives |
| Tier 1 | ~300–500 lines | Call site `(file,line,col)` × the count of the innermost V8 block | Falsification reliable; confirmation impossible |
| Tier 2 | ~600–1200 lines | Targeted source-rewrite instrumentation ⇒ **the only road that can prove "executed"** | A separate project; high robustness cost |

**Build Tier 0 first.** It is zero-dependency and zero-false-positive, and on its own it produces the highest-signal fact —
"not one test ever touched the function you changed" — **and it needs no call graph at all**.

#### The measured c8 output shape (a consumer written against classic istanbul will break)

- The top-level key is the **absolute path** of the covered file
- The per-file key = `["path","all","statementMap","s","branchMap","b","fnMap","f"]`
  — ⚠️ **classic istanbul's `hash` is absent, and there is an extra `all`**
- `fnMap[i]` = `{name,decl,loc,line}`; **`f{}` is the real call count**
- `branchMap[i]` = `{type:"branch", line, loc, locations:[a single loc]}`
  — **not istanbul's if/else model**, but V8 block ranges under a different label (`v8-to-istanbul/lib/branch.js:21-27`),
  and it **carries complete start/end line and column**, so genuine range-containment checks are possible

#### Failure modes a consumer must handle

| Situation | Symptom | Requirement |
|---|---|---|
| The tests never loaded the code under test | Without `--all`, `coverage-final.json` is **an empty object `{}`** and caller files are **absent altogether** (not a count of 0) | **"Not found" must be treated as not covered** |
| c8's default exclude rules | `test/**`, `**/*.test.js`, `**/__tests__/**` are excluded | Production callers that fall under these globs **silently disappear** |
| Negative column numbers in V8 block ranges | `L9:-1-L10:0` seen in real testing | Naive column comparison breaks |
| Module top-level call sites | Present only in `branchMap` (`fnMap` filters out `functionName===""`) | You cannot query `fnMap` alone |
| A file that is not coverage data at all | Has neither `fnMap`/`f` (c8/istanbul) nor `functions` (coverage.py) | Report as *not evaluated* — feeding it to the locator would answer "symbol not located" with a straight face |
| A symbol that was renamed | Not in `fnMap` under the new name | `unknown`, **never** "established as never invoked" |

#### Other languages: worse than JS — do not extrapolate

| Language | Finest granularity | Can it falsify? |
|---|---|---|
| JS/TS (c8+V8) | Statements / V8 blocks | ✅ Yes (Tier 1) |
| Python (coverage.py) | Lines + arcs | ❌ Short circuits are completely invisible to it |
| **Go** | Basic blocks | ❌ **Worse than V8** — in testing, `return Strict && Check(...)` never called `Check`;
  Go does not even split the block, **so it cannot even falsify** |
| Rust (llvm region) | LLVM region | ⚠️ Partial |

#### Relation to prior art

- **The "callers × real execution" axis is genuinely empty**, and the reason it is empty is **technical difficulty** (the semantic gap above), not that nobody thought of it.
- **But the adjacent TIA ("which tests should run") space is already fully occupied**: Jest `--findRelatedTests` / `--onlyChanged`,
  Stryker `coverageAnalysis:"perTest"`, 400,000+ related packages on npm.
  ⇒ **Do not build "test selection"** — build only "prove that a given caller was never executed".
- `ast-v8-to-istanbul` (MIT, very light dependencies) is worth auditing at the source level before considering it as a replacement for c8's bundled `v8-to-istanbul`.

#### What is not yet verified (must not be treated as known)

The **line-number alignment between tsserver and c8 has had no integration verification** (call sites in the fixture were located with a regex; what was verified is the shape, not the integration);
**source-map remapping, bundled artifacts, monorepos, scale and performance are all untested**.

### 6.3 `dependency` — the lockfile as the ground truth for supply-chain claims

**The question to answer**: what version is this dependency *actually* pinned to — or is it in the tree at all?

This is the fact that turns a supply-chain claim ("the app uses a vulnerable version of X") from INCONCLUSIVE
into adjudicable. A model guesses at the version from `package.json` ranges; the lockfile is the deterministic
record of what is actually resolved.

**Scope (Tier 0)** — three formats, all parseable with zero dependencies:

| Format | What is reported | Honesty constraint |
|---|---|---|
| `package-lock.json` (npm v1/v2/v3) | Resolved pinned versions (incl. nested/scoped) | Absence from a well-formed lockfile is an **established "not in the tree"** fact, never a silent skip |
| `Cargo.lock` (Rust) | Resolved pinned versions per `[[package]]` | Same |
| `go.mod` (Go) | The **declared requirement** version | go.sum carries hashes, not versions — the resolved build version cannot be verified here, so this producer says **"declared"**, never "locked" |

Anything else detected at auto-detect (`pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, …) is reported as
*not evaluated* with the filenames named — never guessed at.

**What it refuses to say is as important as what it says.** It emits versions, and nothing else:
no "vulnerable", no severity, no CVE mapping. The version-to-CVE mapping is the adjudication layer's job
(the `assertNoVerdictFields` guard enforces this mechanically). A producer that emitted "version 4.17.21 is
affected by CVE-XXXX" would have decided for the adjudicator, and the decision would not be recomputable.

**Not-yet-verified** (must not be treated as known): pnpm/yarn/poetry parsing, go resolved-version verification,
SBOM/audit-tool ingestion, and large-monorepo scale.

---

## 7. Open questions (must be answered in the next round)

1. **The concrete form of the trigger**: a JSON file? A session event? A tool return value? — all three have precedent on DSH.
2. **Who writes `Verdict`**: is the adjudication layer a SKILL.md (written by the model) or a plugin (written in code)?
   Written by the model → flexible but not recomputable; written in code → recomputable but limited in expressiveness.
   *Leaning*: Facts are written by the engine, `Verdict` is written by the adjudication layer but **with its format constrained by a schema**, and both are recomputable.
3. **Who owns `attacker_control`**: it is an adjudication ("can the attacker control it"), but Gate 2 needs it.
   The current design is that the engine supplies the **raw source facts** (what the `source` is, which boundaries it crosses), and the adjudication layer draws the conclusion.
4. **How the default assumptions for the 9 bug classes enter the contract**: a `bugClass` field plus a lookup table in the adjudication layer, or some other mechanism?
5. **Fact granularity**: one sentence per fact, or may one fact carry sub-facts? The current design is "one sentence";
   a real run may reveal that this is too fine-grained.

---

## 8. How this contract relates to the existing ecosystem

| Item in the ecosystem | Relationship |
|---|---|
| `dsh-trust-check`'s `audit-schema.md` | **The same kind of thing**, but its object is "the capabilities of DSH plugins" while ours is "code security conclusions". Both of its lessons have been borrowed (narrow the gate surface; no scores as gates) |
| `dsh-omv`'s `contracts/*.json` | Its contracts describe **HTTP API requests/responses** (`action` / `finding.*` / `campaign.*`), not facts themselves. **No overlap, but they can coexist**: `dsh-omv` can become a consumer of Facts |
| SARIF | SARIF describes **findings**, not **facts**. Facts can be rendered as SARIF output, but the contract itself sits below SARIF |
| `dsh-blast-radius`'s `BlastRadius` | It can act directly as the producer of `callers`; an adapter layer is needed to map it onto this contract |
| `dsh-dep-vuln-scan`'s output | Same as above, mapped to `dependency` |

**Conclusion**: this contract is an **adapter layer**, not a replacement. It requires no existing tool to change itself —
euthyna is responsible for translating their output into unified facts. This is also exactly how "gap #4 (no shared schema)" identified in the positioning analysis gets filled.
