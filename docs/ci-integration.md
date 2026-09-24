# Running euthyna as a PR gate (GitHub Actions)

English · [中文](ci-integration-zh.md)

> **What this document is**: a copy-paste recipe for gating a pull request on `euthyna audit`,
> plus what each exit code means when the gate goes red. It uses only the exit-code contract the
> CLI already publishes — no flags are interpreted, no report is parsed.
>
> **Limitations**: the history producer reads git, so it needs `fetch-depth: 0` (or at least
> `--base` reachable). The dependency producer reads lockfiles; it answers what the manifest
> pins, not whether a pinned version has a CVE — that adjudication is left to the agent layer,
> by design (see [`fact-contract.md`](fact-contract.md) §6.3).

## The gate, one step

Put this in the repository that wants the gate, as `.github/workflows/audit.yml`:

```yaml
name: euthyna audit

on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # history attribution walks real git objects
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Change-surface audit (deleted-code provenance + dependency pins)
        run: npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD
```

That is the whole gate. Read the exit code the way the CLI publishes it:

| Exit | Meaning in a PR gate | What the merge button should do |
|---|---|---|
| `0` | Measured, nothing security-classified found | Merge freely |
| `10` | Measured; at least one fact is security-classified (deleted code from a security fix, a reintroduction under `--pickaxe`) | A human reads the report before merging — this is the intended stop, not a bug |
| `1` | Usage error (bad `--base`, wrong flag) | Fix the workflow, not the PR |
| `2` | Could not measure at all (no lockfile is *not* this — missing data is reported, not fatal) | **Never merge on `2`**; "failed to measure" is not "clean" |

Because GitHub treats any non-zero exit as a failed step, `0` shows green and `10`, `1`, `2` all
show red. If you want `10` (something found) to show green-but-commented instead, capture and
translate:

```yaml
      - name: Change-surface audit (deleted-code provenance + dependency pins)
        run: |
          npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD
        continue-on-error: true
        id: audit
      - name: Enforce the contract (0 and 10 pass — 10 is for human review; 1 and 2 fail)
        if: always()
        run: |
          code=${{ steps.audit.outcome == 'success' && 0 || steps.audit.outputs.exit_code }}
          if [ "$code" -eq 0 ] || [ "$code" -eq 10 ]; then exit 0; fi
          echo "euthyna audit failed: exit $code (1 = usage error, fix the workflow; 2 = could not measure, never treat as clean). See the step above." >&2
          exit 1
```

The audit step must publish its own exit code or the enforcement step cannot tell `10`
from `1`/`2`; `outcome` collapses all non-zero results into one "failed" boolean. The
publishing form:

```yaml
      - name: Change-surface audit (deleted-code provenance + dependency pins)
        run: |
          npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD
          echo "exit_code=$?" >> "$GITHUB_OUTPUT"
        id: audit
```

(`continue-on-error` still swallows nothing here — the step records the code first, and a
failure outcome with `outputs.exit_code=10` is exactly the "flagged, don't block" case.)
Note `exit 10` from a `run:` step fails the step but keeps the code readable in
`outputs`, so nothing is lost.

`ponytail:` the two-step form re-implements the exit contract in shell; the one-step form
is the honest gate. Use the two-step form only when `10` must not block merges.

## Reading the report in the PR

The run prints the human-readable report to the step log. To attach it to the PR instead:

```yaml
      - name: Change-surface audit
        run: |
          set -o pipefail
          npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD \
            | tee audit-report.txt
        continue-on-error: true
        id: audit
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: euthyna-audit-report
          path: audit-report.txt
```

Without `pipefail`, the step's status is `tee`'s (always 0), so a `1`/`2`/`10` from the
audit would turn the gate green. Actions' default shell is `bash -e`, which does **not**
imply `pipefail`, hence the explicit `set -o pipefail` line.

Add `--json` and point the artifact at the JSON file when a downstream consumer (a comment bot,
an adjudicator agent) should read facts rather than prose.

## What the gate does and does not answer

- **Does**: which deleted lines in this PR come from commits classified `security` or `fix`
  (origins on by default — the first introducer, not the last modifier), which lockfile
  dependencies the manifest pins and where.
- **Does not**: decide whether anything is a vulnerability. `10` means *there is material for
  adjudication*; the six-gate verdict happens in the agent layer (`euthyna gate`), which this
  workflow deliberately does not run — a workflow cannot produce the evidence discipline the
  gates demand, and pretending otherwise would manufacture verdicts.

## Notes

- `--pickaxe` adds reintroduced-line detection at a cost of one `git log -S` probe per deleted
  line (capped); enable it when regressions-of-fixed-code are the threat model.
- `github.base_ref` is the PR's target branch, so `origin/main` is the right `--base` for the
  usual case; a stack of PRs needs the real fork point instead.
- `npx euthyna@latest` pins nothing; a gate that drifts with npm's `latest` tag is a gate whose
  verdicts are not comparable across time. Pin it (`euthyna@0.5.0`) when consistency matters.
