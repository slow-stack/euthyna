# euthyna 竞品定位分析

> 检索方式：**全类目**，不按 `category` 过滤。按类目过滤会漏掉散落在
> `tools` / `git` / `dev` 等类目下的同类工具，使空白判断系统性偏斜。
> 以下每条结论都标出证据基础。
>
> 数据：`data/dsh-plugins.json`（3931 插件，2026-09-18 快照）
> 工具：`tools/probe-audit-space.js`（带命中上下文的定位探针）
> 完整探针输出：`data/audit-space.txt`

---

## 0. 结论摘要

**「确定性测量」已被占满，「证据门禁」也已被占满。真正的空白是两者之间的那一层：**

> 没有任何东西把测量出来的事实，喂给一套**安全专属的结论判定纪律**，并据此**拦下不合格的交付**。

三个赛道各自都被占满了，但它们是**三座孤岛**：

| 赛道 | 占位情况 | 代表 |
|---|---|---|
| 确定性测量 | **拥挤**：8 个以上专用工具，各管一段 | `dsh-tool-lens`、`dsh-blast-radius`、`dsh-code-coverage`、`dsh-dep-vuln-scan`、`dsh-code-security` |
| 交付门禁 / 强制机制 | **拥挤且已产品化** | `dsh-doublecheck`、`formalswarm`、`dsh-expert-team`、`loopx` |
| 证据生命周期工作台 | **已被占** | `dsh-omv`（证据优先漏洞研究工作台） |

---

## 1. 赛道一：确定性测量（拥挤，但互相不连通）

八个体量相近的工具，各自测一段，**各自定义自己的输出形状**。核实要点：

| 工具 | 测什么 | 引擎 | 输出形状 |
|---|---|---|---|
| `dsh-tool-lens` (5★, dl=2186) | AST 代码图、调用链、循环依赖、影响面、diff 影响 | 自研，走 TypeScript 编译器 API | `CodeGraphResult{ nodes, edges, impactTiers, … }` |
| `dsh-blast-radius` (0★, dl=517) | 待提交编辑的**符号级**爆炸半径：生产调用点 vs **测试引用** | 包装 `tsserver`（LSP 客户端） | `BlastRadius{ impacts, risk, uncovered, reachedFiles }` |
| `dsh-code-coverage` (1★, dl=267) | AI 写的文件 × c8 真实执行覆盖，AI vs 人类覆盖率对比 | 包装 `c8` + 读 DSH 会话日志做归因 | CLI `--json` / `dsh-fix-plan.json` |
| `dsh-code-security` (1★, dl=1024) | 48 条正则规则 + 密钥熵检测 + diff 评审 | **零依赖自研规则表** | **SARIF 2.1.0** / Markdown |
| `dsh-dep-vuln-scan` (0★) | lockfile 依赖 × OSV，8 个生态，带修复版本 | 自研 lockfile 解析 + OSV HTTP | Markdown 表 + `presentationMeta` |
| `dsh-cve-audit` (2★) | 同上但只有 3 生态、无修复版本，自述「尚未在真实 dsh 上跑过」 | 自研 + OSV | 结构化 JSON |
| `dsh-trust-check` (0★, dl=1665) | **DSH 插件**的能力披露（8 类能力 + 5 条红线） | 自研静态扫描，规则表即数据 | **版本化集成契约** `schemaVersion:1` + 5 个稳定门禁字段 |
| `dsh-plugin-gate` (0★, dl=1099) | **插件源码**签名扫描（60 规则）+ 破坏性命令守卫 | 自研正则 + 自研 tar.gz 读取 | `verdict: BLOCK\|WARN\|PASS` |

### 关键观察

1. **作用域被切成三块，彼此不交叉**：自己的源码（tool-lens / blast-radius / code-security / code-coverage）、自己的依赖（dep-vuln-scan / cve-audit）、DSH 插件（trust-check / plugin-gate）。
2. **没有任何两个共享机器可读的事实 schema**。八种输出形状，只有 `dsh-code-security` 出 SARIF，只有 `dsh-trust-check` 有版本化契约。
3. **全都没有进程退出码契约**。门禁只表达为工具结果字段（`verdict` / `redLines` / `failOn`）或 hook 决策。对 CI 不可用。
4. 「测试覆盖」这一项**两次被半个覆盖**：`dsh-blast-radius` 用静态**测试引用**（按符号，不验证执行），`dsh-code-coverage` 用真实执行覆盖（按文件/行，无调用图）。**两者都不回答「这个被改符号的调用方有没有测试覆盖」**——那个 join 不存在。
5. **`dsh-blast-radius` 根本不是可调用工具**。它只挂一个 `tools/pre-execute` 瀑布钩子，无 tool、无文件产物、无退出码；且只支持 TS/JS，动态调用（反射 / `eval` / 字符串索引）拿不到。它的 `unavailable` 字段表示「不知道」且**从不渲染成安全**——这个「不知道 ≠ 安全」的处理值得借鉴。
6. **`dsh-tool-lens` 的「推荐测试」是图相邻，不是覆盖**。`src/analytics/git-diff.ts` 里 `affectedTestFiles` 取自图遍历中路径匹配测试文件模式的节点，即**结构上相邻**的测试文件，而不是覆盖了被改符号的测试。名字像覆盖，实质不是。
7. **`dsh-trust-check` 的契约设计最值得借鉴**：它把门禁面收窄到 5 个字段（`name` / `version` / `spec` / `capabilities` / `redLines`），并**明写「不要拿 `score` 或 `band` 做门禁」**，且 fail-closed——`errors` 非空一律当作扫描失败，而不是 `clear`。这正是「事实契约」该有的样子。
8. **`dsh-dep-vuln-scan` 的确认口径值得借鉴**：不直接信 OSV 的返回，而是「查询带 `version` 让 OSV 过滤 + 本地复核 `introduced ≤ version < fixed` 区间」才算确认。

---

## 2. 赛道二：交付门禁（拥挤，机制已产品化）

这一赛道已经产品化。下列项目都在做，而且做得比「一个 configPath」深：

| 项目 | 做了什么 |
|---|---|
| **`dsh-doublecheck`** (35★, dl=3120，2026-09-18 更新) | **两个原生 Cordis 插件行**；`intensity: remind/warn/block` 三档强制；**红绿测试证据门**（监听 `edit`/`write` 与 `bash`/`pwsh` 测试命令，用正则判定什么算「跑过测试」）；需求审讯门；交付报告 + 逐维度验证工作流 |
| **`formalswarm`** (2★) | **「verdict 由真实退出码与用例数算出，绝不出自散文」**；三方结构（thesis / critics / seal）；缺一项检查或空绿一律 `INCONCLUSIVE`，fail-closed；跨 Claude Code / ZCode / DSH 三家 runtime；带 `.claude-plugin/marketplace.json` |
| **`dsh-expert-team`** (1★, dl=2495) | 「质量门禁**由插件代码强制而非提示词请求**：未完成的任务不能标为完成」 |
| `loopx` (5893★) | 持久化 Goal / Todo / **门禁** / 证据 / 配额状态内核 |
| `review-gate` / `dsh-ocr-review` | 把代码评审变成硬闸门，未通过禁止合并 |
| `dsh-humanize` / `dsh-plan-lattice` / `dsh-punky-swarm` | 裁判阶段 / HMAC 终局评审门禁 / 引擎级质量门禁 |

**意义**：`formalswarm` 已经把 euthyna 的核心命题完整说出来了——「agent 说做完了不算数，判决必须能从产物重算」。
区别只在它**与安全无关**，`dsh-doublecheck` 同样**与安全无关**。

---

## 3. 赛道三：证据优先的漏洞审计（已被占，但形态不同）

**`dsh-omv`**（2★，MIT，`evidence-first vulnerability audit workbench`）是目前最接近的邻居：

- 证据成熟度五态 `unmapped / developing / supported / verified / contested`
- 发现账本 `candidate / confirmed / blocked / archived`
- `source → sink → guard` 证据链检查
- 去重、对抗评审、报告就绪信号
- **Docker 隔离的 PoC 实验室**（草稿 → 明确批准 → `/output/result.json` → 产物哈希）
- 版本化 HTTP 契约 `contracts/dsh-omv-api.v2.json`

**但它有两条硬边界**：

1. **形态是重型 UI 工作台**：52 个 `.ts` + 6 个 `.tsx` + React 客户端 + SSE + 29 个工具 + 19 个命令。
2. **不做代码测量**：引擎是外部 npm 包 `oh-my-vul`，持久化以 `.omv` 文件与 `oh-my-vul` schema 为准。没有调用图、没有覆盖率、没有 git 历史。

---

## 4. 直接竞品技能包：它恰好缺了判定这一环

`dsh-skill-pack-security`（13★，Apache-2.0）的 8 个技能（实测仓库文件树）：

```
secret-scan · dependency-audit · supply-chain-review · prompt-injection-review
security-audit · threat-model · vuln-intel · incident-response
```

**没有 commands、没有 agents、没有 hooks。** 主技能 `security-audit` 的 5 个阶段是：
固定审计对象 → 范围界定 → 资产清单 → 风险分级 → 逐项验证 → 报告。

它的纪律是**「报告里的每条发现，审阅者必须能用一条命令复核」**，
并且明写**「复核命令拿不到证据 → 降级为『观察』或删除」**。

**这意味着**：被 euthyna 当作差异点的「拿不出证据就降级为观察」，**竞品已经有了**。
它本质是**工具编排器 + 报告格式**（gitleaks / trivy / checkov / pnpm audit）。

**它没有的**（逐条对照 Trail of Bits 三个插件的原文，
用 `node tools/fetch-references.js trail-of-bits` 拉到 `.refs/trail-of-bits/`）：

| fp-check / differential-review 的机制 | 竞品是否有 |
|---|---|
| 数据流追踪、信任边界、source→sink | ❌ 全文无 |
| 可利用性判定（攻击者控制、可达性证明） | ❌ |
| 6 门禁（流程/可达性/真实影响/PoC/数学边界/环境） | ❌ |
| 13 条误报清单 | ❌ |
| 恶魔代言人 13 问（含 2 条防假阴性） | ❌ |
| 9 类缺陷的**默认假设翻转** | ❌ |
| 主要控制 vs 纵深防御的二分 | ❌ |
| PoC 要求（含 Negative PoC、人为绕过即无效） | ❌（`dsh-omv` 有 PoC 实验室） |
| 数学边界证明 | ❌ |
| 变更面 7 阶段 + 爆炸半径 + 安全回归 | ❌（只有爆炸半径被别的插件覆盖） |

---

## 5. 已确证的空白（八项，均有证据基础）

1. **没有「按符号 × 真实执行的覆盖率」的 join**。`dsh-blast-radius` 用测试**引用**，`dsh-code-coverage` 是文件级、无调用图。证据：两者 README 自述的限制。
2. **没有 git 历史回归分析**。八个 README 全文检索 `git log -S` / blame / reintroduce / 重加，无一命中。`dsh-tool-lens` 的 `diff_impact` 只做工作区/提交区间 diff。
   → 详见 §6（独立验证）。
3. **没有可利用性 / 可达性判定**。八个 README 检索 taint / data flow / reachability：0 命中。`dsh-code-security` 明写「发现只包含客观证据与 CWE 编号，不附修复建议」。
4. **没有共享事实 schema**。八种形状互不兼容。
5. **没有进程退出码 / CI 返回契约**。检索 `exit code|exitCode`：0 命中。
6. **没有跨仓库汇总**。
7. **没有可移植的抑制/基线交换格式**。三套互不兼容的 baseline（`secure_baseline` / `.dsh/gate-baseline.json` / blast-radius `records`）。
8. **没有任何单个插件同时覆盖「调用方 ∧ 测试 ∧ 依赖 ∧ 密钥」**，也没有产物把它们接起来。

---

## 6. git 历史回归分析的独立验证：**该假设被证伪**

针对该假设的证伪检索找到了直接反例。

### 6.1 直接证据

`solanabr/auditor-skill`（54★，MIT，Claude Code 插件）的 `commands/diff-audit.md` 第 14 行：

> Risk-classify changed files (auth / crypto / value-transfer / **validation-removal = HIGH**).
> **Git-blame removed security code — code deleted in a "fix" / "CVE" commit is a CRITICAL regression.**

这一句同时覆盖了假设中的 (a) 对已删除代码做 blame 与 (c) 校验被移除的标记。
它的 `/auditor:re-audit` 还有 **REGRESSED**（此前修好的问题又回来了）状态。
其 `ATTRIBUTION.md` 自陈来源是 Trail of Bits 的 `differential-review` → "Mode 4 — Differential Audit"。

第二处独立占位：`florianbuetow/claude-code` 的 `plugins/appsec/skills/regression`，
技能目的原文是「check for **reintroduced vulnerabilities**」，`REGRESSION` 定义为
「the fix was reverted, removed, or bypassed」。但它读的是自己的账本
`.appsec/fixed-history.json`，**不读 git**（该仓库内检索 `git log`/`git blame`/`git show` 均为 0 命中）。

### 6.2 但证伪只证伪了一半，而且剩下的一半才是关键

**两处占位都是 Markdown 里的模型指令，不是确定性引擎。**

`auditor-skill` 仓库 270 个文件里只有 **6 个 `.sh`（合计 14 KB）**，其余全是
checklists / agents / commands 的 Markdown；它的 `allowed-tools` 是
`Read, Grep, Glob, Bash, Task`——即**让 LLM 自己去跑 `git blame`，再自己读 commit message 下判断**。
没有产出结构化事实的脚本，没有 `git log -S` 的机械判定，没有可复现的判定口径。

**这正是「补上 agent 算不准的确定性事实」这一层的地盘，而它在上述证伪中完好无损。**

### 6.3 DSH 侧的子假设仍然成立

全 3931 个 DSH 插件中，这些词频**全部为 0**：
`git blame` / `pickaxe` / `git log -S` / `reintroduc` / `重加` / `deleted code` /
`removed validation` / `removed check` / `security fix` / `churn` / `bisect`。

唯一做行级 git 历史的是 `dsh-backstory`，它 blame 的是**存活的行**（解释「这行为什么在这」），
零安全框架，不涉及被删除的代码。

（噪音对照：`历史` 165 / `history` 129 / `provenance` 14 / `溯源` 16 / `regression` 11 / `回归` 8。
中文 `回归` 同时是「回归」和**统计学回归**——`Stata-AI-Skill` 是完美的误命中样本；
最大的噪音源是 `provenance`/`溯源`，在约 16 个记忆类插件里指**记忆的来源**，不是代码行的来源。）

### 6.4 尚未测完的一项（不作为结论）

**未测**：PowerShell 会把含 `-S` 的查询当成命令行开关
（`unknown shorthand flag: 'S'`），所以 `"git log -S" security` 这条查询**实际从未跑成**。
即「(b) 用 pickaxe 检出重加」是否无人做，**属于未测，不属于已证**。

> 改用 `gh api` 的 URL 编码查询可绕过 PowerShell 解析：`"git log -S" vulnerability`
> 返回 1080 条，前排全是 security-advisory 类技能与 `AGENTS.md`，**无一命中 pickaxe 重加检测**。
> 这仍是弱证据（GitHub 代码搜索会分词，短语匹配不严格），要下定论需要更窄的查询。

---

## 7. 对 euthyna 的含义

### 7.1 必须放弃的三个主张

| 原主张 | 为什么放弃 |
|---|---|
| 「确定性测量是生态空白」 | 已有 8+ 个专用工具，各管一段 |
| 「证据门禁 / 不许收工是空白」 | `dsh-doublecheck`、`formalswarm`、`dsh-expert-team`、`loopx` 已在做，机制比预想的更深 |
| 「git 历史安全回归无人做」 | 已被 `auditor-skill` 与 `florianbuetow/claude-code` 占位，**但占的是提示词层，不是确定性引擎层** |

### 7.2 可以站住的主张

> **把已有的确定性事实，接进一套安全专属的结论判定纪律，并让判定结果成为交付门禁。**

拆成三个可验证的动作：

1. **不重造测量**。调用方 / 覆盖 / 依赖 / 密钥都有现成工具。euthyna 定义一份**事实契约**，把它们的输出归一成同一形状（这正是空白 #4、#5）。
2. **补上真正没人做的那两件确定性测量**：
   - **git 安全回归的机械判定**——不是「让模型去 blame」，而是产出
     「这行被删的代码来自提交 X，其 message 命中 `fix|security|CVE`」
     「这段新增代码重加了在提交 Y 被移除的模式」这样的结构化事实。
   - **「符号 × 真实执行覆盖」的 join**（见 §5 空白 #1）。
3. **判定层是核心资产**：把 fp-check 的 6 门禁 / 13 条清单 / 恶魔代言人 13 问 / 9 类默认假设，
   落成一套**对事实契约消费**的判定流程，并用已验证的强制机制
   （`exit 2` + stderr，见 `docs/dsh-stop-gate-zh.md`）拦下不合格交付。

### 7.3 一句话的差异化

`dsh-doublecheck` 管**通用工程纪律**，`dsh-skill-pack-security` 管**工具编排与报告格式**，
`dsh-omv` 管**发现的生命周期与 PoC 实验室**，`auditor-skill` 管**提示词层的方法论**。

**没有人管「这条安全结论到底成不成立」，也没有人把测量结果做成机器可判定的事实。**
这就是 euthyna 的位置。

### 7.4 方法论教训

**「无人做 X」必须写成「无人做 X 且 X 的哪一层无人做」。**
三个假设全部被证伪，方式一模一样：把**提示词层的方法论**误当成**确定性引擎**，
或者只看 DSH 生态（3931 个插件）就外推到 Claude Code / Codex 生态。
