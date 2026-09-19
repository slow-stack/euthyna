# Case Study: A Validation Run of euthyna on axe-core (2026-09-19)

English · [中文](case-study-axe-core-zh.md)

> **What this document is**: it records a **method-validation run** of euthyna — running euthyna's
> adjudication gates against a real public codebase to see whether they still hold up on code that
> has a real history, real tests, and a real maintenance process. axe-core was the **subject under
> test** for this run, not a project anyone commissioned euthyna to audit.
>
> **Conclusion first**: this run **found no vulnerabilities** (0 true positives). All 5 candidates
> surfaced by the coarse screen were refuted at the gates, each by a different gate, and every
> refutation comes with reproducible evidence. The value of this document lies in those refutations
> themselves.
>
> **This is not an evaluation of axe-core**: this report is not an endorsement of axe-core's
> security posture — it shows neither that it is more secure nor that it is less secure. 0 true
> positives is only the result of this **one** run under a **limited scope**; the criteria not
> evaluated are listed in Section 1.

**Audit mode**: quick (limited scope, for measuring the **false positive rate**)
**Target repository**: axe-core (upstream `dequelabs/axe-core`)
**Baseline commit**: `397f5fceb4ea759f26c57a852b0f3a0e8297b271` (2026-09-19T11:39:40+08:00)
**Branch**: `fix/link-in-text-block-message`
**Stages executed**: C (conclusion-surface validation, the main body) + B (change surface, limited to the current branch diff)
**Where the report was written**: the report lives inside the euthyna repository and was **not written into the repository under test** — writing into the target repository's working tree would make the report file show up in its `git status`, with the risk of an accidental commit. This is a **deliberate deviation** from the skill's default of "write to the target cwd".

---

## 0. Executive summary

| Metric | Value |
|---|---|
| Coarse-screen candidates | 5 (high-risk patterns occurring in the **shipped code**, `lib/`) |
| True positives (TRUE POSITIVE) | **0** |
| False positives (FALSE POSITIVE) | **5** |
| Inconclusive (INCONCLUSIVE) | 0 |
| Non-security observations | 2 |
| **False positive rate of this coarse screen** | **5/5 = 100%** |

**Conclusion**: on this one target, **100% of the candidates produced by pattern coarse-screening without discipline were false positives**.
The five candidates each died at a different gate, and every one has reproducible evidence —

This is a quantified sample of exactly the problem euthyna exists to solve: **the gap between "looks dangerous" and "is a vulnerability" is 100%.**

Stage B (the current branch's changes) **found no security issues**: the changes are purely additive, no validation was deleted, the blast radius is fully enumerable, and the generated artifacts are in sync.

---

## 1. Coverage table (what was not tested comes first)

Per euthyna Rule 3, "missing data ≠ clean", the criteria this run did **not** evaluate are declared first:

| Criterion | Status | Reason |
|---|---|---|
| Data flow / taint tracking (automated) | ❌ Not evaluated | No taint tool; this run traced by hand |
| Call graph / blast radius (quantified) | ⚠️ Partial | Manual enumeration was done only for `isInTextBlock`, which the change touches; no repo-wide call graph |
| Test coverage mapping | ❌ Not evaluated | c8 was not run; cannot assert "whether this code is covered by tests" |
| Dependency vulnerabilities | ❌ Not evaluated | No OSV query was run |
| Secret scanning | ⚠️ Partial | Regex coarse screen only (0 hits); **0 hits does not mean no secrets** |
| Git history security regressions | ❌ Not evaluated | The capability is not yet implemented (see `docs/fact-contract.md` §6.1) |
| Build/CI configuration audit | ❌ Not evaluated | Outside the quick tier's scope |
| Unpublished artifacts (`axe.js` bundle) | ❌ Not evaluated | Only the source `lib/` was audited; the build artifacts were not |

**This report therefore cannot serve as an endorsement that "axe-core has no security issues".** It says only: **under the scope and criteria this run limited itself to, no true positives were found.**

---

## 2. Coarse-screening method and candidate sources

A **scanner without discipline** was simulated: classic high-risk pattern regex matching over the shipped source `lib/`.

```
git grep -nE '<pattern>' -- 'lib/**'
```

| Pattern | Hits repo-wide | **Shipped code `lib/` only** |
|---|---|---|
| `innerHTML` | 1710 hits / 226 files | **2** |
| `outerHTML` | 42 hits / 22 files | **7** |
| `insertAdjacentHTML` | 2 | 0 |
| `eval(` | 5 | 0 |
| `new Function` | 2 | **2** |
| `document.write` | 1 | 0 |
| `child_process` | 8 | 0 |
| `postMessage` | 32 hits / 10 files | **12** |
| Hardcoded secrets (with entropy check) | 0 | 0 |

> **First quantified finding**: `innerHTML` hits 226 files repo-wide, **227 of the hits in `test/`**, only **2** in the shipped source. An unscoped scanner on this repository would produce roughly **99% pure noise**. This "test fixture vs shipped code" distinction is itself the single largest source of the false positive rate.

---

## 3. Adjudication details

### BUG #1 FALSE POSITIVE — `new Function` at `lib/core/base/check.js:14`

**Candidate claim**: `createExecutionContext` compiles a string into a function with `new Function('return ' + spec + ';')()`, constituting code injection.

**Gate 2 (reachability) FAIL: no trust boundary is crossed.**

Data-flow trace results:

| Step | Fact |
|---|---|
| source | The parameter `spec`, from `spec[prop]` of `Check.prototype.configure` (`check.js:203`) |
| Validation 1 | `check.js:8` — if `metadataFunctionMap[spec]` exists, the mapped function is returned; **the eval is never reached** |
| Validation 2 | `check.js:13` — regex `/^\s*function[\s\w]*\(/`; **the string must start with `function`** |
| Validation 3 | `check.js:17` — if the regex does not match, `throw ReferenceError` |
| Validation 4 | The wrapper form `'return ' + spec + ';'` — the `return` prefix makes any code after the function expression **unreachable** |
| sink | `new Function(...)()` returns a **function object**, assigned to `this.evaluate` / `this.after` |

**The only dynamic entry point**: `lib/core/public/configure.js:61` → `audit.addCheck(check)` → `new Check(spec)`.
That is, **the only path that can feed a string in is the public API `axe.configure`**.

Threat model: any code that can call `axe.configure({checks:[...]})` **is already executing arbitrary JavaScript in the page**. The API crosses no privilege boundary — the attacker does not need to "inject"; they already have the ability to execute.

**Gate 3 (real impact) FAIL**: no RCE, no privilege escalation, no information disclosure. The caller and the callee have the same privileges, in the same context.

Supporting evidence for the adjudication: the source carries its own `/*eslint no-eval:0 */` (`check.js:6`) and `/*eslint no-eval: 0 */` (`audit.js:239`), showing that this is **an established design the authors were aware of**, not an oversight.

---

### BUG #2 FALSE POSITIVE — `new Function` at `lib/core/base/audit.js:254`

**Candidate claim**: same as above; message template strings compiled into functions.

**Gate 2 (reachability) FAIL + Gate 3 (real impact) FAIL**, for the same reasons as #1.

Supplementary facts:

| Step | Fact |
|---|---|
| source | `metadata.messages[prop]`, from `spec.metadata` of `addCheck(spec)` |
| Validation | `audit.js:253` `if (metadata.messages[prop].indexOf('function') === 0)` — must **start with** `function` |
| Wrapper | `'return ' + ... + ';'` — the same `return`-prefix protection as #1 |
| Entry point | Same as #1: `axe.configure` |

---

### BUG #3 FALSE POSITIVE — the `innerHTML` assignment at `lib/core/utils/pollyfill-elements-from-point.js:16`

**Candidate claim**: `style.innerHTML = ...` constitutes XSS.

**Gate 2 (reachability) FAIL: no attacker-controlled data exists at the sink.**

**This is the textbook case of item 9 of the false-positive checklist ("do not treat pattern recognition as vulnerability analysis") and item 5.**

The actual code:

```js
style.innerHTML = usePointer
  ? '* { pointer-events: all }'
  : '* { visibility: visible }';
```

What is assigned to `innerHTML` is **one of two literal constants**, selected by the ternary on the boolean `usePointer`. `usePointer` comes from a capability probe on lines 6–10 of the same file (`element.style.pointerEvents === 'auto'`).

**Nothing on the entire chain is external input**: no arguments, no DOM attributes, no location/URL, no postMessage. Attacker-controlled data cannot appear at the sink.

---

### BUG #4 FALSE POSITIVE — the `innerHTML` read at `lib/core/utils/valid-langs.js:10`

**Candidate claim**: the `document.querySelector('pre').innerHTML` read constitutes injection/XSS.

**Gate 2 FAIL: the line sits inside a block comment — commented-out explanatory text that never executes at runtime.**

A script pinned down the comment boundaries precisely (not by eye):

```
块注释起始：第 1 行
块注释结束：第 50 行
第 10 行内容："const str = document.querySelector('pre').innerHTML;\r"
第 10 行在注释内？ true
```

The context (lines 1–8) shows this is **a regeneration note aimed at maintainers**: "If we need to edit the list of langs, use the code below on the page https://www.iana.org/...".

**This is the most persuasive false positive sample of the run**: pure text pattern matching cannot tell "code" from "prose describing code inside a comment", yet to any regex scanner the two look exactly alike.

---

### BUG #5 FALSE POSITIVE — cross-frame `postMessage` without origin validation in `lib/core/utils/frame-messenger/`

**Candidate claim**: 12 `postMessage` sites with no origin validation, constituting cross-origin message injection.

**Gate 2 FAIL: origin validation exists — it is just not at the call sites; it is at the message-handling entry point.**

This is exactly the trap that items **1 (trace the complete validation chain) and 1a (map the complete conditional logic flow)** of the false-positive checklist exist to catch — **analyzing the code in isolation**.

| Fact | Location |
|---|---|
| Inbound messages **do have** origin validation | `message-handler.js:30` `if (!originIsAllowed(origin) \|\| !isNewMessage(messageId)) return;` |
| The validation implementation | `message-handler.js:8-15` `originIsAllowed()` |
| Outbound targets are restricted | `post-message.js:32-34` — with no `allowedOrigins`, it **returns false outright and sends no message** |
| Additional window assertions | `post-message.js:19`, `message-handler.js:43/64` — `assertIsParentWindow` / `assertIsFrameWindow` |

**Further tracing of the `allowedOrigins.includes('*')` wildcard** (`message-handler.js:12`):

- It is not an implicit default; it is parsed from configuration by `setAllowedOrigins` in `audit.js:168-181`
- What triggers it is a **self-describing literal, `<unsafe_all_origins>`**
- `doc/API.md:280` warns explicitly:
  > use `<unsafe_all_origins>`. **This is not recommended**.
  > Because this is the only way to test iframes on `file://`, it is recommended to use a
  > localhost server such as http-server instead.

In other words: **a documented opt-in escape hatch, with a warning in its name, a suggested alternative, and explicit per-frame enabling by the integrator.**

Under Gate 6's classification, this falls under "known to the authors, with the elevated risk documented"; it does not constitute a defect.

---

## 4. Stage B: current branch changes (`fix/link-in-text-block-message`)

Size: 9 files / +117 −17, which falls in the DEEP tier (< 20 files). Only the shipped-code portion (5 files) was actually audited.

### Nature of the changes

| File | Change |
|---|---|
| `lib/commons/dom/is-in-text-block.js` | New `returnLengths` option: when true, returns `{parentTextLength, widgetTextLength}` instead of a boolean |
| `lib/checks/color/link-in-text-block-evaluate.js` | One extra call to fetch the lengths, placed into `this.data(...)` |
| `lib/checks/color/link-in-text-block-style-evaluate.js` | Same |
| `lib/checks/color/*.json` | Both fail messages gain an explanatory sentence interpolating the two lengths |
| `locales/_template.json` | Regenerated in sync |

### Phase 1 red-flag check (item by item)

| Red flag | Result |
|---|---|
| Code deleted from `fix`/`security`/`CVE` commits | ❌ No deletions; purely additive |
| Access-control modifiers removed | ❌ None |
| Validation deleted without replacement | ❌ No. The `noLengthCompare` branch logic is preserved (a new `&& !returnLengths` condition was added, with no effect on existing callers) |
| New external calls without checks | ❌ No new external calls |
| High blast radius + HIGH-risk change | ❌ The blast radius is 4 call sites, all enumerated below |

### Phase 3 blast radius (complete enumeration)

| Caller | Arguments passed | Affected? |
|---|---|---|
| `lib/rules/link-in-text-block-matches.js:19` | `isInTextBlock(node)` | ❌ Boolean return; the path is unchanged |
| `lib/rules/widget-not-inline-matches.js:18` | `{noLengthCompare:true, includeInlineBlock:true}` | ❌ Does not pass `returnLengths`; takes the original branch |
| `link-in-text-block-evaluate.js:94` | `{returnLengths:true}` | ✅ Added in this change |
| `link-in-text-block-style-evaluate.js:38` | `{returnLengths:true}` | ✅ Added in this change |

**`returnLengths` is a new option and no caller depends on its old behavior** ⇒ the risk of a breaking change is zero.

### Phase 2 test coverage

- `test/commons/dom/is-in-text-block.js` adds assertions for `returnLengths: true` (including a deepEqual comparison of the returned value)
- **and it covers the option combination `{noLengthCompare: true, returnLengths: true}`** (line 452 of the test file) — exactly the interaction point that reading the implementation would flag as "needs confirmation", and it is covered by tests
- The tests for the two evaluate functions and the message-text tests were updated in sync

### Artifact consistency (a hard requirement of the axe-core repository)

The repository requires that "any change to message text must regenerate `locales/_template.json` in the same commit". Verification result: **in sync** — the three message strings of `locales/_template.json` in the diff are verbatim identical to the new JSON.

### Stage B adjudication

**No security issues found.** The changes are purely additive within an enumerable range: no guards removed, no new attack surface, artifacts in sync, and the change is covered by tests.

---

## 5. Non-security observations (**not findings**)

Per discipline, the following do **not count as findings**; they are recorded only.

### Observation 1: the message text contradicts itself in the "block element" branch

The early-return branch of `is-in-text-block.js` returns `{parentTextLength: 0, widgetTextLength: 0}` when `returnLengths: true`. The new message text reads:

> The rule applies because the link is surrounded by **${data.parentTextLength}** characters of text,
> which is more than the link's own **${data.widgetTextLength}** characters.

When both values are 0, the message outputs "surrounded by 0 characters, which is more than ... 0 characters" — **0 is not greater than 0** — so the text contradicts the facts.

- **Nature**: message accuracy / user-experience issue
- **Why it is not a security finding**: Gate 3 (real impact) requires RCE / privilege escalation / information disclosure. Message wording affects none of them.
- **Trigger condition unverified**: it was not confirmed whether the new call sites can actually reach that early-return branch — **not verified**.
- **Recommendation**: leave it to the rule's maintainers to decide whether the message text needs a conditional branch.

### Observation 2: `isInTextBlock` is called twice within a single evaluation

The calls added by the two evaluate functions happen after the rule's `matches` has already called `isInTextBlock` — that is, the DOM text is traversed twice within the same element evaluation.

- **Nature**: performance
- **Why it is not a security finding**: the complexity class is unchanged (still the same order of DOM traversal), so this is not a DoS complexity defect. Per the skill's requirement for DoS-type claims — "you must prove the actual worst-case input triggers it, not merely claim it" — **this run did not perform that proof**, so it is not written up as a finding.

---

## 6. Process record: how one candidate finding was refuted by execution

This records the complete path by which one candidate finding was refuted at the gates, for later calibration.

**Hypothesis**: in the regex `/^\s*function[\s\w]*\(/` at `check.js:13`, `\s*` allows newlines, so a `spec` starting with a newline can be constructed, making `'return ' + spec` become `return\n<code>`, triggering automatic semicolon insertion (ASI) so that `return` terminates early — thereby **executing the injected code**.

**This chain of reasoning reads as fully sound**, and it gives a concrete way to construct the payload. Per devil's advocate question 1 ("Am I hallucinating this flaw?"), the hypothesis was **not accepted outright**; instead, **the experiment was run**:

```
  正常函数表达式     regex=true   -> 编译通过, 返回 function   __PWNED=undefined
  裸函数表达式       regex=true   -> 编译通过, 返回 function   __PWNED=undefined
  ASI 绕过尝试       regex=true   -> 编译通过, 返回 undefined  __PWNED=undefined
  同样但无换行       regex=true   -> 抛 SyntaxError
```

**The hypothesis was refuted**: the payload did pass the regex and did compile successfully (no syntax error), but `__PWNED` was still `undefined` — **the injected code did not execute**.

The reason: everything after `return` is unreachable. Function declarations are hoisted (so `f` exists), but the **call statement** `f()` sits after the `return` and never executes. The `return` prefix is itself an effective guard, and ASI cannot get around it.

**This item is worth more than the five false positives themselves**: it proves that **the gates are not formalism** — a self-consistent, concrete, professional-sounding vulnerability claim was refuted by one actual execution. Without that execution step, it would have gone into the report as the sixth false positive.

---

## 7. Count summary

```
TRUE POSITIVE   : 0
FALSE POSITIVE  : 5
  #1 check.js:14 的 new Function        — 门禁 2/3 FAIL（无信任边界）
  #2 audit.js:254 的 new Function       — 门禁 2/3 FAIL（同上）
  #3 pollyfill-elements-from-point.js:16 — 门禁 2 FAIL（sink 处无攻击者数据）
  #4 valid-langs.js:10                   — 门禁 2 FAIL（位于块注释内）
  #5 frame-messenger 的 postMessage      — 门禁 2 FAIL（校验在 handler，且通配为文档化 opt-in）
INCONCLUSIVE    : 0
非安全类观察     : 2（文案自相矛盾、重复遍历）
阶段 B 发现      : 0
```

---

## 8. Capability gaps exposed by this run (recorded faithfully)

Per rule 3, what this run **did not do for lack of capability** is an output as important as the conclusions:

| Gap | Impact |
|---|---|
| No automated data flow / taint tracking | All 5 data flows in this run were traced by hand. This stops being viable once the candidate count grows — **this is exactly what "supplying the deterministic facts" is meant to solve** |
| No git security-regression capability | Cannot answer "was the code deleted in this change a security fix". **The capability is not yet implemented** |
| No coverage join | Cannot answer "has this code been touched by tests". Feasibility has been verified; see `docs/fact-contract.md` §6.2 |
| No call-graph tool | The blast radius was enumerated by hand with `git grep`; that does not scale to large changes |
| Only the source was audited, not the build artifacts | `axe.js` (1.33 MB bundle) was not audited at all |

**The most critical one**: the adjudication of all 5 candidates in this run **depended entirely on reading the implementation by hand**. Multiply the candidate count by 10 and this process degrades into "no time to read, judging by feel" — which is the very problem euthyna exists to solve.

The judgment this run yields is therefore: before the candidate scale grows, **the bottleneck is deterministic measurement, not audit scope** — build the two measurements specified in `docs/fact-contract.md` first, so that screening out candidates can rest on machine evidence.

---

## 9. Statement of limitations

- **The sample is extremely small**: 5 candidates, generated by a single pattern set. The 100% false positive rate **cannot be extrapolated** to "all coarse screens produce 100% false positives".
- **The target is unusual**: axe-core is a mature library with a dedicated security process (`SECURITY.md` in the repository, Dependabot, CI). On targets with weaker maintenance, the true positive rate would be higher.
- **The true-positive capability was not tested**: this run produced 0 true positives, which **does not show that the method can identify true positives** — it shows only that it can filter out false positives. Testing recall would require a target **known to contain real defects** (for example, one with defects injected on purpose); this run did not do that.
- **No external scanner was run**: with no semgrep / CodeQL / OSV as a comparison baseline, "5 coarse-screen candidates" does not represent the output volume of any commercial tool.
- **For criteria not evaluated, see the coverage table in Section 1**; this report does not constitute a security endorsement.
