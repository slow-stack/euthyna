# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` (0.1.x) | yes |

There are no tagged releases yet; `main` is the only supported line. Once
releases begin, fixes target the latest minor; older lines get critical fixes
only, on a best-effort basis.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** — on this repository, open
the *Security* tab and choose *Report a vulnerability* — or email
`work@modusensus.space`. Please do not open a public issue for a suspected
vulnerability.

A report is most useful when it includes:

- what you ran (command line, commit range, coverage file),
- what you expected the tool to report, and what it reported instead,
- a reproduction — a fixture repository or a diff that triggers the behaviour.

A report must come from actually running the tool against real input.
Mass-submitted or fabricated reports are closed. A report missing the
reproduction above may be closed with a request to complete it — comment with
the missing detail to reopen.

## What happens next

| Phase | Target |
|---|---|
| Acknowledgment | within 48 hours, best-effort |
| Assessment | within 7 days; we validate severity and may ask for more detail |
| Fix | severity-dependent; the timeline is agreed in the private thread |
| Disclosure | coordinated — a fix and a security advisory are published together |

If you have not received an acknowledgment within 48 hours, follow up: comment
in the advisory thread, or resend to `work@modusensus.space` with the subject
prefix `[SECURITY][FOLLOW-UP]` and the original report timestamp.

Severity follows [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document):
Critical (9.0–10.0), High (7.0–8.9), Medium (4.0–6.9), Low (0.1–3.9).

Disclosure is coordinated: we do not publish details before a fix is ready, we
credit the reporter by name or anonymously (your choice), and we do not pursue
legal action against researchers acting in good faith. This project offers no
bug bounty.

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
- Best-practice hardening suggestions with no demonstrable defect.
- Reports without a reproduction.

## What is already done, structurally

- **Zero runtime dependencies.** There is no dependency chain to audit beyond
  this repository itself; nothing in the install path fetches or executes
  third-party code. The only runtime surface is Node itself (>= 20).
- **No network from the CLI.** The fact producers read repositories and coverage
  files locally and make no network requests. (`tools/check-license-text.mjs`
  fetches the canonical licence text live, for verification only.)
- **No secrets surface.** The tool stores no credentials and has no telemetry.
- **Exit codes distinguish "clean" from "could not measure".** Exit `2` means
  the fact could not be established — never read it as a pass.
- The **licence file is verified against the canonical Apache-2.0 text**, fetched
  live (`tools/check-license-text.mjs`), rather than asserted.
- The **test suite builds real git repositories** rather than mocking git.

These reduce surface; they are not a claim of correctness.

## Security-relevant contributions

Security-relevant changes to the fact producers or the adjudication gates are
reviewed by the maintainers and require reproduction steps and regression
evidence, like any behavioural change. Do not silently merge a fix for a
vulnerability you found while working here — report it through this policy's
private channel as well, so the fix and the advisory are released together.
