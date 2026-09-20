<p align="center">
  <img src="assets/euthyna.png" width="150" alt="euthyna logo">
</p>

<h1 align="center">euthyna</h1>

> **εὔθυνα** — in classical Athens, the audit every outgoing official had to submit.
> You did not get to simply walk away from office. You handed over your accounts and they
> were examined. Pass, and you left with your standing intact. Fail, and you faced trial.

<p align="center">
  <a href="https://github.com/slow-stack/euthyna/actions/workflows/ci.yml"><img src="https://github.com/slow-stack/euthyna/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

**euthyna is a code security audit framework for AI coding agents.** It is not another
scanner. It does two things: it **produces the facts an agent cannot compute by reading
code**, and it **forces every security claim the agent makes through gates before it
counts as a finding**.

---

## 📖 The problem, in plain words

When an AI coding agent touches security, it fails in two specific ways:

1. **It reports things that are not real.** Code that *looks* dangerous gets called a
   vulnerability, without tracing the data. In one validation run on a real codebase,
   **5 out of 5** pattern-matched "vulnerabilities" were false — each died at a different
   gate. See the [case study](docs/case-study-axe-core.md).
2. **Its reassurances cannot be checked.** "I'm done." "The tests cover this." "It's
   safe now." These are assertions. You cannot tell a done-claim from a done-deal.

Neither is fixed by telling the agent to be more careful. euthyna changes the handshake
between you and the agent:

> **The agent saying "I'm done" does not count. The accounts get handed over, and the
> gates decide.**

---

## ⚖️ The two things it does

### 1. It measures what a model cannot

Two fact producers — a zero-dependency Node CLI:

- **`history`** — for every line a change deletes, it finds the commit that introduced
  that line and classifies that commit from its own message. If the deleted code came
  from a security fix, that is flagged. This is git archaeology no model can do from
  reading a diff.
- **`coverage`** — was this symbol *ever actually invoked* by a test? It has exactly two
  answers: never invoked (established), or entered but that proves nothing about any
  specific call site (unknown). **It never reports "executed"** — V8 coverage marks
  unreachable code as covered, and "line covered → call ran" is wrong in exactly the
  direction an audit cannot afford. The reasoning is in
  [`docs/fact-contract.md`](docs/fact-contract.md) §6.2.

### 2. It gates what the agent claims

The [skill](.agents/skills/euthyna/) is the audit discipline itself, as loadable
Markdown. Every security claim must pass six gates — reachability, trust boundary, real
impact, and their counterparts. A claim that cannot produce evidence is **downgraded to
an observation**, not reported as a finding. "I'm done" becomes a package: claims,
evidence, and the commands that reproduce both.

---

## 🖥️ Which tools it works in, and how to install

**Prerequisite for everything**: Node >= 20 and git. There is nothing else to install —
the project is deliberately zero-dependency.

| Host | The skill (audit discipline) | The CLI (fact producers) |
|---|---|---|
| **DSH** | Copy `.agents/skills/euthyna/` into `~/.agents/skills/` (user-wide) or `<project>/.agents/skills/`. Markdown hot-reloads; no restart needed. | Runs in any terminal, from this repository |
| **Claude Code** | Copy the same folder into `~/.claude/skills/` | Same |
| **Codex** | The same Markdown layer works; packaging goes through Codex's plugin/marketplace format | Same |
| **Any terminal** | — | `git clone`, then `node bin/euthyna.js …` |

Two honest notes:

- **The skill is the instructions; the CLI is the measurement.** The skill directory
  does **not** contain the CLI. Keep this repository checked out; on a host without it,
  the skill requires the unmeasurable criteria to be recorded as *not evaluated* rather
  than guessed at — that fallback is the design, not a gap.
- **The skill text and the CLI's reports are currently written in Chinese.** The
  discipline is host-agnostic Markdown, but an English reader should expect Chinese
  output from the tool itself.

---

## 🚀 Quick start

```sh
git clone https://github.com/slow-stack/euthyna
cd euthyna
npm test                                              # 61 tests; no install step exists
node bin/euthyna.js history --repo <path> --base main --head HEAD
node bin/euthyna.js coverage --coverage coverage/coverage-final.json --symbol <name>
```

What `history` reports looks like this:

```
已确证 (7)
  • 本次变更删除了 4 行来自提交 ab877f9d70 的代码，分布在 2 个文件。
    提交信息："fix(link-in-text-block): don't match style or script text (#3775)"，分类：fix
      证据: lib/checks/color/link-in-text-block-evaluate.js (ab877f9d70)
      复现: git blame --porcelain -L 104,104 -L 114,114 <base> -- lib/checks/.../evaluate.js
```

Every deleted line is blamed back to the commit that introduced it, and the `复现`
(Reproduce) command lets you re-derive the claim yourself without trusting the report.
Add `--json` for the structured fact report, and `--pickaxe` to detect lines that were
removed and are now being added back.

### Exit codes are part of the contract

Surveying eight measurement plugins in this ecosystem found **none of them publishes a
process exit code**, which makes their output unusable as a CI gate. This one does:

| Code | Meaning |
|---|---|
| `0` | Measured; nothing security-classified found |
| `10` | Measured; at least one `security`-classified fact exists |
| `1` | Usage error |
| `2` | **Could not measure at all** — must not be read as clean |

`2` being distinct from `0` is the whole point: *failing to measure* and *measuring and
finding nothing* are different things.

---

## 🧱 What is actually built

| Piece | What it is | Status |
|---|---|---|
| **Fact producers** | A zero-dependency Node CLI that answers two questions deterministically | Working, tested |
| **The skill** | The audit discipline itself, as loadable Markdown | Working, loadable |
| **The benchmark** | A blind recall measurement for the adjudication layer | Three rounds complete |

---

## ✅ What has been verified, and what has not

This project tries to be explicit about the difference. Current state:

### Verified

- **`history` attribution against a real repository.** Run against
  [axe-core](https://github.com/dequelabs/axe-core); 17 deleted lines attributed to the
  commits that introduced them, then checked **by hand** against `git blame`. The checks
  developed for that comparison now run as regression tests in the suite.
- **`coverage` on real c8 output**, distinguishing all three states correctly.
- **Adjudication recall and specificity**, measured blind: **10/10 cases**, 4 real
  vulnerabilities all caught, 6 non-vulnerabilities all correctly cleared, no abstentions.
  Round 2 repeated every case three times — **30 adjudications, zero flips**, four of them
  on a different model. Round 3 expanded the set to **18 cases** (8 real, 10 not) and
  reshuffled the blind ids every round: **54 adjudications**, 24/24 real-bug claims caught
  with no misses and no abstentions, 29/30 non-vulnerabilities correctly cleared — and the
  single "false alarm" was the round's finding, not noise: the adjudicator caught a defect
  in a fixture's guard, confirmed by reproduction and fixed; that final guard version
  has not yet faced a fresh blind round. 17/18 cases were stable across all three runs.
  Every case is a *near-neighbour pair* — same pattern, one guard
  apart — so the verdicts had to come from reading the guard rather than recognising the shape.
  Round 3 ran on a single model (no second route was available), so cross-model evidence
  remains round 2's four adjudications.
  See [`bench/RESULTS.md`](bench/RESULTS.md), [`bench/RESULTS-round2.md`](bench/RESULTS-round2.md),
  and [`bench/RESULTS-round3.md`](bench/RESULTS-round3.md).
- **The delivery-gate mechanism**, by running the real host plugin: blocking works, and the two
  documented ways of getting it wrong do not. See [`docs/dsh-stop-gate.md`](docs/dsh-stop-gate.md).

### Not verified

- **Whether the method finds vulnerabilities in real code.** The benchmark measures whether the
  discipline reaches the right verdict *on a claim*. It does not measure whether the claims would
  be found in the first place. The cases are deliberately constructed.
- **Recall in the field.** Four real-bug samples is a directional signal, not a rate.
- **Source maps, bundlers, monorepos** for the coverage producer. Untested.
- **Anything about axe-core's security**, from the case study run — it found nothing, which is
  not an endorsement. See [`docs/case-study-axe-core.md`](docs/case-study-axe-core.md).

---

## 📂 Repository layout

```
euthyna/
├── bin/  src/  test/        Fact producers (zero dependencies, Node >= 20)
├── .agents/skills/euthyna/  The audit discipline, as a portable skill
├── bench/                   Blind recall benchmark + results
├── docs/                    Design notes and case studies (English and Chinese)
├── tools/                   Research and verification scripts
└── data/                    DSH plugin catalog snapshot
```

`tools/fetch-references.js` downloads the upstream sources this project reads into `.refs/`
(gitignored). **No third-party files are distributed in this repository** — see
[`NOTICE.md`](NOTICE.md) for why, and for what is owed to whom.

---

## 🧭 Status

Early, and honest about it. Working: the two fact producers, the skill, the benchmark harness.
Not yet built: wiring the skill to the CLI so an agent uses them without being told, and the
git-history / coverage work needed to close the remaining recall gap.

The design notes are available in English and Chinese; the `-zh` files are the originals.

## 🤝 Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: no AI attribution in commits,
one change per commit, and do not claim something works until you have run it.

## 🔒 Security

The fact producers execute `git` and parse coverage output; their integrity is the product.
What is in scope, and how to report privately: [`SECURITY.md`](SECURITY.md). Note that the
benchmark fixtures in `bench/cases/` are vulnerable by construction and are not vulnerabilities.

## 📜 License

**Apache License 2.0** — see [`LICENSE`](LICENSE).
