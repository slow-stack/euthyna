# AGENTS.md — working in this repository

> This file is for AI agents working **on** euthyna. DSH loads it automatically from the
> project root (`AGENTS.md` or `CLAUDE.md`, walking up the ancestor chain).
>
> It exists so that the next agent does not redo research that is already settled, and does
> not inherit conclusions that have since been disproved.

---

## What this project is

`euthyna` (εὔθυνα — the audit Athenian officials submitted on leaving office) is a code
security audit framework for AI coding agents.

It is **not a scanner**. It does two things:

1. **Produces deterministic facts** an agent cannot compute — git provenance of deleted code,
   and whether a symbol was ever invoked.
2. **Adjudicates security claims** — every claim passes six gates, and one that cannot produce
   evidence is downgraded to an observation rather than reported as a finding.

The core mechanism, from the name: **the agent saying "I'm done" does not count. The accounts
have to be handed over and the gates have to pass.**

---

## House rules

- **No AI attribution in commits.** No `Co-Authored-By`, no "Generated with", no tool
  signatures. This is a hard rule, not a preference.
- **Do not claim something works until you have run it.** If you say a test passes, paste the
  output. "Should be fine" is not a result.
- **Distinguish measured from inferred from assumed.** When you cannot verify something, say
  so. The documents in `docs/` and `bench/` all carry an explicit limitations section; keep
  that up when you edit them.
- **Record disproved conclusions rather than deleting them.** `bench/RESULTS.md` and the
  pitfalls table below both record things that turned out to be wrong. That is deliberate —
  it is how the next agent avoids repeating them.
- **One change, one commit.** Add a third-party dependency only after auditing its source.

### Writing conventions

- Every document in `docs/` exists twice: the `-zh` file is the original, the unsuffixed
  file is its English translation. `README.md` is English only.
- Public text states facts and decisions only. No internal questions, no "let me know what
  you think" — those belong in a conversation, not in a repository.
- When a claim is hedged, keep the hedging. It is usually load-bearing.

---

## Verified host facts

Established by reading the local DSH source and, where marked 🧪, by **executing** something.
Not inferred. Do not re-research these.

### npm publication

- `euthyna@0.1.0` published 2026-09-21, unscoped name (`npm install -g euthyna`).
  Publish-prep commit `783a494`; CI `35568417444` green; registry shasum
  `95d2573a08…` byte-identical to the locally smoke-tested tarball. Tag `v0.1.0`
  and its [release](https://github.com/slow-stack/euthyna/releases/tag/v0.1.0)
  followed the same day.
- 🧪 Releases run through `.github/workflows/publish.yml`: pushing a `v*` tag
  (the tag must match `package.json`) runs the suite, proves the token with
  `npm whoami`, and publishes with `--provenance`; a version already on the
  registry is skipped by the gate instead of failing the run. The token is a
  Granular Access Token scoped to the euthyna package, stored in the
  `NPM_TOKEN` repository secret.
- 🧪 The workflow cuts the GitHub release from a versioned template
  (`.github/release-notes-template.md`, a `{{version}}` placeholder is
  substituted at publish time): every release carries one fixed format, and
  format changes are reviewed like any other file. The manual `workflow_dispatch`
  rehearsal renders the notes for inspection without uploading or releasing —
  run `35577551209` (commit `1e65d0a`) rendered the template with `0.1.0`
  substituted; the release itself is created only on a `v*` tag push, titled
  `euthyna <version>`. `v0.1.0`'s release predates the template and keeps its
  hand-written notes.
- 🧪 Set the secret through the GitHub web UI. `gh secret set` with its hidden
  paste prompt stored an **empty** value twice on this machine's embedded
  terminal (the browser field works); the workflow's `npm whoami` step is what
  catches an empty or invalid token before anything ships.
- 🧪 Local npm still needs the proxy env (`HTTPS_PROXY`/`HTTP_PROXY` =
  `127.0.0.1:7897`), and a manual `npm publish` from a non-interactive shell
  gets `EOTP` with a masked URL — the interactive-terminal browser approval is
  the manual fallback when a tag push is not an option.

### Skill contract

DSH skill frontmatter recognises exactly five fields:
`name` / `description` / `whenToUse` / `invocation` / `metadata`.

- `name` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `invocation` defaults to `{ modelInvocable: true, userInvocable: true }`
- **Claude Code's `allowed-tools` is not recognised** — strip it when porting a skill from
  elsewhere

### Skill discovery paths (lower number wins; project can override global)

Source: `dsh-skill-filesystem/lib/index.js:150-187` (`roots()`).

```
<project>/.dsh/skills       100   PROJECT_DSH_RANK
<project>/.agents/skills    200   PROJECT_AGENTS_RANK
customSkillDirs             300   CUSTOM_RANK
<dshHome>/skills            400   USER_DSH_RANK
<agentsHome>/skills         500   USER_AGENTS_RANK
bundledSkillDir             built-in
```

🧪 **`agentsHome` resolves to `~/.agents`, not `~/.claude`.**
The resolution is `config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents")`
(`lib/index.js:78`), and nothing overrides it on a default install.

Decisive test: 65 skills present only under `~/.agents/skills` appeared in a session's skill
catalog, while all 5 present only under `~/.claude/skills` were absent.

> `brainstorming` and others are in neither directory, so a plugin-provided skill root also
> exists. The table above only covers the filesystem provider.

`watch` is on by default: Markdown changes take effect immediately. Plugin changes need a
`dsh web` restart.

### Hook protocol

DSH natively implements the Claude Code hook protocol
(`@deepseek-ai/dsh-hooks-claude-code`), supporting **seven** events:

```
SessionStart · UserPromptSubmit · PreToolUse · PostToolUse · Stop · SubagentStart · SubagentStop
```

- `Stop` **can** block: folded to `deny`, it reaches `agent.steer()` and forces another turn
- `SubagentStop` is **observe-only** — that branch does no decision folding
- `SubagentStart` can inject context into a still-running in-process child

#### ⚠️ A conclusion this project got wrong

An early conclusion here was that Trail of Bits' `fp-check` could be ported by copying its
`hooks.json`, because DSH implements the same protocol. **Running it disproved that: a copied
`hooks.json` registers nothing.** Two independent blockers:

1. **`prompt`-type hooks are skipped.** Both of fp-check's hooks are `"type": "prompt"`, and
   DSH only executes shell command handlers (`lib/index.js:73`, `:147`). The observed warning
   is `skipping unsupported "prompt" hook on Stop (only command hooks run)`.
2. **The Stop hook cannot see the conversation.** 🧪 The entire stdin payload is:

   ```json
   {"session_id":"…","transcript_path":"","cwd":"…","hook_event_name":"Stop","stop_hook_active":false}
   ```

   `transcript_path` is **always empty**, there is no `last_assistant_message`, and there is no
   message array. So fp-check's actual procedure — scanning the transcript for completed
   phases — **cannot be expressed on DSH at all**.

**What does work.** 🧪 Three paths, tested:

| Form | Result |
|---|---|
| Script **exit code 2**, reason on **stderr** | ✅ Blocks; the reason reaches the agent verbatim |
| stdout `{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny","permissionDecisionReason":"…"}}` | ✅ Blocks |
| stdout `{"ok":false,"reason":"…"}` with exit code 0 (fp-check's shape) | ❌ **Does not block** |

Fold order is `deny > ask > allow`; exit code 2 decodes to `block` (rank 3, same as `deny`).
`configPath` is required and accepts either a settings file with a `hooks` key or a bare
`hooks.json`.

**Three things you must handle yourself:**

- **The gate must rate-limit itself.** DSH has no turn budget, and `stop_hook_active` is always
  `false`. An unconditional blocking hook forces a continuation every step — an infinite loop.
- **Hook config is per-process and read once at startup.** Changing `hooks.json` requires
  restarting `dsh web`, unlike Markdown which hot-reloads.
- **Subagents cannot be gated.** `SubagentStop` cannot block, and `agent_type` is always
  `general-purpose`.

Reproduce: `node tools/check-stop-gate.mjs` — read-only, spawns nothing, writes no config.
Full analysis: `docs/dsh-stop-gate.md`.

### Cross-harness portability

- DSH loads skills from `~/.agents/skills` (see above), not `~/.claude/skills`
- Codex accepts Claude's plugin marketplace format; both
  [`auditor-skill`](https://github.com/solanabr/auditor-skill) and
  [`formalswarm`](https://github.com/fashionmascherine-svg/formalswarm) ship
  `.claude-plugin/marketplace.json`
- So the **`SKILL.md` layer is portable across all three hosts**; only the hook config format,
  the host plugin code, and the distribution entry point differ

### DSH plugin mechanism

- A plugin is an npm package: `dsh plugin --profile web add <name>` (forwards to pnpm)
- Catalog: `https://awesome-dsh-plugin.com/plugins.json` (GitHub Pages)
- Minimal skill-pack plugin: reuse the official `FileSystemSkillProvider`; the core is about
  6 lines. Sample: `node tools/fetch-references.js competitors` →
  `.refs/competitors/provider-index.ts`

---

## Pitfalls hit on this machine

| Pitfall | Workaround |
|---|---|
| `web_search` / `web_fetch` fail with "Every engine failed" or "resolves to a non-public IP" | DNS is fake-ip (198.18.x.x). Use the Node scripts in `tools/`, which go through a local proxy CONNECT tunnel on `127.0.0.1:7897` |
| Direct connections to `registry.npmjs.org` etc. fail | Same proxy tunnel |
| `curl` reports `schannel: SEC_E_NO_CREDENTIALS` | The sandbox cannot acquire certificate credentials; use Node, which has its own TLS stack |
| `node -e "..."` breaks under PowerShell quoting | Write the script to a `.js` file and run that |
| **`gh search code` mangles a phrase containing `-S`** (it treats it as a flag) | Use `gh api "search/code?q=<url-encoded>"` instead |
| **A downloaded third-party repository's own `AGENTS.md` gets auto-loaded as instructions** | Real, hit while reading a competitor's checkout. **Keep third-party sources in `.scratch/`** (gitignored) and do not run commands inside them |
| **`Get-Content` / `Set-Content` without `-Encoding UTF8` reads UTF-8 Chinese as the system codepage and corrupts the file** | Destroyed an uncommitted source file outright. **Always pass `-Encoding UTF8`** for files containing non-ASCII, or use a file-editing tool rather than the shell |
| `node --test <directory>` is treated as a file path on Node 24 | Use plain `node --test` (auto-discovery) in `package.json`, not a directory argument |
| `"type": "module"` at the repo root silently breaks CommonJS scripts in subdirectories | Scope them with their own `package.json` declaring `"type": "commonjs"` — see `tools/package.json` and `bench/package.json` |
| PowerShell's `>` redirect writes UTF-16, producing JSON that will not parse | `\| Set-Content -Encoding UTF8` when capturing command output |
| **`Set-Content -Encoding UTF8` still writes a BOM in Windows PowerShell 5.1** | The file is fine everywhere else, but `gh api --input` rejects it with "Problems parsing JSON" (HTTP 400). Write JSON bodies with `[System.IO.File]::WriteAllText($path, $body, (New-Object System.Text.UTF8Encoding($false)))` — no BOM |
| **A jq filter containing `\|` gets split by this shell tool's pipeline parsing** | Use pipe-free expressions (e.g. `--jq '.names'` instead of `'.names \| join(", ")'`) |
| **`core.autocrlf=true` with no `.gitattributes` gives a CRLF checkout while the repository stores LF** | Committed content is unaffected, but byte-level checks (file size, SHA-256, a diff against an upstream original) then report differences that do not exist. Hit while byte-checking `LICENSE` against the canonical Apache text, which produced a phantom 202-byte difference. Fixed by the `.gitattributes` at the repository root |
| **A "corrupted" test fixture that silently failed to mutate** | The checker correctly reported VERIFIED, because the file was byte-identical to the control. Assert that every negative fixture actually differs from the control before trusting any result that comes out of it |
| **A control byte in a git argv does not survive the Windows command-line round trip** | Measured while writing the issue #2 regressions: a BEL reached git as `?`, and an ESC-bearing argument got different semantics entirely (exit 0, no error). A hostile-argv test against real git therefore cannot assert the escape form cross-platform — assert the portable property (no raw control byte in the output) against git, and the exact escape form against the pure message builder (`gitFailureMessage`) |
| **euthyna 的 CLI 在沙箱 pwsh 里跑必失败** | 沙箱拒绝 Node 起 git 子进程（piped stdio 的 EPERM，见上）后，`repoToplevel` 静默返回空，CLI 报 exit 2「不在任何 git 仓库」——看起来像目标仓库问题，其实是沙箱问题。一律用侧边栏嵌入式终端跑 `node D:\euthyna\bin\euthyna.js ...` |

---

## Repository map

| Path | What it is |
|---|---|
| `bin/` + `src/` | **Fact producers** (zero-dependency Node CLI). `src/contract.js` is the contract in code; `src/facts/history.js` and `src/facts/coverage.js` are the two measurements. `coverage.js` reads **both** c8/V8 JSON and coverage.py JSON (format 3) |
| `test/` | 92 tests via `node --test`, no third-party framework. **The history tests build real git repositories rather than mocking**; the coverage tests carry fixtures shaped like both c8 and coverage.py output; the contract tests carry the shell-quoting and render-boundary regressions from PR #1; `git.test.js` carries the error-path quoting and stderr-sanitization regressions from issue #2 |
| `.agents/skills/euthyna/` | **The skill.** Doubles as source and as a project skill root (rank 200), so it is live in this workspace without a restart |
| `bench/` | **The recall benchmark.** `exploits.js` establishes ground truth by execution (18 cases, 8 near-neighbour pairs); `prepare-blind.js` produces answer-free copies with per-round shuffled ids; `collect-verdicts.js` machine-validates reports and extracts verdicts without the orchestrator reading report bodies; `score.js` computes the confusion matrix and the pair view. Results: `bench/RESULTS.md` (round 1), `bench/RESULTS-round2.md` (round 2: three independent runs per case, zero flips), `bench/RESULTS-round3.md` (round 3: 18 cases, 54 adjudications, two fixture defects caught by adjudicators), `bench/RESULTS-round4.md` (round 4: 54/54, p6b v3 confirmed by first blind adjudication, cross-model run executed — zero flips across two model families); protocols in `bench/README.md`, design pre-registrations in `bench/DESIGN-round3.md` and `bench/DESIGN-round4.md` |
| `docs/positioning.md` + `-zh` | Competitive analysis across the DSH catalog, including three claims that were tested and refuted |
| `docs/fact-contract.md` + `-zh` | The measurement ↔ adjudication interface. The project's core design artefact |
| `docs/dsh-stop-gate.md` + `-zh` | Hook-gate facts, with reproduction |
| `docs/case-study-axe-core.md` + `-zh` | Validation run #1: JavaScript (axe-core), 5/5 coarse-screen candidates refuted at the gates |
| `docs/case-study-crewai.md` + `-zh` | Validation run #2: Python (crewAI). **Proved the Python claim**: `history` works on Python repos, and the coverage producer was extended to read coverage.py JSON. 3 candidates → 2 FP + 1 INCONCLUSIVE (pickle, supply-chain-dependent) |
| `audits/` | **Audit reports, one per run, local-only** (never written into the target repository, and deliberately **not committed** here — the public form is `docs/case-study-*.md`). See `audits/CREWAI_EUTHYNA_AUDIT_2026-09-20.md` (gitignored) |
| `tools/fetch-references.js` | Fetches upstream sources on demand into `.refs/` (gitignored). **The repo distributes no third-party files** |
| `tools/check-license-text.mjs` | Verifies `LICENSE` against the canonical Apache-2.0 text, fetched live. **The licence claim is checkable rather than asserted** |
| `.gitattributes` | Pins LF in checkouts so byte-level checks mean the same thing on every platform |
| `.github/workflows/ci.yml` | CI: test matrix (Linux/Windows × Node 20/22/24) plus the live licence check. **The bench harness is deliberately not run here** — several cases verify bsdtar-specific semantics that GNU tar does not share |
| `CONTRIBUTING.md` | The house rules in their public form |
| `SECURITY.md` | Reporting policy and scope; notes that the bench fixtures are vulnerable by construction |
| `.github/ISSUE_TEMPLATE/` | Issue forms: bug report / feature proposal / benchmark case proposal. The privacy guidance tells reporters to build synthetic fixtures and redact author names, commit messages, and local paths — `history` output and `coverage-final.json` both carry them |
| `data/dsh-plugins.json` | Snapshot of 3931 DSH plugins (`updated=2026-09-18`) |
| `assets/euthyna.png` | README logo, 512×512 (the original 1254×1254 stays out of the repository) |
| `.scratch/` | Scratch: downloaded sources and intermediate output (gitignored) |

---

## Licensing

Apache-2.0. See `LICENSE` and `NOTICE.md`.

**No third-party files are distributed in this repository.** Upstream sources are fetched on
demand. The distinction that matters, and that an early version of this project got wrong:

| What you did | Same licence required? |
|---|---|
| Read it, understood the method, re-expressed it in your own structure | ❌ No |
| **Translated it**, or rewrote it paragraph by paragraph | ✅ **Yes** |
| Copied the files in | ✅ Yes |

The second row is not about modifying *code* — it is about whether your text grew out of
theirs. CC BY-SA defines Adapted Material to include material that has been "translated".
Everything under `.agents/skills/euthyna/references/` is written as original prose; if you add
to it, keep it that way, or the licence claim becomes false.

### The licence text is verified, not assumed

A licence file that has been edited — even by one line — is no longer the licence it names, so
this one is checked rather than asserted:

```powershell
node tools/check-license-text.mjs      # or: npm run check:license
```

Exit `0` means the text matches the canonical Apache-2.0 licence on every line except the
appendix copyright line, which this project fills in. `1` means it differs (the differing lines
are printed). `2` means upstream could not be fetched — **not** a pass.

#### ⚠️ A conclusion this project got wrong

`LICENSE` began with a blank line. An assumption was made that this was an artefact of
downloading the file, and the line was removed. **It is not an artefact — the canonical Apache
text begins with a blank line.** The change was reverted before it was committed.

What caught it was arithmetic that did not close: the file was predicted to shrink by one byte
and shrank by eight. Fetching the upstream text and comparing line by line showed the only real
difference is line 190, the copyright placeholder described above.

The lesson generalises: the blank line looked like noise precisely because nothing depended on
it, which is the category of change that is never noticed and never corrected.
