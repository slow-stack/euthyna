# Contributing to euthyna

Thanks for looking at this repository. This project holds itself to a working
discipline and asks contributors to hold it too — the rules below are the ones
the project uses on itself, not ceremony.

## The rules

- **No AI attribution in commits.** No `Co-Authored-By`, no "Generated with", no
  tool signatures. This is a hard rule, not a preference.
- **One change, one commit.**
- **Do not claim something works until you have run it.** If you say a test
  passes, paste the output. "Should be fine" is not a result.
- **Distinguish measured from inferred from assumed.** When you cannot verify
  something, say so. The documents in `docs/` and `bench/` carry an explicit
  limitations section; keep that up when you edit them.
- **Record disproved conclusions rather than deleting them.** Things that turned
  out to be wrong stay recorded (see `bench/RESULTS.md`), so the next person
  does not repeat them.

## Setup

- Node >= 20 and git. Nothing else.
- There is nothing to install: the project is deliberately **zero-dependency**.
  A fact producer that an audit depends on should not itself need a
  supply-chain review.

```sh
npm test                     # the full suite; the history tests build real git repositories, not mocks
npm run check:license        # verifies LICENSE against the canonical Apache-2.0 text, fetched live
node bin/euthyna.js history --repo <path> --base main --head HEAD
```

CI runs the same suite on Linux and Windows across the supported Node versions,
plus the licence check. Exit code `2` from the licence check means upstream
could not be fetched — that is **not** a pass.

## Conventions

### Dependencies

Adding a third-party dependency requires auditing its source first and stating
the justification in the pull request. This is enforced by review, not by tooling.

### Documentation

- Every document in `docs/` exists twice: the `-zh` file is the original, the
  unsuffixed file is its English translation. `README.md` is English only.
- Public text states facts and decisions only — no internal questions, no
  "let me know what you think".
- When a claim is hedged, keep the hedging. It is usually load-bearing.
- No third-party files are distributed in this repository; upstream sources are
  fetched on demand into `.refs/` (gitignored). Material added under
  `.agents/skills/euthyna/references/` must be original prose — a translation
  or a close paraphrase would make the licence claim false.

### The benchmark

A new case in `bench/` needs a deterministic exploit that establishes ground
truth by execution (`bench/exploits.js`). A case that cannot produce one does
not enter the set — this rule has actually rejected a candidate. Cases come in
*near-neighbour pairs* (same claim, one guard apart) so that a verdict has to
come from reading the guard, not recognising the shape.

## Pull requests

Small and focused beats large and general. CI must be green, and the
description should say what you ran and what it printed. If a change touches
the adjudication gates or the benchmark protocol, say so explicitly — those are
the parts where the project's guarantees live.

## Working with AI coding agents?

`AGENTS.md` at the repository root is written for agents working on this
project. It records verified host facts, past pitfalls, and conclusions that
were later disproved, so that an agent does not redo settled research. If you
work through an agent, let it read that file first.
