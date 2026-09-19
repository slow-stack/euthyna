# 第三方内容声明

本仓库包含或改编自第三方作品的内容。依各原始许可的要求声明如下。

---

## 1. Trail of Bits Skills

**位置**：`reference/trail-of-bits/`
**上游**：https://github.com/trailofbits/skills
**版权**：Copyright Trail of Bits
**许可**：CC-BY-SA-4.0（Creative Commons Attribution-ShareAlike 4.0 International）

本目录下的 24 个文件是以下三个插件的原始文件，未经修改：

| 插件 | 内容 |
|---|---|
| `plugins/differential-review/` | 变更面安全审查（7 阶段方法论、对抗建模、报告模板、漏洞模式库） |
| `plugins/fp-check/` | 误报验证（6 门禁、13 条误报清单、深/标准验证路径、3 个子代理定义、hook 门禁） |
| `plugins/supply-chain-risk-auditor/` | 依赖供应链审计（技能定义与 Python 工具链说明） |

**ShareAlike 提示**：`docs/methodology-zh.md` 是基于上述原文逐条对照后重写的中文方法论。
若该文档被认定为上述作品的改编物（而非独立创作），则它需要以 **CC-BY-SA-4.0** 分发。
在确定本仓库自身的许可证之前，需要先厘清这一点。

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
快照抓取时间：2026-09-19。

---

## 4. DeepSeek Harness 相关

本仓库中关于宿主能力的描述（技能 frontmatter 契约、hook 协议、技能发现路径等）来自对
本机安装的 DeepSeek Harness 源码的阅读，属于对软件行为的**事实性描述**，不复制其代码。

DeepSeek Harness 及其相关包归其各自权利人所有。本项目与 DeepSeek 官方无隶属关系。
