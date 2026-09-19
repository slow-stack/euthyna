# euthyna

> **εὔθυνα** — in classical Athens, the audit every outgoing official had to submit.
> You did not get to simply walk away from office. You handed over your accounts and they
> were examined. Pass, and you left with your standing intact. Fail, and you faced trial.

A **code security audit framework** for AI coding agents.

It is not another scanner. It **produces the deterministic facts an agent cannot compute**
and **adjudicates the security claims an agent cannot stop itself from making**.

---

## The problem

AI coding agents write code well and report on it badly, in two specific ways:

1. **They report things that are not real.** A pattern that resembles a vulnerability gets
   called a vulnerability, without tracing the data flow, and with the severity rated high.
2. **They cannot count.** Ask how many callers a function has and the answer is a guess from
   a few files. Ask whether a change is covered by tests and the answer is an impression.

Neither is fixed by telling the agent to be more careful. So this project does two things:

- **Supplies the numbers**: calls, coverage, and git history provenance, computed deterministically.
- **Constrains the conclusions**: every claim passes six gates, and a claim that cannot produce
  evidence gets downgraded to an observation rather than reported as a finding.

---

## What is actually built

| Piece | What it is | Status |
|---|---|---|
| **Fact producers** | A zero-dependency Node CLI that answers two questions deterministically | Working, tested |
| **The skill** | The audit discipline itself, as loadable Markdown | Working, loadable |
| **The benchmark** | A blind recall measurement for the adjudication layer | First round complete |

### Fact producer 1 — `history`

> *"The code this change deleted — where did it come from, and was that a security fix?"*

```
$ euthyna history --repo <path> --base main --head HEAD

已确证 (7)
  • 本次变更删除了 4 行来自提交 ab877f9d70 的代码，分布在 2 个文件。
    提交信息："fix(link-in-text-block): don't match style or script text (#3775)"，分类：fix
      证据: lib/checks/color/link-in-text-block-evaluate.js (ab877f9d70)
      复现: git blame --porcelain -L 104,104 -L 114,114 <base> -- lib/checks/.../evaluate.js
```

Every deleted line is blamed back to the commit that introduced it, and that commit is
classified from its own message. `--pickaxe` additionally detects a line that is absent at
the base revision yet has earlier commits changing its occurrence count — which by
construction means it was removed and is now being added back.

### Fact producer 2 — `coverage`

> *"Has any test ever actually invoked the symbol I just changed?"*

Reads c8's `fnMap` invocation counts. It has exactly two outcomes and **no third**:

| Count | Output | Meaning |
|---|---|---|
| `0` | `established` | The symbol was never invoked. Every caller lacks executed coverage. |
| `> 0` | `unknown` | The symbol was entered — which proves **nothing** about any particular call site. |

**There is no code path in this producer that emits "executed".** That is the design, not an
omission. V8 block coverage reports unreachable code as covered, so a naive
"line covered → call ran" join reports a call site that never ran as executed — wrong in the
one direction a security audit cannot afford, because it hides a real gap and manufactures
confidence at the same time. See [`docs/fact-contract-zh.md`](docs/fact-contract-zh.md) §6.2.

### Exit codes are part of the contract

Surveying eight measurement plugins in this ecosystem found **none of them publishes a process
exit code**, which makes their output unusable as a CI gate. This one does:

| Code | Meaning |
|---|---|
| `0` | Measured; nothing security-classified found |
| `10` | Measured; at least one `security`-classified fact exists |
| `1` | Usage error |
| `2` | **Could not measure at all** — must not be read as clean |

`2` being distinct from `0` is the whole point: *failing to measure* and *measuring and finding
nothing* are different things.

---

## Install and run

Zero runtime dependencies. Running the test suite does not require `npm install`.

```powershell
git clone https://github.com/slow-stack/euthyna
cd euthyna
npm test                                        # 61 tests

node bin/euthyna.js history --repo <path> --base main --head HEAD
node bin/euthyna.js history --repo <path> --base main --pickaxe
node bin/euthyna.js coverage --coverage coverage/coverage-final.json --symbol <name>
```

Add `--json` for the structured fact report.

### Using the skill

`.agents/skills/euthyna/` is a complete, self-contained skill directory. Copy it into any
skill root DSH discovers (`~/.agents/skills/`, `~/.claude/skills/`, or a project's
`.agents/skills/`). The Markdown layer is portable across Claude Code, Codex and DSH; only the
hook configuration format and plugin packaging differ per host.

---

## What has been verified, and what has not

This project tries to be explicit about the difference. Current state:

### Verified

- **`history` attribution against a real repository.** Run against
  [axe-core](https://github.com/dequelabs/axe-core); 17 deleted lines attributed to the commits
  that introduced them. The output was then checked **by hand** against `git blame`, which
  caught two real bugs in this tool — see below.
- **`coverage` on real c8 output**, distinguishing all three states correctly.
- **Adjudication recall and specificity**, measured blind: **10/10 cases**, 4 real
  vulnerabilities all caught, 6 non-vulnerabilities all correctly cleared, no abstentions.
  Every case is a *near-neighbour pair* — same pattern, one guard apart — so the verdicts had to
  come from reading the guard rather than recognising the shape.
  See [`bench/RESULTS.md`](bench/RESULTS.md).
- **The delivery-gate mechanism**, by running the real host plugin: blocking works, and the two
  documented ways of getting it wrong do not. See [`docs/dsh-stop-gate-zh.md`](docs/dsh-stop-gate-zh.md).

### Not verified

- **Whether the method finds vulnerabilities in real code.** The benchmark measures whether the
  discipline reaches the right verdict *on a claim*. It does not measure whether the claims would
  be found in the first place. The cases are deliberately constructed.
- **Recall in the field.** Four real-bug samples is a directional signal, not a rate.
- **Source maps, bundlers, monorepos** for the coverage producer. Untested.
- **Anything about axe-core's security**, from the case study run — it found nothing, which is
  not an endorsement. See [`docs/case-study-axe-core-zh.md`](docs/case-study-axe-core-zh.md).

---

## Three bugs this project found in itself

Recorded because they are the reason the verification steps exist.

1. **A repeated `--symbol` flag overwrote instead of accumulating**, so asking about three
   symbols silently answered about one. Caught by running against real coverage data.
2. **"The change deleted nothing" was reported as a measurement failure** rather than as a
   completed measurement with an empty answer. Caught by a test asserting the exit code.
3. **`git blame --porcelain` was read from the wrong field.** It emits
   `<sha> <origLine> <finalLine>`, and using `origLine` produces a command that exits 0, looks
   plausible, and blames a completely different line. Caught by checking this tool's own output
   against axe-core by hand. There is now a test that *runs the command the tool advertises*.

---

## Repository layout

```
euthyna/
├── bin/  src/  test/        Fact producers (zero dependencies, Node >= 20)
├── .agents/skills/euthyna/  The audit discipline, as a portable skill
├── bench/                   Blind recall benchmark + results
├── docs/                    Design notes and case studies (Chinese)
├── tools/                   Research and verification scripts
└── data/                    DSH plugin catalog snapshot
```

`tools/fetch-references.js` downloads the upstream sources this project reads into `.refs/`
(gitignored). **No third-party files are distributed in this repository** — see
[`NOTICE.md`](NOTICE.md) for why, and for what is owed to whom.

---

## Status

Early, and honest about it. Working: the two fact producers, the skill, the benchmark harness.
Not yet built: wiring the skill to the CLI so an agent uses them without being told, and the
git-history / coverage work needed to close the remaining recall gap.

The design notes are currently in Chinese. An English translation of `docs/` is a known gap.

## License

**Apache License 2.0** — see [`LICENSE`](LICENSE).
