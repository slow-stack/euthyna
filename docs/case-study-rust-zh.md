# 案例研究 #4：rustls（Rust）

> 本文是 euthyna 的第四次真实仓库验证运行。被测对象是 **rustls**（`rustls/rustls`），
> 范围取自一对真实的修复版本：`v/0.23.44` → `v/0.23.45`（对应 RUSTSEC-2026-0285 /
> GHSA-2mjx-qc3c-rqvc，2026-09-14 发布）。
>
> 这不是对 rustls 的整体安全评估，也不是受人委托的审计。它回答两个问题：
> euthyna 的确定性事实在 Rust 仓库上是否成立；六门禁纪律在面对**一个真漏洞**时会不会失手——
> 前三轮的粗筛候选全部被驳回，没人知道那是因为纪律严，还是因为筛子只会否。
>
> **结论先行**：本轮第一次判出 TRUE POSITIVE，而且它的第 4 道门禁由一个可执行、双向验证的
> PoC 供证。同时，看起来更"危险"的那条候选（deframer 对齐）因为拿不出影响与触发证据，
> 停在 INCONCLUSIVE 而不是被夸大成漏洞，也没有被降级成误报。
>
> 全部实测在 Windows 单机完成；克隆、PoC 与中间产物都在 `.scratch/`（gitignored），
> 不随仓库分发。完整报告见同目录结构的 `audits/RUSTLS_EUTHYNA_AUDIT_2026-10-09.md`（本地文件，
> 不入库）。

---

## 1. 为什么是 rustls

`euthyna` 支持三种事实产出，前三种语言各验证过一轮：

| 语言 | 轮次 | 历史归属 | 依赖锁定 | 覆盖率 |
|---|---|---|---|---|
| JavaScript | #1 axe-core | ✅ | ✅ package-lock.json | ✅ c8/V8 JSON |
| Python | #2 crewAI | ✅ | ❌ 未测 | ✅ coverage.py JSON（该轮新增） |
| Go | #3 act | ✅ | ✅ go.mod（声明而非求解） | ✅ Go 文本 profile（该轮之后补） |
| Rust | #4 rustls（本轮） | ✅ | ✅ Cargo.lock | ❌ **确认缺口** |

选靶标准是四条，先核后定：仓库内有 `Cargo.lock`（`euthyna deps` 能真跑）、有可追溯的历史安全修复
提交（`history` 的用武之地）、自带覆盖率工作流（这样产物是真的，不是我造的）、体量适合一轮完整判定。
rustls 命中前两条：实测其仓库根有 `Cargo.lock`，且公告库对 `rustls` crate 有三条记录，其中
RUSTSEC-2026-0285 的 `patched = ">= 0.23.45"` 正好对应一对相邻 tag。

---

## 2. 变更面

`v/0.23.44..v/0.23.45` 共 8 个提交、14 个文件、`+526/−43`：

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

本轮关注的守卫是 `185a063b` 加在 `rustls/src/server/hs.rs:474-485` 的 11 行，配套
`suite_before_retry` 字段（声明在 `hs.rs:318`，初始化在 `hs.rs:343`）：

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

## 3. 测量的原始产出

命令（在仓库根执行，`--repo` 指向 scratch 克隆）：

```powershell
node bin/euthyna.js audit --base v/0.23.44 --head v/0.23.45 --repo .scratch/rustls
```

退出码 `10`（已测量，且存在被分类为 security 的事实），输出 933 行：

```
已评估的判据：
  • history: 43 条 (euthyna-history)
  • dependency: 366 条 (euthyna-deps)

⚠ 未评估的判据（缺数据不等于干净）：
  • history-origins: 2 行内容过短（< 12 字符），未做来源追溯
  • reintroduction: 未启用 --pickaxe，未检查「被移除又加回」的代码行
```

一条依赖事实的样子，供对照 `deps` 的证据粒度：

```
• 依赖 zerovec 在 lockfile（cargo）中被锁定为版本 0.11.8
     证据: D:\...\rustls\Cargo.lock:2815
     复现: euthyna deps --lockfile '...Cargo.lock' --dep 'zerovec'
```

**一个差点溜过去的错误**：第一次跑这条命令时，克隆停在 `main`（`0.24.0-dev.1`）而不是
`v/0.23.45`，dependency 事实得数是 284。按 tag 检出后重跑，同样的命令得 366 条。
同一份 `Cargo.lock` 假设不成立时，事实数会静默变化——这一条已写进项目的观察记录。

---

## 4. 独立 PoC

`rustls::internal` 不导出握手消息类型（`rustls/src/lib.rs:360` 是私有的 `mod msgs;`），所以
两个 ClientHello 必须由 PoC 自己按 wire 格式拼装；而 `negotiated_cipher_suite()` 不在公开接口上，
因此证据取**服务器自己写出的 ServerHello 里的 cipher_suite 字段**，而不是某个访问器的返回值。

场景：服务器 provider 同时提供 `TLS13_AES_128_GCM_SHA256`(0x1301) 与
`TLS13_CHACHA20_POLY1305_SHA256`(0x1303)。第一个 ClientHello 只 offer 0x1301 且 `key_share` 留空
→ 触发 HelloRetryRequest 点名 0x1301；第二个 ClientHello 撤回 0x1301、只 offer 0x1303，并带上
x25519 的 key share。

同一份源码、同一份字节，两个 tag 各跑一次：

```console
$ cargo run -- v0.23.44          # 64ad3867，修复前
--- rustls HRR cipher-suite PoC [v0.23.44] ---
HRR named suite: 1301
RESULT: ACCEPTED the suite change; ServerHello names 1303 (retry said 1301)

$ cargo run -- v0.23.45          # 2976d90f，修复后
--- rustls HRR cipher-suite PoC [v0.23.45] ---
HRR named suite: 1301
RESULT: REJECTED the suite change
detail: PeerMisbehaved(CipherSuiteDifferedOnRetry)
```

修复前服务器**照收**换了 suite 的第二个 hello，并在自己的 ServerHello 里真的选了 0x1303——
HRR 从未承诺过它。修复后同一串字节被 `CipherSuiteDifferedOnRetry` 拒掉。

**PoC 自己的两次失败比成功更有教学价值**，因为两次都表现为"被拒绝"：

1. `key_share` 条目的长度字段我写成 `32usize.to_be_bytes()`（4 字节），服务器把 u16 读成 0 →
   `InvalidMessage(IllegalEmptyValue)`，根本没走到守卫；
2. `supported_groups` 里我把 secp256r1 排在 x25519 前面，于是 HRR 点名 secp256r1，而我的第二个
   hello 只带 x25519 → v/0.23.44 用 `PeerMisbehaved(RefusedToFollowHelloRetryRequest)`
   先拒（`rustls/src/server/tls13.rs:218`）。

如果只观察"进程返回了错误"，这两次都会被判成守卫生效——而它们证明的是**我的字节写错了**。
一条 PoC 的价值不在它是否报错，而在它**指定了哪一个错误**。

---

## 5. 裁定

6 条裁定，全部通过 `euthyna gate` 的契约校验（退出码 0）：

| # | 断言 | 裁定 | 决定性门禁 |
|---|---|---|---|
| 1 | HRR 之后第二个 ClientHello 可撤回被点名的 cipher suite | **TRUE POSITIVE** | 6 道全过，第 4 道由双向 PoC 供证 |
| 2 | HRR 之后可回落到 TLS 1.2 | FALSE POSITIVE | 5 数学边界 FAIL（版本决定在 suite/key_share 检查之后） |
| 3 | 被删的 alert 辅助函数移除了防御逻辑 | FALSE POSITIVE | 5 数学边界 FAIL（被删 5 行全是转发调用） |
| 4 | deframer 的 `is_aligned()` 把待消费整包当成对齐 | **INCONCLUSIVE** | 3、4、5 未评估，且无任何 FAIL |
| 5 | provider 未 zeroize 私钥 DER | FALSE POSITIVE | 2 可达性 FAIL（读内存需要本地执行权），3 真实影响 FAIL |
| 6 | 锁着的依赖带着适用公告 | FALSE POSITIVE | 1 流程 FAIL（不是本次变更引入；上游已显式分诊） |

误报率：粗筛的 5 个候选是 **1 TP / 3 FP / 1 INC**，按前几轮口径 `FP/(FP+TP)` = 75%。这个数字
和前三轮不可直接比——那三轮的粗筛里没有真漏洞。本轮的意义是：**既没把真漏洞驳回，也没把
没证据的影响写进 TRUE POSITIVE**。

两条值得全文看的：

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

第 4 条看起来比第 1 条"更像漏洞"（握手消息边界误判），但它没有证据。按判定纪律，缺证据的
不能报成发现，也不能因为"看起来不可能"就报成误报——它停在 INCONCLUSIVE。

---

## 6. 供应链候选：把"有公告"变成"锁定版本是否受影响"

按 crate 名与 RustSec 公告库求交（本地浅克隆，954 个 crate 目录），`v/0.23.45` 的
`Cargo.lock` 里有 **62** 个依赖曾有公告。但"历史上曾有过公告"不是发现，所以要逐条比版本区间：

```
crates in the lock with at least one advisory on disk: 62
worst verdict per crate: {"unaffected":52,"never-patched":3,"affected":4,"unknown":3}
```

- **affected**（4 个，全是后量子 provider 的依赖）：`libcrux-chacha20poly1305` 0.0.7、
  `libcrux-kem` 0.0.7、`libcrux-secrets` 0.0.5、`libcrux-sha3` 0.0.8
- **never-patched**（3 个，公告里 `patched = []`）：`libcrux-aesgcm` 0.0.7、`proc-macro-error2` 2.0.1、
  `rsa` 0.9.10（RUSTSEC-2023-0071，Marvin 计时侧信道）
- **unknown**（3 个）：求值器读不懂的区间形状，例如 `unaffected = ["< 0.23"]` 这种两段版本；
  宁可上报 unknown 也不并入"安全"

这条候选作为"本次变更引入的漏洞"是 FALSE POSITIVE：这些 crate 不是这一对 tag 加进来的，
而且 rustls 自己已经分诊过——仓库里有提交 `Accept that libcrux deps are vulnerable`（`3131e5c3`）
和 `Cargo deny: allow RUSTSEC-2026-0173`（`041a8d23`、`299c5318`）。
作为"这份 lockfile 的供应链观察"它成立，于是记成观察而不是发现。

**这个比对脚本不是 `euthyna` 的产物**，是我为了裁定临时写的（`.scratch/advisory-versions.mjs`），
它的解释规则（数组是"或"、逗号是"且"、两段版本判 unknown）会随实现变化；3 个 unknown 就是这么留下的。

---

## 7. coverage 在 Rust 上仍是确认缺口

本轮**没有**补 Rust 覆盖率格式，因此记为确认缺口而不是"没测到"：

- `euthyna coverage` 认识 c8/V8 JSON、coverage.py JSON、Go 文本 profile，不认识任何 Rust 产物
  （`cargo-llvm-cov` 的 lcov tracefile 与 `llvm-cov export` JSON、`cargo-tarpaulin` 的
  lcov / Cobertura XML / `Summary.json`）。
- 本机实测：`cargo`/`rustc` 1.96.1（`x86_64-pc-windows-msvc`）可用，但
  `cargo llvm-cov --version` 与 `cargo tarpaulin --version` 都是 `error: no such command`。
- 还有一个意外障碍：rustls 自己的测试跑不起来——它的 x86_64 dev-dependencies 强拉 `aws-lc-sys`，
  其 build script 硬要 NASM：`panicked at aws-lc-sys-0.44.0/builder/nasm_builder.rs:137:
  NASM command not found!`。这就是 PoC 必须做成独立 crate + ring provider 的原因，
  不是风格选择。

因此第 4 条裁定的第 3、4 道门禁是"未评估"而不是"fail"：**缺覆盖率事实时，那道门禁记未评估，
不得当作驳回的承担者**——这是上一轮 PR #21 刚收敛的规则，本轮第一次在真实数据上用到它。

---

## 8. 怎么复现

```powershell
# 1. 克隆并检出范围两端（第三方源码只留在 .scratch/，gitignored）
git clone https://github.com/rustls/rustls .scratch/rustls

# 2. 确定性事实
node bin/euthyna.js audit --base v/0.23.44 --head v/0.23.45 --repo .scratch/rustls   # 退出码 10

# 3. PoC：分别在两个 tag 上跑同一份源码
git -C .scratch/rustls checkout v/0.23.44
Push-Location .scratch/rustls-poc; cargo run -- v0.23.44; Pop-Location
git -C .scratch/rustls checkout v/0.23.45
Push-Location .scratch/rustls-poc; cargo run -- v0.23.45; Pop-Location

# 4. 校验裁定报告的契约
node bin/euthyna.js gate audits/RUSTLS_EUTHYNA_AUDIT_2026-10-09.md                   # 退出码 0
```

PoC 的 Cargo.toml 用路径依赖并把 provider 限定成 ring：

```toml
[dependencies]
rustls = { path = "../rustls/rustls", default-features = false, features = ["ring", "logging", "std", "tls12"] }
rcgen = "0.13"
```

---

## 9. 局限性

- PoC 只证明**换 suite 被接受**（0.23.44）与**被拒绝**（0.23.45），没有证明任何密码学后果
  （例如跨 suite 的处理差异被利用）。影响等级取自公告的 CVSS（`C:L`），不是我测出来的。
- 第 2、4 条的 `not_evaluated` 是真未评估，不是"评估后认为无害"。
- `euthyna deps` 只报锁定版本事实，不做 Cargo 的模块图求解，也不判 CVE→版本映射；
  第 6 节的版本级比对来自临时脚本，不是产品能力。
- 全部结论在 Windows 单机、ring provider、直接喂 `ServerConnection`（不经真实网络握手）条件下
  得出；QUIC 路径与 `aws-lc-rs` provider 未测。
- rustls 的版本线在动：本轮的 feature 名与 API 位置取自 `0.23.45`，`main`（`0.24.0-dev.1`）上
  `default = ["tracing","webpki"]` 已经不同。按 tag 复现才有效。
