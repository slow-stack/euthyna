# Case Study #4: rustls (Rust)

English · [中文](case-study-rust-zh.md)

> This is euthyna's fourth validation run against a real repository. The subject is
> **rustls** (`rustls/rustls`), and the range is a real pair of fix releases:
> `v/0.23.44` → `v/0.23.45` (RUSTSEC-2026-0285 / GHSA-2mjx-qc3c-rqvc, published 2026-09-14).
>
> This is neither a security assessment of rustls nor an audit someone commissioned. It asks two
> questions: do euthyna's deterministic facts hold up on a Rust repository, and does the six-gate
> discipline fail when it faces **a genuine vulnerability**? No candidate in the first three runs
> cleared all six gates — one of them ended INCONCLUSIVE in the crewAI round — which leaves open
> whether that is rigour or a sieve that only ever says no.
>
> **Result first**: this run produced the project's first TRUE POSITIVE, and its fourth gate is
> backed by an executable PoC verified in both directions. Meanwhile the candidate that looked
> more dangerous (the deframer alignment check) stopped at INCONCLUSIVE, because it could not
> produce impact or trigger evidence: neither inflated into a finding nor dismissed as a false
> positive.
>
> Everything here was measured on a single Windows machine. The clone, the PoC and the
> intermediate output live in `.scratch/` (gitignored) and are not distributed with the
> repository. The full report is `audits/RUSTLS_EUTHYNA_AUDIT_2026-10-09.md`, which has the same
> shape but is deliberately not committed.

---

## 1. Why rustls

`euthyna` has three fact producers, and each of the first three languages validated a round:

| Language | Round | Attribution | Dependency pinning | Coverage |
|---|---|---|---|---|
| JavaScript | #1 axe-core | ✅ | ✅ package-lock.json | ✅ c8/V8 JSON |
| Python | #2 crewAI | ✅ | ❌ not tested | ✅ coverage.py JSON (added that round) |
| Go | #3 act | ✅ | ✅ go.mod (declared, not resolved) | ✅ Go text profile (added right after) |
| Rust | #4 rustls (this round) | ✅ | ✅ Cargo.lock | ❌ **confirmed gap** |

Four criteria decided the target, and each was checked before committing to it: a `Cargo.lock` in
the tree (so `euthyna deps` actually runs), a traceable historical security fix (what `history`
is for), a coverage workflow of its own (so the artefact is real rather than one I invented), and
a size that fits a full adjudication round. rustls satisfies the first two: the repository root
does carry a `Cargo.lock`, and the advisory database holds three entries for the `rustls` crate,
one of them — RUSTSEC-2026-0285 — with `patched = ">= 0.23.45"`, which maps onto a pair of
adjacent tags.

---

## 2. The change surface

`v/0.23.44..v/0.23.45` is 8 commits, 14 files, `+526/−43`:

```
2976d90f Prepare 0.23.45
f9d4ee92 Handshake "alignment" check covers previously-received messages
c4e92e8c Keep data needed for HRR processing together
e553a7a7 server: TLS1.2 is not available after a HRR
5dff9da7 Test whether server negotiates TLS1.2 after HRR
185a063b reject a second ClientHello that changes the cipher suite
9fafe6dd reject a second ClientHello that drops pre_shared_key
1b42c5f7 providers: zeroize private key DER
```

The guard this round examines is the 11 lines `185a063b` added at `rustls/src/server/hs.rs:474-485`,
together with the `suite_before_retry` field (declared at `hs.rs:318`, initialised at `hs.rs:343`):

```rust
// RFC 9846 section 4.2.4: the server must negotiate the same cipher suite it
// named in its HelloRetryRequest
if let Some(before_retry) = self.suite_before_retry {
    if before_retry != suite.suite() {
        return Err(cx.common.send_fatal_alert(
            AlertDescription::IllegalParameter,
            PeerMisbehaved::CipherSuiteDifferedOnRetry,
        ));
    }
}
```

---

## 3. The raw measurement

The command, run from the repository root with `--repo` pointing at the scratch clone:

```powershell
node bin/euthyna.js audit --base v/0.23.44 --head v/0.23.45 --repo .scratch/rustls
```

Exit code `10` (measured, and at least one fact classified as security), 933 lines of output:

```
已评估的判据：
  • history: 43 条 (euthyna-history)
  • dependency: 366 条 (euthyna-deps)

⚠ 未评估的判据（缺数据不等于干净）：
  • history-origins: 2 行内容过短（< 12 字符），未做来源追溯
  • reintroduction: 未启用 --pickaxe，未检查「被移除又加回」的代码行
```

What a dependency fact looks like, to show the granularity `deps` reports at:

```
• 依赖 zerovec 在 lockfile（cargo）中被锁定为版本 0.11.8
     证据: D:\...\rustls\Cargo.lock:2815
     复现: euthyna deps --lockfile '...Cargo.lock' --dep 'zerovec'
```

**An error that nearly slipped through**: the first run had the clone parked on `main`
(`0.24.0-dev.1`) rather than `v/0.23.45`, and the dependency count came out at 284. After
checking out the tag and re-running the same command, the same measurement yields 366. When the
shared-lockfile assumption fails silently, the fact count changes silently too. That is now
recorded as an observation for the project.

The reason is that the two halves of `audit` do not read the same thing: `history` takes its data
from the git objects named by `--base` and `--head`, so the checkout is irrelevant, while `deps`
reads the manifest files **currently checked out in the directory `--repo` points at**. Writing
`--head v/0.23.45` therefore does not make the dependency facts the facts of that tag. Check the
working tree out at one end of the range first
(`git -C .scratch/rustls checkout v/0.23.45`) and confirm it with
`git -C .scratch/rustls rev-parse HEAD`; otherwise the two halves report two different versions.

---

## 4. An independent PoC

`rustls::internal` does not export the handshake message types (`rustls/src/lib.rs:360` is a
private `mod msgs;`), so the PoC has to assemble both ClientHellos itself in wire format. And
`negotiated_cipher_suite()` is not on the public interface either, so the evidence is taken from
**the cipher suite field of the ServerHello the server writes**, not from an accessor that could
change underneath us.

The scenario: the server's provider offers both `TLS13_AES_128_GCM_SHA256` (0x1301) and
`TLS13_CHACHA20_POLY1305_SHA256` (0x1303). The first ClientHello offers only 0x1301 and leaves
`key_share` empty → that draws a HelloRetryRequest naming 0x1301. The second ClientHello withdraws
0x1301, offers only 0x1303, and carries an x25519 key share.

The same source, the same bytes, once per tag:

```console
$ cargo run -- v0.23.44          # 64ad3867, before the fix
--- rustls HRR cipher-suite PoC [v0.23.44] ---
HRR named suite: 1301
RESULT: ACCEPTED the suite change; ServerHello names 1303 (retry said 1301)

$ cargo run -- v0.23.45          # 2976d90f, after the fix
--- rustls HRR cipher-suite PoC [v0.23.45] ---
HRR named suite: 1301
RESULT: REJECTED the suite change
detail: PeerMisbehaved(CipherSuiteDifferedOnRetry)
```

Before the fix the server **accepted** a second hello that dropped the retried suite and then
really did select 0x1303 in its own ServerHello — a suite the HRR never promised. After the fix the
identical bytes are refused with `CipherSuiteDifferedOnRetry`.

**The two failures of the PoC itself are more instructive than its success**, because both also
presented as "rejected":

1. the `key_share` entry length was written as `32usize.to_be_bytes()`. A `usize` is 8 bytes on
   x86_64, so the bytes on the wire were `00 00 00 00 00 00 00 20`; the protocol field is a u16 and
   the server took the first two → `InvalidMessage(IllegalEmptyValue)`, never reaching the guard;
2. in `supported_groups` I put secp256r1 before x25519, so the HRR named secp256r1 while my second
   hello carried only x25519 → v/0.23.44 refused first with
   `PeerMisbehaved(RefusedToFollowHelloRetryRequest)` (`rustls/src/server/tls13.rs:218`).

Had I only watched "did the process return an error", both would have counted as the guard working.
They proved only that my bytes were wrong. The value of a PoC is not that it errors; it is **which
error it names**.

---

## 5. Verdicts

Six verdicts, all of which pass the contract check in `euthyna gate` (exit code 0):

| # | Claim | Verdict | Decisive gate |
|---|---|---|---|
| 1 | A second ClientHello after HRR can withdraw the named cipher suite | **TRUE POSITIVE** | all six pass; gate 4 evidenced by the two-directional PoC |
| 2 | The protocol version can fall back to TLS 1.2 after HRR | FALSE POSITIVE | 5 maths FAIL (the version decision sits after the suite/key_share checks) |
| 3 | The deleted alert helpers removed defensive logic | FALSE POSITIVE | 5 maths FAIL (all five deleted lines were forwarding calls) |
| 4 | The deframer's `is_aligned()` treats a buffered whole message as aligned | **INCONCLUSIVE** | gates 3, 4, 5 not evaluated, and no FAIL anywhere |
| 5 | The providers never zeroize the private key DER | FALSE POSITIVE | 2 reachability FAIL (reading memory needs local execution), 3 impact FAIL |
| 6 | Pinned dependencies carry applicable advisories | FALSE POSITIVE | 1 process FAIL (not introduced by this change; upstream triaged it) |

The false-discovery rate: of the five coarse-screen candidates, **1 TP / 3 FP / 1 INC**, i.e.
`FP/(FP+TP)` = 75% on the earlier rounds' formula. That number is not comparable with the first
three runs, whose candidate sets contained no real vulnerability. What this round shows is that
the discipline **neither rejected a genuine flaw nor promoted an unevidenced one**.

Two verdicts deserve the full text:

```
BUG #1 TRUE POSITIVE — HelloRetryRequest 之后第二个 ClientHello 可撤回被点名的 cipher suite
  门禁全部通过。证据：rustls/src/server/tls13.rs:218 (64ad3867), rustls/src/server/hs.rs:474 (2976d90f)
  复现：cd .scratch/rustls && git checkout v/0.23.44 && cd ../rustls-poc && cargo run -- v0.23.44
  可利用性：EASY（单个 TCP 连接，无需认证、无需并发）
  影响：远程客户端使服务器协商出 HRR 未曾承诺的 cipher suite，违反 RFC 9846 §4.2.4
```

```
BUG #4 INCONCLUSIVE — deframer 的 is_aligned() 把「已收到但未消费的整包」当成对齐
  门禁 1（流程）PASS：f9d4ee92 把 is_aligned() 从「无半包」改为 !self.is_active()
  门禁 2（可达性）PASS：输入来自对端握手字节
  门禁 3（真实影响）NOT EVALUATED：需要具体消息序列才能确定错序后果
  门禁 4（PoC）NOT EVALUATED：未构造触发序列
  门禁 5（数学边界）NOT EVALUATED
  证据：rustls/src/msgs/deframer/handshake.rs:94 (2976d90f)
  复现：无
  注：没有任何门禁 fail，故不是 FALSE POSITIVE；缺的是影响与触发证据
```

The fourth looks more "vulnerability-shaped" than the first (a handshake message boundary), but it
has no evidence. Under the discipline, an unevidenced claim is not a finding, and a claim that
merely "seems impossible" is not a false positive either — it stays INCONCLUSIVE.

---

## 6. The supply-chain candidate: from "has an advisory" to "is affected at the pinned version"

Intersecting crate names with the RustSec database (a shallow local clone, 954 crate directories)
gives **62** dependencies in `v/0.23.45`'s `Cargo.lock` that have had an advisory. "Has had an
advisory" is not a finding, so every range is compared against the pinned version:

```
crates in the lock with at least one advisory on disk: 62
worst verdict per crate: {"unaffected":52,"never-patched":3,"affected":4,"unknown":3}
```

- **affected** (4, all dependencies of the post-quantum provider): `libcrux-chacha20poly1305` 0.0.7,
  `libcrux-kem` 0.0.7, `libcrux-secrets` 0.0.5, `libcrux-sha3` 0.0.8
- **never-patched** (3, whose advisory has `patched = []`): `libcrux-aesgcm` 0.0.7,
  `proc-macro-error2` 2.0.1, `rsa` 0.9.10 (RUSTSEC-2023-0071, the Marvin timing side channel)
- **unknown** (3): range shapes this evaluator cannot parse, such as the two-component
  `unaffected = ["< 0.23"]`; they are reported as unknown rather than folded into "safe"

As a claim about *this change surface* the verdict is FALSE POSITIVE: none of those crates arrived
in this pair of tags, and rustls has already triaged them — the repository contains the commits
`Accept that libcrux deps are vulnerable` (`3131e5c3`) and `Cargo deny: allow RUSTSEC-2026-0173`
(`041a8d23`, `299c5318`). As an observation about this lockfile it stands, so it is recorded as an
observation rather than a finding.

**This comparison script is not part of `euthyna`** — it is something I wrote to adjudicate the
claim (`.scratch/advisory-versions.mjs`), and its interpretation rules (arrays are alternatives,
commas are conjunctions, two-component versions yield unknown) depend on that implementation. The
three unknowns exist because of it.

Its first version read the alternatives inside `patched` as a conjunction instead of a
disjunction, which made the already-fixed `v/0.23.45` itself come out affected — **the patched
version became the finding**. The rule that was wrong is precisely the one that decides whether
"has an advisory" turns into "is vulnerable", so getting it wrong raises no error; it just yields
a plausible-looking list.

---

## 7. Coverage on Rust is still a confirmed gap

This round did **not** add Rust coverage support, so the gap is stated rather than left implicit:

- `euthyna coverage` reads c8/V8 JSON, coverage.py JSON and Go's text profile, and nothing from
  Rust (`cargo-llvm-cov` produces an lcov tracefile and `llvm-cov export` JSON;
  `cargo-tarpaulin` produces lcov / Cobertura XML / `Summary.json`).
- Measured on this machine: `cargo`/`rustc` 1.96.1 (`x86_64-pc-windows-msvc`) work, while both
  `cargo llvm-cov --version` and `cargo tarpaulin --version` report `error: no such command`.
- A second, unexpected obstacle: rustls' own tests cannot run here at all, because its x86_64
  dev-dependencies force in `aws-lc-sys`, whose build script requires NASM:
  `panicked at aws-lc-sys-0.44.0/builder/nasm_builder.rs:137: NASM command not found!`. That is why
  the PoC had to be a separate crate pinned to the ring provider — not a matter of taste.

So gates 3 and 4 of the fourth verdict are "not evaluated" rather than "fail": **when the coverage
fact is missing, that gate is recorded as not evaluated and must not carry a dismissal** — the rule
PR #21 had just converged, used here for the first time on real data.

---

## 8. How to reproduce

Which steps run from a clean checkout: 1 and 2 do. The rustls clone, the PoC crate and the full
adjudication report are **not distributed with this repository** (third-party sources stay in
`.scratch/`; verdict reports are never committed), so steps 3 and 4 require the reader to write the
PoC from the scenario described in section 4 (what each ClientHello offers, and whether it carries
a key share) and to have that report on hand.

```powershell
# 1. clone and check out one end of the range (git clone creates .scratch/ and the
#    intermediate directories itself, measured; check out --head or deps reads a
#    different manifest — see section 3)
git clone https://github.com/rustls/rustls .scratch/rustls
git -C .scratch/rustls checkout v/0.23.45

# 2. the deterministic facts: runnable from a clean checkout
node bin/euthyna.js audit --base v/0.23.44 --head v/0.23.45 --repo .scratch/rustls   # exit code 10

# 3. the PoC: needs your own .scratch/rustls-poc (not distributed); same source per tag
git -C .scratch/rustls checkout v/0.23.44
Push-Location .scratch/rustls-poc; cargo run -- v0.23.44; Pop-Location
git -C .scratch/rustls checkout v/0.23.45
Push-Location .scratch/rustls-poc; cargo run -- v0.23.45; Pop-Location

# 4. validate the verdict report against the contract: needs that local report
node bin/euthyna.js gate audits/RUSTLS_EUTHYNA_AUDIT_2026-10-09.md                   # exit code 0
```

Step 3 moves the working tree back and forth between the two tags; check out `v/0.23.45` again
before re-running step 2.

The PoC's Cargo.toml uses a path dependency and pins the provider to ring:

```toml
[dependencies]
rustls = { path = "../rustls/rustls", default-features = false, features = ["ring", "logging", "std", "tls12"] }
rcgen = "0.13"
```

---

## 9. Limitations

- The PoC proves the suite change is **accepted** (0.23.44) and **rejected** (0.23.45). It proves
  no cryptographic consequence (no differential handling across suites was exploited). The impact
  rating comes from the advisory's CVSS (`C:L`), not from anything measured here.
- The `not_evaluated` gates in verdicts 2 and 4 are genuinely unevaluated, not "evaluated and
  judged harmless".
- `euthyna deps` reports pinned-version facts only: it does not resolve the Cargo module graph and
  does not map CVEs to versions. The version-level comparison in section 6 comes from a temporary
  script, not from the product.
- Everything holds on a single Windows machine with the ring provider, feeding
  `ServerConnection` directly rather than through a real network handshake; the QUIC path and the
  `aws-lc-rs` provider are untested.
- rustls' version line is moving: the feature names and API locations here are from `0.23.45`, and
  on `main` (`0.24.0-dev.1`) `default = ["tracing","webpki"]` is already different. Reproduction is
  only valid per tag.
