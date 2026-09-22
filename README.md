<p align="center">
  <img src="assets/euthyna.png" width="150" alt="euthyna logo">
</p>

<h1 align="center">euthyna</h1>

> **εὔθυνα** — in classical Athens, the audit every outgoing official had to submit.
> You did not get to simply walk away from office. You handed over your accounts and they
> were examined. Pass, and you left with your standing intact. Fail, and you faced trial.

<p align="center">
  <a href="https://github.com/slow-stack/euthyna/actions/workflows/ci.yml"><img src="https://github.com/slow-stack/euthyna/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.skills.sh/slow-stack/euthyna"><img src="https://skills.sh/b/slow-stack/euthyna.svg" alt="Agent skills installs"></a>
</p>

**euthyna is a code security audit framework for AI coding agents.** It is not another
scanner. It does two things: it **produces the facts an agent cannot compute by reading
code**, and it **forces every security claim the agent makes through gates before it
counts as a finding**.

---

## 📖 The problem, in plain words

When an AI coding agent touches security, it fails in two specific ways:

1. **It reports things that are not real.** Code that *looks* dangerous gets called a
   vulnerability, without tracing the data. In validation runs on real codebases — a
   JavaScript one and a Python one — the pattern-matched "vulnerabilities" were mostly
   false: **5 out of 5** refuted at the gates on the first run; **2 out of 3** refuted,
   the third unresolved (INCONCLUSIVE, supply-chain-dependent) on the second. See the
   [case studies](https://github.com/slow-stack/euthyna/blob/main/docs/case-study-crewai.md)
   ([Python/crewAI](https://github.com/slow-stack/euthyna/blob/main/docs/case-study-crewai.md),
   [JavaScript/axe-core](https://github.com/slow-stack/euthyna/blob/main/docs/case-study-axe-core.md)).
2. **Its reassurances cannot be checked.** "I'm done." "The tests cover this." "It's
   safe now." These are assertions. You cannot tell a done-claim from a done-deal.

Neither is fixed by telling the agent to be more careful. euthyna changes the handshake
between you and the agent:

> **The agent saying "I'm done" does not count. The accounts get handed over, and the
> gates decide.**

---

## ⚖️ The two things it does

### 1. It measures what a model cannot

Three fact producers — a zero-dependency Node CLI:

- **`history`** — for every line a change deletes, it attributes the line to a commit
  and classifies that commit from its message, its own diff, and the deleted line's
  content (a deleted `if (!authorized)` is flagged even under a "tweaks" subject). By
  default the attribution is blame's "last touched"; `--origins` digs for the commit
  that *first introduced* the content with `git log -S`. If the deleted code came from
  a security fix, that is flagged. This is git archaeology no model can do from
  reading a diff.
- **`coverage`** — was this symbol *ever actually invoked* by a test? It has exactly two
  answers: never invoked (established), or entered but that proves nothing about any
  specific call site (unknown). **It never reports "executed"** — V8 coverage marks
  unreachable code as covered, and "line covered → call ran" is wrong in exactly the
  direction an audit cannot afford. The reasoning is in
  [`docs/fact-contract.md`](https://github.com/slow-stack/euthyna/blob/main/docs/fact-contract.md) §6.2.
- **`deps`** — what version is a dependency *actually* pinned to? It reads the lockfile
  (package-lock.json / Cargo.lock / go.mod) and reports the resolved versions, or that a
  dependency is absent from the tree entirely. This is the fact that resolves
  supply-chain claims ("the app uses a vulnerable version of X"): the version-to-CVE
  mapping is left to the adjudication layer, exactly as the fact contract requires. See
  [`docs/fact-contract.md`](https://github.com/slow-stack/euthyna/blob/main/docs/fact-contract.md) §6.3.

### 2. It gates what the agent claims

The [skill](https://github.com/slow-stack/euthyna/tree/main/.agents/skills/euthyna/) is the audit discipline itself, as loadable
Markdown. Every security claim must pass six gates — reachability, trust boundary, real
impact, and their counterparts. A claim that cannot produce evidence is **downgraded to
an observation**, not reported as a finding. "I'm done" becomes a package: claims,
evidence, and the commands that reproduce both.

The gates are not only prose. `euthyna gate <report>` reads an adjudication report and
mechanically checks every finding against its verdict — evidence down to `path:L123`, a
reproduce command, an impact statement, consistent gate statuses — and downgrades
whatever does not measure up. `--verify` re-runs the reproduce commands: `git` commands
by default, interpreter commands (`node`/`npm`/`python`) only with the explicit
`--allow-exec`, because an interpreter command from a report is arbitrary code and the
flag is the caller vouching for that report.

---

## 🖥️ Which tools it works in, and how to install

**Prerequisite for everything**: Node >= 20 and git. There is nothing else to install —
the project is deliberately zero-dependency.

| Host | The skill (audit discipline) | The CLI (fact producers) |
|---|---|---|
| **DSH** | `dsh plugin --profile web add euthyna` — the npm package mounts its own skill; or copy `.agents/skills/euthyna/` into `~/.agents/skills/` (user-wide) or `<project>/.agents/skills/`. Markdown hot-reloads; no restart needed. | `npm install -g euthyna` — runs in any terminal |
| **Claude Code** | `/plugin marketplace add slow-stack/euthyna` then `/plugin install euthyna@euthyna`, or copy `.agents/skills/euthyna/` into `~/.claude/skills/` | Same |
| **Codex** | The same Markdown layer works; packaging goes through Codex's plugin/marketplace format | Same |
| **Hermes** | Copy the same folder into `~/.hermes/skills/` under a category folder, or install from a repo with `hermes skills install` — and for the slash command, install the repo as a plugin (see below) | Same |
| **OpenCode** | Copy the same folder into `~/.agents/skills/` or `~/.config/opencode/skills/` (OpenCode loads both; unknown frontmatter fields are ignored) | Same |
| **Any terminal** | — | `npm install -g euthyna`, then `euthyna …` |

The skill ships in two languages. The directory above is the Chinese original (`euthyna`);
an English mirror lives at `.agents/skills/euthyna-en/` (skill name `euthyna-en`) — install
that one for an English-speaking agent, or translate the folder yourself. Both define the
same discipline, and `euthyna gate` accepts report markers in either language.

Two honest notes:

- **The skill is the instructions; the CLI is the measurement.** The skill directory
  does **not** contain the CLI. Install the CLI from npm (`npm install -g euthyna`) or
  keep this repository checked out; on a host without the CLI, the skill requires the
  unmeasurable criteria to be recorded as *not evaluated* rather than guessed at — that
  fallback is the design, not a gap.
- **The CLI speaks Chinese by default, English on request.** Output is Chinese unless you
  pass `--lang en` (any command) or set `EUTHYNA_LANG=en`; the default never changes for
  existing users. The skill text and the CLI's reports exist in both languages — the
  English reader should expect Chinese only from a run that did not ask for English.

---

## 🎯 First use

euthyna is **user-invoked, not auto-triggering**. The skill declares
`disable-model-invocation: true`, so the model will not load it on its own —
you have to ask for the audit explicitly. That is also how you tell it apart
from other security skills you may have installed: **if you did not name it,
it did not run.**

### Triggering the audit

Say it plainly in conversation:

> 「用 euthyna 审计一下 `D:\some-project`，审完再交付」

The agent then loads the skill and runs the audit discipline: it produces the
deterministic facts (`history` / `coverage` / `deps`) first, walks every
suspect through the six gates, and writes a report file instead of only
replying in chat.

### Slash commands

| Host | Command | Setup |
|---|---|---|
| Claude Code | `/euthyna <path>` | copy `.claude/commands/euthyna.md` from the package into `~/.claude/commands/` (user-wide) or `.claude/commands/` (project) |
| Codex | — | Codex's custom-prompt slash commands (`~/.codex/prompts/`) are deprecated upstream; the same Markdown can still be placed there manually |
| DSH | `/euthyna` | installed with the plugin; after a restart the command prints the usage manual (DSH slash commands run without reaching the model) |
| Hermes | `/euthyna <subcommand> <args…>` | install this repository as a Hermes plugin: `hermes plugins install slow-stack/euthyna` then `hermes plugins enable euthyna` (needs Node >= 20 on PATH; the repo root carries `plugin.yaml` + `__init__.py`). The command forwards to the CLI and prints its output without reaching the model. The skill itself can still be installed separately with `hermes skills install slow-stack/euthyna/.agents/skills/euthyna` |

### How to tell it was euthyna that audited

- the report filename is `<PROJECT>_EUTHYNA_AUDIT_<YYYY-MM-DD>.md`
- verdicts use the three-state shape `BUG #N TRUE POSITIVE / FALSE POSITIVE / INCONCLUSIVE`
- every claim cites `path:L123` evidence and a reproduce command
- missing data is recorded as *not evaluated*, never as "clean"

---

## 🚀 Quick start

```sh
npm install -g euthyna
euthyna history --repo <path> --base main --head HEAD          # add --origins to chase the first introducer
euthyna coverage --coverage coverage/coverage-final.json --symbol <name>
euthyna deps --repo <path> --dep <name>
euthyna gate <adjudication-report.md> --verify --cwd <repo>    # mechanically check the six gates
```

Or without a global install: `npx euthyna history --repo <path> --base main`.

From a checkout instead (development):

```sh
git clone https://github.com/slow-stack/euthyna
cd euthyna && npm test                                 # 178 tests; no install step exists
node bin/euthyna.js history --repo <path> --base main --head HEAD
```

What `history` reports looks like this:

```
已确证 (7)
  • 本次变更删除了 4 行来自提交 ab877f9d70 的代码，分布在 2 个文件。
    提交信息："fix(link-in-text-block): don't match style or script text (#3775)"，分类：fix
      证据: lib/checks/color/link-in-text-block-evaluate.js (ab877f9d70)
      复现: git blame --porcelain -L 104,104 -L 114,114 <base> -- lib/checks/.../evaluate.js
```

Every deleted line is blamed back to a commit, and the `复现`
(Reproduce) command lets you re-derive the claim yourself without trusting the report.
Add `--json` for the structured fact report, `--pickaxe` to detect lines that were
removed and are now being added back, and `--origins` to attribute deleted lines to the
commit that first introduced their content rather than to blame's last modifier.

### Exit codes are part of the contract

Surveying eight measurement plugins in this ecosystem found **none of them publishes a
process exit code**, which makes their output unusable as a CI gate. This one does:

| Code | Meaning |
|---|---|
| `0` | Measured; nothing security-classified found — or a `gate` report fully passes |
| `10` | Measured; at least one `security`-classified fact exists — or a `gate` report has findings downgraded to observations |
| `1` | Usage error |
| `2` | **Could not measure at all** — must not be read as clean (also: a `gate` report that cannot be read or has no findings) |

`2` being distinct from `0` is the whole point: *failing to measure* and *measuring and
finding nothing* are different things.

---

## 🧱 What is actually built

| Piece | What it is | Status |
|---|---|---|
| **Fact producers** | A zero-dependency Node CLI that answers three questions deterministically | Working, tested |
| **The skill** | The audit discipline itself, as loadable Markdown | Working, loadable |
| **The benchmark** | A blind recall measurement for the adjudication layer | Four rounds complete; the loop is one command (`bench/adjudicate.js`), with a deterministic golden round on CI |

---

## ✅ What has been verified, and what has not

This project tries to be explicit about the difference. Current state:

### Verified

- **`history` attribution against real repositories — in two languages.** Run against
  [axe-core](https://github.com/dequelabs/axe-core) (JavaScript) and
  [crewAI](https://github.com/crewAIInc/crewAI) (Python); deleted lines attributed to the
  commits that introduced them, then checked **by hand** against `git blame`. The checks
  developed for that comparison now run as regression tests in the suite.
- **`coverage` on real output in three formats** — c8/V8 JSON, classic istanbul (jest/nyc, same
  fnMap/f shape) and coverage.py JSON (format 3) — distinguishing all three states correctly, and
  refusing anything that is not a recognizable coverage report instead of answering "symbol not
  located" against it.
- **`deps` against a real lockfile** — resolved versions reported with a line-level evidence
  pointer into the lockfile, and absent dependencies reported as established absences rather
  than silent skips. Verified against a populated npm v3 lockfile and fixture lockfiles for
  Cargo.lock and go.mod.
- **Adjudication recall and specificity**, measured blind: **10/10 cases**, 4 real
  vulnerabilities all caught, 6 non-vulnerabilities all correctly cleared, no abstentions.
  Round 2 repeated every case three times — **30 adjudications, zero flips**, four of them
  on a different model. Round 3 expanded the set to **18 cases** (8 real, 10 not) and
  reshuffled the blind ids every round: **54 adjudications**, 24/24 real-bug claims caught
  with no misses and no abstentions, 29/30 non-vulnerabilities correctly cleared — and the
  single "false alarm" was the round's finding, not noise: the adjudicator caught a defect
  in a fixture's guard, confirmed by reproduction and fixed. Every case is a *near-neighbour
  pair* — same pattern, one guard apart — so the verdicts had to come from reading the guard
  rather than recognising the shape. Round 4 re-ran the full set under fresh id shuffles, with
  the twice-defeated guard — rebuilt as a bare-name allow-list — facing its first blind
  adjudication: **54/54 correct**, all 8 pairs separated, and a third run on a second model
  family agreed with the first two on every case.
  See [`bench/RESULTS.md`](https://github.com/slow-stack/euthyna/blob/main/bench/RESULTS.md),
  [`bench/RESULTS-round2.md`](https://github.com/slow-stack/euthyna/blob/main/bench/RESULTS-round2.md),
  [`bench/RESULTS-round3.md`](https://github.com/slow-stack/euthyna/blob/main/bench/RESULTS-round3.md),
  and [`bench/RESULTS-round4.md`](https://github.com/slow-stack/euthyna/blob/main/bench/RESULTS-round4.md).
- **The delivery-gate mechanism**, by running the real host plugin: blocking works, and the two
  documented ways of getting it wrong do not. See [`docs/dsh-stop-gate.md`](https://github.com/slow-stack/euthyna/blob/main/docs/dsh-stop-gate.md).
- **The gate discipline, mechanically.** `euthyna gate` is not a claim in prose: the suite
  pins the contract per verdict (a TRUE POSITIVE without `path:L123` evidence, a reproduce
  command or all six gates passing is downgraded; a FALSE POSITIVE needs a failing gate with
  a reason), and `--verify` is tested to *not* execute an interpreter command without
  `--allow-exec`. `test/skill.test.js` fails CI if the skill text stops declaring the six
  gates, the three verdicts, or the command that enforces them.
- **The adjudication loop, end to end and on CI.** `bench/adjudicate.js` runs a whole round —
  blind tree, one adjudicator process per case, machine-validated reports, scoring — and a
  deterministic `golden` round runs on every push, so the pipeline (and `score.js` going red
  on a wrong verdict) is checked without a model.

### Not verified

- **Whether the method finds vulnerabilities in real code.** The benchmark measures whether the
  discipline reaches the right verdict *on a claim*. It does not measure whether the claims would
  be found in the first place. The cases are deliberately constructed. The crewAI case study
  surfaced one INCONCLUSIVE (pickle deserialization, supply-chain-dependent) and refuted the
  rest — a directional signal, not a rate.
- **Recall in the field.** The benchmark's real-bug cases are constructed; whether the
  discipline helps on code nobody staged for it is unmeasured.
- **Source maps, bundlers, monorepos** for the coverage producer. Untested.
- **A real model round on CI.** The golden round is deterministic plumbing, not an
  adjudication: it writes the ground truth into the reports by design. A model round needs
  credentials and is non-deterministic by nature, so it stays a local/manual step
  (`bench/README.md` documents the command) rather than a CI gate that could flake.
- **`--verify` as a sandbox.** It is not one, and does not claim to be: it executes the
  report's commands with your privileges, `git` only unless `--allow-exec` is passed.
- **`deps` beyond three formats and version facts only.** pnpm/yarn/poetry lockfiles are
  detected but not parsed (reported as *not evaluated*, never guessed at); go.mod reports the
  *declared* requirement, not the resolved build version; and the producer never maps a version
  to a CVE — that mapping is deliberately left to the adjudication layer.
- **Anything about the case-study targets' security** — the runs found nothing to endorse or
  condemn; that is not a statement about either project. See
  [`docs/case-study-crewai.md`](https://github.com/slow-stack/euthyna/blob/main/docs/case-study-crewai.md) and
  [`docs/case-study-axe-core.md`](https://github.com/slow-stack/euthyna/blob/main/docs/case-study-axe-core.md).

---

## 📂 Repository layout

```
euthyna/
├── bin/  src/  test/        Fact producers (zero dependencies, Node >= 20)
├── .agents/skills/euthyna/  The audit discipline, as a portable skill
├── plugin.yaml  __init__.py  Hermes plugin: the /euthyna slash command
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
