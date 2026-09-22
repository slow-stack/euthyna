---
description: 代码安全审计：按 euthyna 纪律审一段代码、一次变更或一条漏洞结论，产出带证据的报告
argument-hint: "<路径 或 diff 范围>"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /euthyna — 代码安全审计（判定纪律）

**审计目标：** $ARGUMENTS

按 euthyna 技能执行一次完整审计：

1. **先加载纪律**：找到 euthyna 技能目录（`~/.claude/skills/euthyna/`、项目 `.claude/skills/euthyna/` 或 `.agents/skills/euthyna/`），读 `SKILL.md`，需要时再读 `references/`。找不到就明说「技能缺失」，不要凭印象执行。
2. **按入口决策树走**：单条漏洞结论 → 阶段 C；一次变更 → 阶段 B；依赖面 → 阶段 A；整体审计 → 阶段 B 为主。
3. **先测量再读码**：diff 有删除行先跑 `history`；谈测试覆盖先跑 `coverage`；依赖声明先跑 `deps`（操作手册在 `references/fact-producers.md`）。
4. **每条结论过六道门禁**：证据到 `文件:行号`、可复现命令、影响说明；拿不出证据的降级为「观察」。
5. **三态裁定**：`BUG #N TRUE POSITIVE / FALSE POSITIVE / INCONCLUSIVE`。
6. **报告落盘**：`<项目>_EUTHYNA_AUDIT_<日期>.md`，并跑 `euthyna gate <报告>` 校验（退出码 0 才算过）。
