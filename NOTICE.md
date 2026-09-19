# 第三方来源与许可

## 本项目许可

**Apache License 2.0**，全文见 `LICENSE`。
Copyright 2026 euthyna contributors。

## 本仓库**不分发**任何第三方文件

这是有意设计的，不是遗漏。

本项目的调研需要反复阅读上游原文。但把上游原文**拷进仓库**会带来两个问题：
它让本仓库的许可证变得含糊（上游中有一份是 CC-BY-SA-4.0），
而且那份快照会悄悄与上游脱节。

所以原文改为**按需拉取**：

```powershell
node tools/fetch-references.js              # 全部拉取
node tools/fetch-references.js --list       # 只看清单，不下载
node tools/fetch-references.js competitors  # 只拉某一份
```

文件落到 `.refs/`（已 gitignore），并在同目录生成 `PROVENANCE.txt` 记录来源、分支、许可与拉取时间。
**这些文件不属于本项目，也不受本项目许可覆盖。**

已验证：拉取回来的 30 个文件与原先入库的副本**逐字节一致**（SHA-256 比对）。

## 上游来源与致谢

本项目的**方法论**主要借鉴以下两处公开工作。思想与方法不受版权保护，
本项目据此**自行实现**（包括代码与技能文本），并按学术惯例署名。

### Trail of Bits — `skills`

- 仓库：https://github.com/trailofbits/skills
- 许可：**CC-BY-SA-4.0**，Copyright Trail of Bits
- 借鉴内容：变更面安全审查（`differential-review`）、误报验证（`fp-check`，
  含 6 门禁、误报清单、恶魔代言人提问）、依赖供应链审计（`supply-chain-risk-auditor`）

他们选择 CC-BY-SA 而不是「保留所有权利」，本身就是一份**允许他人复用**的邀请。
本项目感谢这份公开工作，并**不把他们的文本重新授权**。

### dsh-skill-pack-security

- 仓库：https://github.com/PerryLink/dsh-skill-pack-security
- 许可：**Apache-2.0**，dsh-skill-pack-security contributors
- 借鉴内容：竞品能力边界分析；技能包型插件的 provider 骨架结构

## 上游原文**没有被改写进本仓库**

本仓库中的方法论与技能文本是**自行撰写的表述**，不是上游文档的翻译或逐句改写。
判断依据见下节。

### 为什么这一点需要单独说明

CC BY-SA 4.0 对 `Adapted Material` 的定义**明确包含 "translated"**
（CC 官方 legalcode 原文）：

> …material … derived from or based upon the Licensed Material and in which the
> Licensed Material is **translated**, altered, arranged, transformed, or otherwise modified…

也就是说：**翻译或逐句改写会构成改编物**，而 ShareAlike（§3(b)）要求改编物以相同许可分发。
本项目希望整体采用 Apache-2.0，因此**不能**包含对上游文本的改编。

同行的两种做法都印证了这条边界：

- `solanabr/auditor-skill`（MIT）在 `ATTRIBUTION.md` 中写明：上游以 git submodule 方式引用，
  「**A submodule is a reference (gitlink), not a copy, so no CC-BY-SA ShareAlike obligation
  attaches**」，方法论则「**re-implemented natively, in our own words (not copied)**」
- `dsh-skill-pack-security`（Apache-2.0）在 `THIRD_PARTY_NOTICES.md` 中声明技能与引擎
  **全部为原创**，未移植第三方代码

### ✅ 已解决：仓库内不含任何改编物

早期有一份 `docs/methodology-zh.md` 是按「逐条对照改写」写的，属于上述改编物候选。
它**已从仓库移除**。其中的内容改为**用自己的结构重新撰写**，落在技能里：

```
.agents/skills/euthyna/references/
├── meta-mechanisms.md      让流程不退化成走过场的机制
├── change-audit.md         变更面审计
├── dependency-audit.md     依赖面审计
├── bug-classes.md          缺陷类别与默认假设方向
├── verification-gates.md   结论面验证
└── fact-contract.md        事实的读法
```

这些文件是**原创表述**，不是上游文档的翻译。**本仓库现在整体适用 Apache-2.0，无例外。**

### 边界在哪

判据不是「有没有改代码」，而是**「你的文字是不是从人家的文字长出来的」**：

| 做了什么 | 是否需要相同许可 |
|---|---|
| 读它、理解方法、**用自己的结构重新表述** | ❌ 不需要 |
| **翻译它**，或照着它的段落逐句改写 | ✅ 需要 |
| 把原文件拷进仓库 | ✅ 需要 |

上表第二行是本项目早期踩到的点——**它和「改代码」无关**。

## DSH 插件目录快照

`data/dsh-plugins.json` 是公开插件目录 https://awesome-dsh-plugin.com/plugins.json 的快照
（`updated` 字段：2026-09-18，共 3931 条），仅用于生态调研。
其中各插件的名称、描述与链接归各自作者所有。

## DeepSeek Harness

本仓库中关于宿主能力的描述（技能 frontmatter 契约、hook 协议、技能发现路径等）
来自对本机安装的 DeepSeek Harness 源码的阅读与**运行验证**，属于对软件行为的**事实性描述**，
不复制其代码。

`tools/check-stop-gate.mjs` 会 `import` 本机 DSH 安装中的两个包
（`dsh-hook-protocol`、`dsh-hooks-claude-code`）以验证协议行为——它**引用**而非**分发**这些包。

DeepSeek Harness 及其相关包归其各自权利人所有。本项目与 DeepSeek 官方无隶属关系。
