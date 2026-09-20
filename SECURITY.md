# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` (0.1.x) | yes |

There are no tagged releases yet. The `main` branch is the only supported line.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: on this repository, open the
*Security* tab and choose *Report a vulnerability*. Please do not open a public
issue for a suspected vulnerability.

A report is most useful when it includes:

- what you ran (command line, commit range, coverage file),
- what you expected the tool to report, and what it reported instead,
- a reproduction — a fixture repository or a diff that triggers the behaviour.

## Scope

### In scope

- **`bin/` and `src/` — the CLI and the fact producers.** They execute `git`
  against user-supplied repositories and parse coverage files produced by other
  tools. Command injection through crafted input, path traversal, unsafe
  extraction of archived data, and similar are in scope.
- **Fact integrity.** This is the one that matters most here. A producer that
  reports a wrong number — attributing a deleted line to the wrong commit,
  reporting a symbol as covered when no test executed it — is a security bug in
  this project's own terms. The tool exists so that its output can be trusted;
  a way to make it lie is the vulnerability class it most wants to hear about.
- **`tools/` and the `bench/` harness**, which fetch and run against upstream
  sources.

### Out of scope

- **The bench fixtures (`bench/cases/`).** They are deliberately vulnerable by
  construction — that is how recall is measured. Do not report them.
- The DSH host, Claude Code, Codex, or any harness the skill is loaded into.
- The codebases the tool is run *against* (for example the axe-core case study
  in `docs/`).
- Reports without a reproduction.

## What is already done, structurally

- **Zero runtime dependencies** — nothing in the install chain to audit beyond
  this repository itself.
- The **licence file is verified against the canonical Apache-2.0 text**, fetched
  live (`tools/check-license-text.mjs`), rather than asserted.
- The **test suite builds real git repositories** rather than mocking git.

These reduce surface; they are not a claim of correctness.

## Response

Acknowledgement is best-effort within 7 days, followed by an assessment of the
report and a fix timeline agreed in the private thread. Disclosure is
coordinated: publish when a fix is available, with credit by name or
anonymously — your choice.
