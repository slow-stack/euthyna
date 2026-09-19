# 第三方内容声明

本仓库包含或改编自第三方作品的内容。依各原始许可的要求声明如下。

---

## 1. Trail of Bits Skills

**位置**：`reference/trail-of-bits/`
**上游**：https://github.com/trailofbits/skills
**版权**：Copyright Trail of Bits
**许可**：CC-BY-SA-4.0（Creative Commons Attribution-ShareAlike 4.0 International）

本目录下的 24 个文件是以下三个插件的原始文件，**未经修改**：

| 插件 | 内容 |
|---|---|
| `plugins/differential-review/` | 变更面安全审查（7 阶段方法论、对抗建模、报告模板、漏洞模式库） |
| `plugins/fp-check/` | 误报验证（6 门禁、13 条误报清单、深/标准验证路径、3 个子代理定义、hook 门禁） |
| `plugins/supply-chain-risk-auditor/` | 依赖供应链审计（技能定义与 Python 工具链说明） |

### 1.1 ShareAlike 的范围（已核实，非推测）

依据 CC 官方 legalcode 原文（`https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt`）：

- **`Adapted Material` 的定义明确包含 "translated"**：
  > …material … derived from or based upon the Licensed Material and in which the
  > Licensed Material is **translated**, altered, arranged, transformed, or otherwise modified…

  ⇒ 逐条对照的中文重写**很可能构成改编物**。

- **ShareAlike（§3(b)）的触发条件是「分发」**：
  > **if You Share Adapted Material** You produce, the following conditions also apply.
  > 1. The Adapter's License You apply must be a Creative Commons license with the
  >    same License Elements, this version or later, or a BY-SA Compatible License.

  ⇒ ShareAlike **只在对外分发改编物时生效**，且**只约束改编物本身**，
  不「传染」仓库里与其无关的独立作品（例如独立编写的代码）。

### 1.2 两份同行判例

**判例 A —— `solanabr/auditor-skill`（MIT，已发布，54★）**
其 `ATTRIBUTION.md` 原文：

> Vendored as a git submodule at `vendor/trailofbits` … **A submodule is a reference
> (gitlink), not a copy, so no CC-BY-SA ShareAlike obligation attaches** to
> auditor-skill's own MIT-licensed corpus.

> Several Trail of Bits *methodology patterns* are additionally **re-implemented
> natively, in our own words (not copied)**, and credited inline where used.

即两条做法：**上游用引用（submodule）而不是拷贝**；**方法论用自己的话重新实现并署名**。

**判例 B —— `dsh-skill-pack-security`（Apache-2.0）**
其 `THIRD_PARTY_NOTICES.md` 声明八个技能与 `plugin_vet` 引擎**全部为原创**，
「No third-party source is copied into the engine, and the two skill editions are original content」。

### 1.3 ⚠️ 待拍板：本仓库采用哪种方案

| 方案 | 做法 | 结果 | 代价 |
|---|---|---|---|
| **① 引用不拷贝 + 原创重写** | `reference/` 移出分发物（改由脚本按需拉取到 gitignored 目录）；`docs/methodology-zh.md` 与将来的 `SKILL.md` 用自己的结构与措辞重写，在 NOTICE 中署名来源 | 仓库可整体 **MIT / Apache-2.0** | 需重写方法论文档；「原创」需要自己把握 |
| **② 分层许可** | 保留现状：`reference/` 与 `docs/methodology-zh.md` 适用 CC-BY-SA-4.0，代码适用 MIT/Apache-2.0 | 改动最小 | 一个 npm 包里混两种许可，分发说明要写清；且 CC 许可**不适合软件**（无专利授权条款，不区分源码/目标码） |

**建议走 ①。** 理由：本项目最终要发 npm 包，而 CC-BY-SA 是为内容设计的、
不是为软件设计的许可；两份判例都证明 ① 在生态里可行且被接受。

> 现状：**尚未选定。发布（公开仓库 / 发 npm 包 / 发技能包）之前必须定。**

---

## 2. dsh-skill-pack-security

**位置**：`reference/competitors/`
**上游**：https://github.com/PerryLink/dsh-skill-pack-security
**许可**：Apache-2.0

本目录下的 2 个文件（`security-audit` 与 `dependency-audit` 技能定义）为该项目的原始文件，
用于竞品能力边界分析，未经修改。

---

## 3. DSH 插件目录快照

**位置**：`data/dsh-plugins.json`
**上游**：https://awesome-dsh-plugin.com/plugins.json （源自 awesome-dsh-plugin 项目）

该文件是公开插件目录的抓取快照，用于生态调研。其中各插件的名称、描述与链接归各自作者所有。
快照 `updated` 字段：**2026-09-18**，共 3931 条。

---

## 4. 本轮调研读取但**不分发**的第三方内容

以下内容仅在本机用于竞品分析，**未进入版本控制**（存于 `.scratch/`，已在 `.gitignore` 中）：

| 来源 | 许可 | 用途 |
|---|---|---|
| `bx33661/dsh-omv` | MIT | 读取其 README / ARCHITECTURE / 契约快照，判断「证据优先审计工作台」的能力边界 |
| `fashionmascherine-svg/formalswarm` | 见其仓库 | 读取其 SKILL.md，判断「判决由退出码算出」这一机制的占位情况 |
| `PerryLink/dsh-doublecheck` | 见其仓库 | 读取其 README，判断交付门禁的成熟度 |
| `solanabr/auditor-skill` | MIT | 读取其 `commands/diff-audit.md` 与 `ATTRIBUTION.md`，用于证伪「git 历史回归无人做」 |
| 另 8 个 DSH 插件（blast-radius / tool-lens / code-coverage / code-security / cve-audit / dep-vuln-scan / trust-check / plugin-gate）的 README | 各自 | 测量层竞品能力对照 |

结论写入 `docs/positioning-zh.md`，只引用短句与事实，不复制其原文。

---

## 5. DeepSeek Harness 相关

本仓库中关于宿主能力的描述（技能 frontmatter 契约、hook 协议、技能发现路径等）来自对
本机安装的 DeepSeek Harness 源码的阅读与**运行验证**，属于对软件行为的**事实性描述**，
不复制其代码。

其中 `tools/check-stop-gate.mjs` 会 `import` 本机 DSH 安装中的两个包
（`dsh-hook-protocol`、`dsh-hooks-claude-code`）以验证协议行为——它**引用**而非**分发**这些包。

DeepSeek Harness 及其相关包归其各自权利人所有。本项目与 DeepSeek 官方无隶属关系。
