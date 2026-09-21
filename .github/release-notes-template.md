## euthyna {{version}}

euthyna is a code security audit framework for AI coding agents. It is not a
scanner: it produces the facts an agent cannot compute by reading code — the git
origin of every line a change deletes, and whether a changed symbol was ever
invoked by a test — and it forces every security claim through adjudication
gates before it counts as a finding.

## Install

```sh
npm install -g euthyna@{{version}}
euthyna history --repo <path> --base main
```

## Notes

- Zero runtime dependencies by design: a fact producer an audit depends on
  should not itself need a supply-chain review.
- The CLI's report text is currently Chinese; the audit discipline (the skill)
  is host-agnostic Markdown.
- Published by the release workflow: the test suite ran, the publishing token
  was verified, and the npm upload carries a provenance attestation.
- See the [README](https://github.com/slow-stack/euthyna#readme) and the
  [docs](https://github.com/slow-stack/euthyna/tree/main/docs) for the fact
  contract, the case studies, and the benchmark protocol.
