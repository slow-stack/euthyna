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
  Publish-prep commit `783a494`; CI `35568417444` green — that run is the `CI`
  workflow for the publish-prep commit, **not** a publish run; registry shasum
  `95d2573a08…` byte-identical to the locally smoke-tested tarball. Tag `v0.1.0`
  and its [release](https://github.com/slow-stack/euthyna/releases/tag/v0.1.0)
  followed the same day. The upload itself was manual, approved with an
  interactive 2FA challenge — see the `EOTP` entry below.
- `euthyna@0.1.1` published 2026-09-21 the same way: manual upload (tarball
  shasum `5f568d0321f37df10e938beea04ef7c99531b270`), tag run `35621228533`
  green (suite + `npm whoami` passed; the upload was skipped as
  already-published), GitHub release cut by hand.
- 🧪 Releases run through `.github/workflows/publish.yml`: pushing a `v*` tag
  (the tag must match `package.json`) runs the suite and publishes with
  `--provenance` through trusted publishing (OIDC); a version already on the
  registry is skipped by the gate instead of failing the run. There is no npm
  token anymore: the repository's `NPM_TOKEN` secret was deleted 2026-09-21.
- ⚠️ **`EOTP` — the token cannot publish. A conclusion this project got wrong.**
  An earlier claim here was that the token exists so a release does not need the
  account owner's browser for the 2FA approval. Measured 2026-09-21 on `v0.1.1`:
  the workflow reaches the registry and then fails with `EOTP` —
  *"npm tokens that bypass 2FA are being restricted for account changes and
  direct publishing"*. npm's
  [2026-07-31 changelog](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)
  restricts bypass-2FA tokens for account/org/package management and targets
  January 2027 for removing token-based direct publishing; the follow-up
  [2026-09-18 stage-only tokens](https://github.blog/changelog/2026-09-18-stage-only-npm-tokens-for-safer-automation)
  are opt-in and do not change existing tokens. Two consequences to know before
  touching a release: a manual upload carries **no provenance attestation**
  (`https://registry.npmjs.org/-/npm/v1/attestations/euthyna@0.1.1` → 404), and
  because the release step is gated on `already-published != true`, **the
  workflow skips the GitHub release too** — after a manual publish, cut it with
  `gh release create`. Migration path: trusted publishing (OIDC), which this
  workflow is already shaped for (`id-token: write`, GitHub-hosted runner);
  npmjs.com → the package → Settings → Publishing access → add a GitHub Actions
  publisher for `publish.yml`. A configuration created after 2026-09-03 allows
  only `npm stage publish` unless direct `npm publish` is selected explicitly.
- 🧪 **OIDC diagnosis, measured 2026-09-21.** `actions/setup-node@v4` with
  `registry-url` set reads the repository's `NPM_TOKEN` secret, writes it into a
  temp `.npmrc` and exports it as `NODE_AUTH_TOKEN`: the token reappeared in
  every step's environment even after the workflow stopped referencing it, and
  disappeared only after the secret was deleted. npm's OIDC exchange
  (`POST /-/npm/v1/oidc/token/exchange/package/<name>`, `lib/utils/oidc.js:120`)
  fails with `OIDC token exchange error - package not found` when no trusted
  publisher is configured, and only reports the reason at `--loglevel=verbose`
  (`oidc.js:126`) — the visible failure is then a misleading `E404` on the PUT
  (token present), `ENEEDAUTH` (no token, no `registry-url`), or `E404` again
  (no token, `registry-url` set). The fix is entirely on npmjs.com: the
  package's Settings → Publishing access must list this workflow (`publish.yml`)
  as a GitHub Actions publisher, with direct `npm publish` allowed.
- 🧪 The workflow cuts the GitHub release from a versioned template
  (`.github/release-notes-template.md`, a `{{version}}` placeholder is
  substituted at publish time): every release carries one fixed format, and
  format changes are reviewed like any other file. The manual `workflow_dispatch`
  rehearsal renders the notes for inspection without uploading or releasing —
  run `35577551209` (commit `1e65d0a`) rendered the template with `0.1.0`
  substituted; the release itself is created only on a `v*` tag push, titled
  `euthyna <version>`. `v0.1.0`'s release predates the template and keeps its
  hand-written notes; `v0.1.1`'s was created with `gh release create` from a
  template render whose publish bullet was corrected by hand, because the
  workflow skipped the release (see the `EOTP` entry above).
- 🧪 Set the secret through the GitHub web UI. `gh secret set` with its hidden
  paste prompt stored an **empty** value twice on this machine's embedded
  terminal (the browser field works); the workflow's `npm whoami` step is what
  catches an empty or invalid token before anything ships.
- 🧪 Local npm still needs the proxy env, **with the scheme**: `HTTPS_PROXY` /
  `HTTP_PROXY` = `http://127.0.0.1:7897`. The bare `127.0.0.1:7897` form makes
  `npm publish` die with `ERR_INVALID_URL` inside `@npmcli/agent`'s
  `new URL(proxy)` (`lib/proxy.js:81`) — measured 2026-09-21; `npm view`
  tolerates the bare form, `npm publish` does not.
- 🧪 The working manual publish path on this machine: run `npm publish` in the
  sidebar's embedded terminal with the proxy env above. It packs, prints
  `Authenticate your account at: https://www.npmjs.com/auth/cli/<id>`, and
  completes once the owner approves in the browser. The masked-URL `EOTP`
  variant appears when stdout is not a TTY: npm's `otplease` checks
  `process.stdin.isTTY && process.stdout.isTTY` (`lib/utils/auth.js:10`) and
  otherwise throws with the URL redacted — so pipe the output only after the
  interactive step has finished. This is how `0.1.0` and `0.1.1` were
  published; the release is then cut with `gh release create`.

### Skill contract

Measured against `@deepseek-ai/dsh-skill-filesystem` **0.1.5-rc.2** on this machine
(`lib/index.js:676-703` parses a file, `:833-865` reads the invocation policy). Frontmatter
keys the provider actually reads:

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, else the file is ignored |
| `description` | yes | a missing name or description logs `frontmatter requires name and description` and skips the file |
| `whenToUse` | no | passed through as a string |
| `metadata` | no | passed through |
| `disable-model-invocation` | no | `true` → `modelInvocable: false`. **Top level, kebab-case** |
| `user-invocable` | no | `false` → `userInvocable: false`; default true |

- **There is no `invocation:` mapping reader.** A nested block parses, logs nothing, and is
  ignored. Rejected legacy top-level spellings: `disableModelInvocation`, `modelInvocable`,
  `userInvocable` — each throws (`frontmatter field "X" is unsupported; use "Y"`), which
  aborts the parse and logs `skill file <path> ignored: invalid invocation frontmatter`.
- Defaults when the two policy keys are absent: `{ modelInvocable: true, userInvocable: true }`.
- **Claude Code's `allowed-tools` is not recognised** — strip it when porting a skill from
  elsewhere.

#### ⚠️ A conclusion this project got wrong

This section used to say the frontmatter recognises `invocation` as one of five fields and
that it controls `modelInvocable` / `userInvocable`. Both halves were wrong, and the way they
were wrong is the useful part: the skill declared

```yaml
invocation:
  modelInvocable: false
  userInvocable: true
```

which **is not read by anything**. No error, no warning — the keys sit inside `data.invocation`
while the reader looks at `data['disable-model-invocation']` at the top level, so the policy
silently defaulted to model-invocable: the opposite of what the file said, for as long as the
file said it.

What caught it was driving the real provider instead of reading the file — `apply()` +
`provider.get()` reported `{"modelInvocable":true,"userInvocable":true}`, and
`test/skill.test.js` now pins the canonical keys. A declaration that nothing parses is worse
than a missing one, because it reads as a decision.

### Skill discovery paths (lower number wins; project can override global)

Source: `@deepseek-ai/dsh-skill-filesystem` 0.1.5-rc.2 — the ranks are the constants at
`lib/index.js:21-25`, consumed by the provider's `roots()`.

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
- **What makes a package installable** (measured 2026-09-21, against the shop front's own
  rules in `awesome-dsh-plugin/contributing.md` and `dshmarket`'s checker):

  ```jsonc
  "main": "./plugin/index.js",                        // the host resolves the package name here
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
  ```

  and beside it a `cordis.patch.yml` that inserts the package by name:

  ```yaml
  - insert:
      - id: euthyna
        name: 'euthyna'
  ```

  🧪 `dshmarket` reports `bundle declares no dsh.bundle.patch — the profile will fail to boot`
  (`src/check.ts:944`), and a package with only `dsh.client` counts as client-only
  (`src/verify.ts:232`). The front's CI reads `dsh.bundle` straight from `package.json`
  (root, or a `packages/` · `plugins/` · `apps/` subpackage).
- **A skill-pack plugin is ~20 lines**: export `name`, `inject: ['skills']`, and
  `apply(ctx, config)` → `ctx.skills.registerProvider(control => new FileSystemSkillProvider(
  ctx, control, { providerName, includeDefaultRoots: false, customSkillDirs: [root], watch: false }))`.
  `includeDefaultRoots: false` keeps the bundle's provider to its own root, so installing it
  adds a skill instead of replacing the user's catalogue. Working reference:
  `PerryLink/dsh-skill-pack-security`'s provider in `.refs/competitors/provider-index.ts`.
- 🧪 **`npm pack` does include an explicitly listed dot-directory.** With
  `.agents/skills/euthyna/` in `files`, the tarball carries `SKILL.md` plus its seven
  references (23 files in total, measured). That is what lets **one** canonical skill location
  be both this repository's project skill root and the packaged payload — there is no second
  copy to keep in sync.
- 🧪 The provider is imported, not reimplemented: this package declares
  `@deepseek-ai/dsh-skill-filesystem` as an **optional** peer, so `npm install -g euthyna`
  still pulls nothing while the plugin half resolves the harness's own copy at runtime.
- 🧪 Official `@deepseek-ai/*` packages are peerDependencies and their ranges need **one
  prerelease branch per version tuple**: `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 ||
  >=0.1.6-0 <0.2.0` is the convention in `dsh-skill-pack-security`. node-semver admits a
  prerelease only when some comparator shares its tuple *and* itself carries a prerelease tag,
  so a single `^0.1.5-rc.2` silently excludes `0.1.6-rc.*` and the user meets an `ERESOLVE`.
- 🧪 Reproduce the mount without installing a profile: `node .scratch/probe-plugin.mjs` (needs
  an installed DSH — reach it by junctioning the app's `node_modules` into the repo, which
  `.gitignore` already covers). It calls `apply()` with a minimal ctx and drives the **real**
  provider against the packaged root. That probe is how the invocation-policy bug above was
  found: reading the file would never have caught it.

---

## Pitfalls hit on this machine

| Pitfall | Workaround |
|---|---|
| `web_search` / `web_fetch` fail with "Every engine failed" or "resolves to a non-public IP" | DNS is fake-ip (198.18.x.x). Use the Node scripts in `tools/`, which go through a local proxy CONNECT tunnel on `127.0.0.1:7897` |
| Direct connections to `registry.npmjs.org` etc. fail | Same proxy tunnel |
| **A bare `host:port` in `HTTPS_PROXY`/`HTTP_PROXY` breaks `npm publish` with `ERR_INVALID_URL`** | 🧪 Measured 2026-09-21: `@npmcli/agent` builds the proxy URL with `new URL(proxy)` (`lib/proxy.js:81`), which rejects `127.0.0.1:7897`. Use `http://127.0.0.1:7897`. `npm view` tolerates the bare form; `npm publish` does not |
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
| **Deleting `TEMP` from the env handed to a child does not remove it in the child** | 🧪 Measured while writing the issue #7 regressions: after the parent deleted `TEMP`/`TMP`/`TMPDIR` from the env object passed to `execFileSync`, the child still reported `'TEMP' in process.env === true` and `os.tmpdir()` equal to the real user temp (`TMP`/`TMPDIR` did stay absent). Setting them to `''` **does** propagate, and `os.tmpdir()` skips an empty value and falls back to an absolute default — so a test that needs "no temp variable" must set them empty rather than delete them, or assert the property on a pure helper instead (see `bench/results-dir.js` and its unit test in `test/bench.test.js`) |

---

## Repository map

| Path | What it is |
|---|---|
| `bin/` + `src/` | **Fact producers** (zero-dependency Node CLI). `src/contract.js` is the contract in code; `src/facts/history.js`, `src/facts/coverage.js` and `src/facts/deps.js` are the three measurements (`history` has `--origins` to chase the first introducer and classifies by message + deleted-line + diff; `coverage.js` reads **both** c8/V8 JSON and coverage.py JSON (format 3); `deps.js` reads package-lock.json / Cargo.lock / go.mod). `src/gate.js` is the six-gate report validator behind `euthyna gate <报告> [--verify] [--allow-exec]` — it parses the skill's 裁定格式, downgrades findings that lack evidence/reproduce or contradict their verdict, and executes nothing but `git` unless the caller consents to interpreters |
| `test/` | 178 tests via `node --test`, no third-party framework. **The history tests build real git repositories rather than mocking**; the coverage tests carry fixtures shaped like both c8 and coverage.py output; the deps tests carry fixture lockfiles (npm v1/v2/v3, Cargo.lock, go.mod); the contract tests carry the shell-quoting and render-boundary regressions from PR #1; `git.test.js` carries the error-path quoting and stderr-sanitization regressions from issue #2; `gate.test.js` pins the six-gate validator (including that `--verify` does not run an interpreter command without `--allow-exec`); `skill.test.js` pins the written discipline (the six gates, the three verdicts, the `euthyna gate` reference) so weakening the skill turns CI red; `plugin.test.js` pins the dsh bundle manifest, patch and entry |
| `.agents/skills/euthyna/` | **The skill.** Doubles as source and as a project skill root (rank 200), so it is live in this workspace without a restart |
| `bench/` | **The recall benchmark.** `exploits.js` establishes ground truth by execution (18 cases, 8 near-neighbour pairs); `prepare-blind.js` produces answer-free copies with per-round shuffled ids; `adjudicate.js` closes the loop end to end (blind tree → one adjudicator process per case → `collect-verdicts.js` machine validation → `score.js`), with a deterministic `golden` mode (ground truth written into reports — plumbing self-check only, never a real round) for CI; `collect-verdicts.js` machine-validates reports and extracts verdicts without the orchestrator reading report bodies; `score.js` computes the confusion matrix and the pair view; `perf.js` is the `history` scaling baseline. The verified-platform matrix (bsdtar vs GNU tar, p6 skip) lives in `bench/README.md`. Results: `bench/RESULTS.md` (round 1), `bench/RESULTS-round2.md` (round 2: three independent runs per case, zero flips), `bench/RESULTS-round3.md` (round 3: 18 cases, 54 adjudications, two fixture defects caught by adjudicators), `bench/RESULTS-round4.md` (round 4: 54/54, p6b v3 confirmed by first blind adjudication, cross-model run executed — zero flips across two model families); protocols in `bench/README.md`, design pre-registrations in `bench/DESIGN-round3.md` and `bench/DESIGN-round4.md` |
| `docs/positioning.md` + `-zh` | Competitive analysis across the DSH catalog, including three claims that were tested and refuted |
| `docs/fact-contract.md` + `-zh` | The measurement ↔ adjudication interface. The project's core design artefact |
| `docs/dsh-stop-gate.md` + `-zh` | Hook-gate facts, with reproduction |
| `docs/case-study-axe-core.md` + `-zh` | Validation run #1: JavaScript (axe-core), 5/5 coarse-screen candidates refuted at the gates |
| `docs/case-study-crewai.md` + `-zh` | Validation run #2: Python (crewAI). **Proved the Python claim**: `history` works on Python repos, and the coverage producer was extended to read coverage.py JSON. 3 candidates → 2 FP + 1 INCONCLUSIVE (pickle, supply-chain-dependent) |
| `audits/` | **Audit reports, one per run, local-only** (never written into the target repository, and deliberately **not committed** here — the public form is `docs/case-study-*.md`). See `audits/CREWAI_EUTHYNA_AUDIT_2026-09-20.md` (gitignored) |
| `tools/fetch-references.js` | Fetches upstream sources on demand into `.refs/` (gitignored). **The repo distributes no third-party files** |
| `tools/check-license-text.mjs` | Verifies `LICENSE` against the canonical Apache-2.0 text, fetched live. **The licence claim is checkable rather than asserted** |
| `.gitattributes` | Pins LF in checkouts so byte-level checks mean the same thing on every platform |
| `.github/workflows/ci.yml` | CI: test matrix (Linux/Windows × Node 20/22/24), the live licence check, and a `bench-loop` job running the deterministic golden adjudication round (`bench/adjudicate.js --adjudicator golden`). **The exploit ground-truth harness is deliberately not run on Linux** — several cases verify bsdtar-specific semantics that GNU tar does not share (it reports itself as skipped there; Windows jobs run it in full) |
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
