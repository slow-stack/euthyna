# Case study: a euthyna validation run on act (2026-10-08)

English · [中文](case-study-act-zh.md)

> **What this document is**: it records a **method validation run** of euthyna — the
> deterministic measurements (`history`, `deps`) and the six-gate adjudication discipline,
> executed against a real **Go** codebase. The previous two case studies ran on JavaScript
> (axe-core) and Python (crewAI); this one is the Go counterpart: does the method hold on
> a large Go project?
>
> **Conclusion first**: `history` and `deps` work on a Go repository with no changes
> (git provenance is language-independent; go.mod is one of the three manifests `deps`
> already supports). **Coverage is a capability gap confirmed by this run**: Go's
> `go test -coverprofile` produces a text format, and the current producer only reads JSON
> (c8/V8, coverage.py) — the refusal was reproduced against real output. All 4 coarse-screen
> candidates died at the gates or on in-code evidence — including one file that carries a
> real advisory ID (GHSL-2023-004), whose traversal fix is still effective today, verified
> by an executable PoC.
>
> **This is not a verdict on act**: this report is not an endorsement of act's security
> posture. Zero true positives is the outcome of one narrowly scoped run; the unevaluated
> criteria are listed in section 1.

**Audit mode**: quick (narrow scope: measure the false-positive rate + verify Go compatibility)
**Target repository**: act (upstream `nektos/act`, v0.2.89), 18,042 lines of Go (excluding
tests and testdata)
**Baseline commit**: `4f41128` (2026-06-01, v0.2.89; full local clone, 1,317 commits)
**Phases executed**: coarse screen (Go pattern groups) + change surface (history on two
commits) + dependency surface (go.mod) + one executable PoC
**Report location**: the report and the PoC live on the euthyna side of the fence, **never
written into the target repository** (the act clone sits in `.scratch/`, gitignored).

---

## 0. Executive summary

| Metric | Value |
|---|---|
| Coarse-screen candidates | 4 (exec group, 2 sites collapsed into one + cache-server bind + artifact-server traversal + FileEntry write) |
| TRUE POSITIVE | **0** |
| FALSE POSITIVE | 4 |
| INCONCLUSIVE | 0 |
| Non-security observations | 2 |
| **False-discovery proportion among screened candidates** | **4/4 = 100%** (no true negatives were established in this run, so it is not called a statistical false-positive rate) |

**Method validation results**:

| Verification point | Result |
|---|---|
| `history` works on a Go repository | ✅ Two real runs: the v4 rewrite commit (5 facts); the GHSL fix commit (59 deleted lines attributed back to the artifact server's original implementation commit `11f6ee37a6`) |
| `deps` reads go.mod | ✅ Real run: 104 facts, each honestly labelled "declared requirement, not the resolved version" (deps reads the go.mod requirements and does not resolve the module graph) |
| `coverage` reads Go coverage data | ❌ **Gap confirmed by this run**: the text format of `go test -coverprofile` is correctly refused (`Unexpected token 'm', "mode: set\n" is not valid JSON`); the refusal itself honours the "missing data is not clean data" design |
| Six-gate discipline holds on Go code | ✅ Of the 4 candidates, 3 died at gate 2 (reachability) and 1 (the traversal) was refuted at gate 4 (PoC verification); each with concrete evidence |

**Conclusion**: on this target, **all 4 coarse-screen candidates were false positives**, and
the most storied one — an artifact server that carries a CVE-class advisory ID — had its
historical traversal surface (GHSL-2023-004) fixed by `safeResolve`, a fix this run
re-verified with an executable PoC. Another quantified sample of the gap between "looks
dangerous" and "is a vulnerability"; the run also surfaced a concrete capability gap (the Go
coverage format), matching the pattern of the crewAI run, which exposed the coverage.py gap
back when it ran.

---

## 1. Coverage table (unevaluated items first)

| Criterion | Status | Reason |
|---|---|---|
| Full-repo vulnerability scan | ❌ Not evaluated | Quick mode coarse-screens high-risk patterns only |
| Dependency vulnerabilities (OSV etc.) | ❌ Not evaluated | `deps` only adjudicates "what version is locked"; CVE adjudication is left to the agent layer by design |
| Go coverage measurement | ❌ **Unavailable** | Text format unsupported, confirmed against real output (section 4.3) |
| Secret scanning | ⚠️ Partial | 0 hits in the screen (vendored JS under testdata excluded); 0 hits ≠ no secrets |
| SQL injection | ❌ Not evaluated | The target has no SQL surface |
| Workflow semantics (fidelity of the Actions simulator) | ❌ Not evaluated | Outside quick mode |

**This report therefore cannot serve as an endorsement that "act has no security issues."**
It only states: within this narrowed screen and the adjudication discipline, no true
positives were produced, and the method itself works reproducibly on a Go codebase
(coverage excepted, recorded as such).

---

## 2. Coarse-screen method and candidate sources

Regex coarse-screen of Go high-risk pattern groups over `pkg/` and `cmd/` (excluding
`*_test.go`, `testdata/`, vendored JS):

| Pattern group | Hits | Notes |
|---|---|---|
| `exec.Command` / `exec.CommandContext` | 2 | `pkg/gh/gh.go:20`, `pkg/container/host_environment.go:301` |
| tar unpacking / `filepath.Join` on archive names | 2 | Both **construct** tar archives (`filecollector`, `action_cache`); neither unpacks an untrusted one |
| `json.NewDecoder` / `yaml.Unmarshal` | 1 | `artifactcache/handler.go:221` decodes an HTTP body (production; yaml hits are all in tests) |
| `net.Listen` / `ListenAndServe` | 2 | `artifactcache/handler.go:109`, `artifacts/server.go:303` |
| `InsecureSkipVerify` / `md5` / `sha1` | 0 | Vendored JS under testdata excluded |
| Hardcoded secret literals | 0 | — |
| `os.WriteFile(filepath.Join(...))` on a variable path | 1 | `container/host_environment.go:56` (FileEntry write) |

The screen converged on **4 candidates** (the 2 exec sites collapse into one group):

1. `pkg/gh/gh.go:20` + `pkg/container/host_environment.go:301` — the `exec.CommandContext` group
2. `pkg/artifactcache/handler.go:109` — cache server binds on the outbound IP
3. `pkg/artifacts/server.go` — unauthenticated artifact server + historical traversal surface (GHSL-2023-004)
4. `pkg/container/host_environment.go:56` — `os.WriteFile(filepath.Join(destPath, f.Name))`

Plus a change-surface candidate: commit `e1e5671` (Artifacts v4 backend rewrite, touching the
same file a security fix lives in).

**act's trust model (must be stated before adjudicating)**: act runs **the user's own**
GitHub Actions workflows locally; executing the commands a workflow specifies is the product
contract, not a vulnerability. The attacker roles are only three: the author of a remote
action (action repos can come from anyone), the maintainer of a container image, and a peer
on the same network while a run is in progress. Every adjudication below rests on this model.

---

## 3. Adjudication details

### BUG #1 FALSE POSITIVE — the `exec.CommandContext` group

**Gate 2 (reachability) FAIL**: neither call site takes attacker-controlled input.
`pkg/gh/gh.go:20` invokes `gh auth token` with hardcoded arguments;
`host_environment.go:301` executes the workflow step's `run:` command — written by the user
(see the trust model), and running workflow steps directly on the host when `--container`
does not apply is act's declared behaviour (that is what `HostEnvironment` exists for).

- Evidence: `pkg/gh/gh.go:20-23`; `pkg/container/host_environment.go:285-309`
- False-positive list: item 9 (pattern recognition ≠ vulnerability analysis), item 4 (data-source context)

### BUG #2 FALSE POSITIVE — the cache server binds on the outbound IP

**Restated claim**: `net.Listen("tcp", fmt.Sprintf("%s:%d", h.outboundIP, port))`
(`artifactcache/handler.go:109`) exposes the cache server to the LAN with no authentication
on cache writes.

**Gate 2 (reachability) FAIL**: reading the implementation, all 6 routes are registered under
the `"/" + h.token + apiPath` prefix (`handler.go:96-103`), and the token is the hex of 16
CSPRNG bytes (`handler.go:90-94`) — 128 bits of entropy. Route matching *is* the
authentication: a request without the token never reaches a handler. Binding on the outbound
IP is **intentional** — containers must reach the host from the container network side for
cache access; 127.0.0.1 would break the feature.

- Evidence: `pkg/artifactcache/handler.go:90-109`
- False-positive list: item 6 (read the implementation before confirming a claim), item 9
- See observation 1 in section 5 for the contrast with BUG #3 — the process record of this run

### BUG #3 FALSE POSITIVE — artifact-server path traversal (the GHSL-2023-004 fix, re-verified)

**Restated claim**: the upload/download routes of `artifacts/server.go` concatenate
`itemPath`/`path` into filesystem paths; an attacker escapes `baseDir` with `../` and writes
arbitrary files (CWE-22). This file has a real advisory behind it: fix commit `63ae215`
describes itself as "fix: update artifact server to address GHSL-2023-004" (the advisory
text itself was not fetched; only in-repo evidence is used here — the commit message and the
test fixture `pkg/artifacts/testdata/GHSL-2023-004/artifacts.yml`).

**Gates**:

| Gate | Result | Evidence |
|---|---|---|
| 1 process | ✅ | Data flow, PoC, history all done |
| 2 reachability | ✅ | Routes carry no token prefix and no Authorization check (contrast BUG #2's cache server); the server is reachable on 127.0.0.1, proven by the PoC |
| 3 real impact | ✅ (if traversal held) | Escaping `baseDir` is arbitrary file write |
| 4 PoC verification | ✅ **Traversal refuted** | PoC below |
| 5 mathematical bound | — | Covered by the PoC |
| 6 environment | ✅ | No sandbox interference |

**PoC (real `Serve()`, real TCP, real filesystem)**: the complete runnable source follows
(drop into `pkg/artifacts/` and run `go test -run TestEuthynaPoc -v`; the act clone lives in
`.scratch/`, and the source is inlined here so the run can be reproduced after `.scratch` is
cleaned):

```go
package artifacts

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestEuthynaPocUnauthenticatedUploadAndTraversal(t *testing.T) {
	baseDir := t.TempDir()
	parent := filepath.Dir(baseDir)

	// claim a free ephemeral port, then hand it to Serve. Serve() exposes no
	// listener handle, so the reservation window is tiny but nonzero; the
	// upload-then-read-back assertion below still pins this run to this server.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().(*net.TCPAddr).IP.String()
	port := strconv.Itoa(l.Addr().(*net.TCPAddr).Port)
	l.Close()
	base := fmt.Sprintf("http://%s:%s", addr, port)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := Serve(ctx, baseDir, addr, port)
	defer stop()

	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := http.Get(base + "/"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("server did not start")
		}
		time.Sleep(50 * time.Millisecond)
	}

	req, _ := http.NewRequest(http.MethodPut, base+"/upload/123?itemPath=../../../euthyna-poc.txt", strings.NewReader("euthyna-poc-content"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	rbody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	t.Logf("PUT /upload status=%d body=%s", resp.StatusCode, rbody)

	clamped := filepath.Join(baseDir, "123", "euthyna-poc.txt")
	if data, err := os.ReadFile(clamped); err != nil {
		t.Errorf("expected the payload clamped inside baseDir at %s: %v", clamped, err)
	} else {
		t.Logf("clamped into baseDir: %s (%q)", clamped, data)
	}

	escaped := filepath.Join(parent, "euthyna-poc.txt")
	if _, err := os.Stat(escaped); err == nil {
		t.Errorf("TRAVERSAL: file escaped baseDir to %s", escaped)
	} else {
		t.Logf("no file outside baseDir: %s", escaped)
	}

	gresp, err := http.Get(base + "/artifact/123/euthyna-poc.txt")
	if err != nil {
		t.Fatal(err)
	}
	gbody, _ := io.ReadAll(gresp.Body)
	gresp.Body.Close()
	t.Logf("GET /artifact status=%d body=%q", gresp.StatusCode, gbody)
	if gresp.StatusCode != http.StatusOK {
		t.Errorf("expected unauthenticated download to succeed, got %d", gresp.StatusCode)
	}

	// the GET handler never closes the file; on Windows the still-open handle
	// breaks t.TempDir cleanup. Force the finalizer to prove the fd is only
	// reachable through GC, not through any Close call.
	stop()
	cancel()
	runtime.GC()
	time.Sleep(100 * time.Millisecond)
}
```

Measured output (the port is assigned per run; this run got 57282):

```
PUT /upload status=200 body={"message":"success"}
clamped into baseDir: …\001\123\euthyna-poc.txt ("euthyna-poc-content")
no file outside baseDir: …\euthyna-poc.txt
GET /artifact status=200 body="euthyna-poc-content"
--- PASS: TestEuthynaPocUnauthenticatedUploadAndTraversal (0.17s)
```

**The traversal is dead; the missing authentication is alive.**

**Verdict: FALSE POSITIVE** — the traversal fix (`safeResolve`, introduced by `63ae215`,
replacing the bare `fmt.Sprintf("%s/%s", runID, itemPath)`) still fully covers upload,
download, and the v4 routes at the current HEAD (`safeResolve` has 13 call sites across
`server.go` and `artifacts_v4.go`).

**Recommendation to the project (an observation, not a verdict)**: align with the cache
server — every artifacts route is unauthenticated, and `--artifact-server-addr` defaults to
the **outbound IP** (`cmd/root.go:118`); `--artifact-server-path` is opt-in (the server does
not start without it), but once enabled the service offers unauthenticated file upload and
download to the LAN. Under the declared attacker model (a same-network peer), the impact
surface is explicit: the peer can **write arbitrary content to any path under `baseDir`,
unauthenticated** (including overwriting existing artifacts — poisoning what the user later
downloads; the downstream consequence depends on what the user does with the artifact, a
supply-chain surface) and **read every artifact, unauthenticated** (the contents the user
chose to stage leak), plus trivial resource exhaustion via observation 2's handle leak. The
reason this does not become a reportable finding is not that the impact is absent, but that
the exploitation premises stack: explicit opt-in, same-network position, and `safeResolve`
clamping the boundary to `baseDir`. The impact itself is real. Suggest defaulting to
`127.0.0.1`, or adding a token prefix like the cache server's.

### BUG #4 FALSE POSITIVE — `os.WriteFile(filepath.Join(destPath, f.Name))`, the FileEntry write

**Gate 2 (reachability) FAIL**: every `FileEntry` producer is act-internal
(`runner/expression.go:204`, `runner/run_context.go:242,425`, `runner/step.go:158-170`) with
hardcoded file names (env files, event payloads); none come from workflow text, remote
actions, or container images. The `filepath.Join` `..` risk has no attacker-controlled input
to ride on.

- Evidence: `grep -rn "FileEntry{" pkg --include='*.go'` (10 non-test sites, all internal constant names)
- False-positive list: item 9

### Change surface — commit `e1e5671` (Artifacts v4 backend) did not delete the security fix

The v4 rewrite reworked `pkg/artifacts/` substantially. `euthyna history` produced 5 facts
for it: 4 go.sum dependency churns, 1 single line in `run_context.go` (origin
`11f6ee37a6`, class none). **No deleted line is attributed to the GHSL fix commit
`63ae215`** — `safeResolve` survived the rewrite (the 13 call sites in BUG #3 are the
evidence). Method-wise this is the counterpart of the crewAI case's "looks like a security
regression, isn't one": this time not even the red flag that triggers the check appeared.

### Change surface — commit `63ae215` (the GHSL-2023-004 fix), provenance

`euthyna history --base 63ae215^ --head 63ae215` produced 2 attributions: the fix deleted 59
lines that came from `11f6ee37a6` ("Asset server implementation (#677)", the artifact
server's original implementation commit) and 14 lines from `7105919f0c` (chunked upload
support). **The vulnerability's deleted code was traced back to the commit that introduced
it** — which is what `history` exists for, and it required zero changes for a Go repository.
The honest side-outputs are worth noting: the `-S` probe cap exhausted at 40, and 7 lines
too short (< 12 chars) to chase — both printed, neither silently swallowed.

---

## 4. Method validation details

### 4.1 `history` works on a Go repository (verification point)

```bash
node <euthyna repo>/bin/euthyna.js history --base 63ae215^ --head 63ae215 --repo <act clone>
```

Real output (excerpt):

```
Confirmed (2)
  • This change deleted 59 lines from commit 11f6ee37a6, across 2 files. Message:
    "Asset server implementation (#677)", class: none
  • This change deleted 14 lines from commit 7105919f0c, across 2 files. Message:
    "Added support for chunked uploads. (#1208)", class: none
```

(English rendering; the run was executed with the default Chinese output.)

`git blame` / `git log -S` are language-independent; `history` works on a Go repository with
no changes. Exit code 0.

### 4.2 `deps` reads go.mod and states its own boundary honestly

In the merged `euthyna audit` report, every go.mod dependency yields one fact, each carrying
the same honest label:

> Dependency github.com/docker/cli is declared in go.mod (go) at v29.3.0+incompatible —
> **this is the declared requirement, not the resolved version (go.sum carries no versions,
> so the resolution cannot be verified here)**

Go's dependency-adjudication semantics differ from npm/Cargo: go.mod carries only the
requirements; the selected build list is the result of MVS solving the whole module graph
(each go.mod), and go.sum records version-plus-hash pairs, not the selected list. The deps
producer does not resolve the module graph, so it only answers "what is declared" — it does
not pretend to answer what it cannot. This is consistent with the fact-contract principle
that a measurer only answers questions it can answer deterministically.

> Revision note: the tool output quoted by this run originally read "go.sum carries no
> versions", which is inaccurate (every go.sum line has a version); the tool message has
> been corrected in this PR to "go.sum records version-hash pairs but not the build list
> MVS selected".

### 4.3 `coverage` does not support the Go format — the gap confirmed by this run

```bash
# step 1: run inside the act clone (the coverage file gets an absolute path)
go -C <act clone> test ./pkg/artifacts/ -coverprofile=<abs-path>/act-cover.out -run TestEuthynaPoc   # ok, 14.7%
# step 2: run inside the euthyna repository (reads the same absolute path, so cwd cannot drift)
node bin/euthyna.js coverage --coverage <abs-path>/act-cover.out --symbol safeResolve
```

Real output:

```
No facts were produced by this run.
⚠ Unevaluated criteria (missing data is not clean data):
  • test_coverage: cannot read coverage data …: Unexpected token 'm', "mode: set\n" is not valid JSON.
    If the tests were not run or produced no coverage, this is "not evaluated", not "not covered"
```

(English rendering; the run was executed with the default Chinese output.)

Go's profile is a text format (`mode: set` header plus
`file.go:startLine.startCol,endLine.endCol numStmts hitCount`, **with no function names**).
The behaviour is correct (refuse rather than pretend coverage), but it is a confirmed gap on
Go targets — matching the pattern of the crewAI run, which exposed the coverage.py gap. To
close it, line ranges must be mapped back to functions (parsing function declarations from
source), which is more work than coverage.py was (`Class.method` is right there in the JSON).

---

## 5. Non-security observations (**not findings**)

### Observation 1: the two local servers disagree about authentication

Cache server: every route sits behind a token prefix (BUG #2). Artifacts server: zero
authentication (proven by BUG #3's PoC). Both share the same bind-address default (the
outbound IP, `cmd/root.go:118,124`). Under the attacker model, a peer can do three things:
write arbitrary content into `baseDir` (artifact poisoning), read every artifact, and
exhaust resources via observation 2's handle leak. The reason this stays an observation is
not "no impact" but the stack of exploitation premises: explicit opt-in, same-network
position, and the `safeResolve` boundary clamped to `baseDir`. The asymmetry itself hints
that the artifacts server's zero-auth state is an oversight rather than a design decision —
if upstream confirms it is intentional, this observation should be re-escalated.

### Observation 2: the `GET /artifact` handler never closes the file

`server.go:261-271`: the file opened by `fsys.Open` is fed to `io.Copy` and **never
Closed**. The PoC hit this live on Windows: after the test, `t.TempDir` cleanup failed
(`The process cannot access the file because it is being used by another process`), and only
the GC finalizer released the handle. One leaked handle per download; a long-running
artifacts server accumulates them. A pure resource leak, not a security finding.

---

## 6. Process record: one PoC refuting one claim and confirming another

- Step 1: the coarse screen lists `server.go` as a candidate — it carries both a historical
  advisory ID and currently unauthenticated routes.
- Step 2: split the two claims and gather evidence for each. The **traversal** claim:
  `safeResolve`'s two-stage Join is the standard "clamp to root, then back into baseDir"
  pattern — but the gate discipline does not accept "looks right"; it demands execution
  evidence.
- Step 3: write a Go test that drives the real `Serve()` (no httptest mocks), send a real
  traversal payload: PUT 200, file lands in `baseDir/123/`, nothing outside `baseDir`,
  GET 200 reads it back. **One PoC refutes the traversal and confirms the missing auth.**
- Step 4: adjudicate the claims separately — traversal FALSE POSITIVE (refuted at gate 4 by
  the PoC); the unauthenticated exposure does not constitute a finding (impact is clamped
  into `baseDir` and the service is opt-in) → observation 1.

**Lesson recorded**: a candidate can carry one dead claim and one live claim at the same
time. Adjudicate per claim at the gates; never hand down a single verdict for a whole file.

---

## 7. Count summary

- TRUE POSITIVE: 0
- FALSE POSITIVE: 4
- INCONCLUSIVE: 0
- Non-security observations: 2

---

## 8. Capability gaps exposed by this run (recorded as they are)

1. **The Go coverage text format is unreadable** — `go test -coverprofile` emits `mode: set`
   text; the current producer only reads JSON. The refusal behaviour is correct; closing the
   gap means mapping line ranges back to functions (the Go profile has no function names),
   which is more work than coverage.py was. Reproduced against real output (section 4.3).
2. **go.sum churn drowns the code signal** — a dependency-bump commit floods the history
   report with dozens of deleted go.sum lines (their messages often contain "security", and
   are classified accordingly), diluting the real signal from code files. This is a
   deployment detail on Go targets (the counterpart of crewAI's `-o addopts=""` note);
   path filtering or denoising is a future improvement, not implemented in this run.
3. **`deps` can only answer "what is declared" for go.mod** — the selected build list is
   MVS's solution over the whole module graph, and deps does not resolve the module graph;
   that is the producer's designed boundary, not a gap in go.sum's contents. Resolved
   versions would require `go list -m`, which would break the "nothing but git executes
   without explicit consent" boundary — a separate decision to make.

---

## 9. Limitations

- Quick mode: coarse-screen of high-risk pattern groups only; workflow semantics (act as an
  Actions simulator) entirely unevaluated
- Coverage measurement unavailable on Go targets; no coverage data supports this run
- The GHSL-2023-004 advisory text was not fetched; only in-repo evidence is used (commit
  message, fix content, test fixture)
- act upstream was last pushed 2026-08-09 (clone HEAD 2026-06-01); whether upstream already
  knows about observations 1 and 2 was not checked
- "A LAN peer can reach the server" was not tested (a single machine cannot prove it); only
  the two propositions provable on one machine were tested — "no authentication" and "the
  traversal is clamped". The characterisation of observation 1 is unaffected, but the size
  of the attack surface depends on the deployment environment
