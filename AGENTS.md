# AGENTS.md — euthyna 项目上下文

> 这份文件是给在本目录工作的 AI agent 读的。DSH 会自动加载它（候选文件名 `AGENTS.md` / `CLAUDE.md`，从项目根沿祖先链读取）。
> 它承载上一轮对话的研究结论，目的是让你不必重新调研已经查清的事，也不必继承已经被推翻的错误结论。

---

## 一句话

`euthyna` 是一个给 AI 编码 agent 用的**代码安全审计框架**：补上 agent 算不准的确定性事实，管住 agent 爱乱报的结论。

## 名字来历

εὔθυνα —— 雅典官员离任时的**账目审计**。任期结束必须交出账目接受审查，通不过就无法体面离任。
项目核心机制即此：**agent 说"我做完了"不算数，账目（证据）交齐、门禁通过，才算交付。**

命名沿用 `mneme`（μνήμη，"记忆"）的路子：希腊语普通名词，一个词直接对应功能。

## 当前阶段

**方案选型，尚未写任何代码。** 已产出方法论与研究资料，但**定位分析需要重做**（见"已推翻的结论"）。

---

## 已核实的事实（不要重新调研）

以下均通过阅读本机 DSH 源码核实，不是推测。

### 技能契约

DSH 技能 frontmatter 只认五个字段：`name` / `description` / `whenToUse` / `invocation` / `metadata`。

- `name` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `invocation` 缺省 `{ modelInvocable: true, userInvocable: true }`
- **不认 Claude Code 的 `allowed-tools`** —— 从别处搬技能时必须处理

### 技能发现路径（数字小者优先，项目级可覆盖全局）

```
<项目>/.dsh/skills       100
<项目>/.agents/skills    200
customSkillDirs          300
~/.dsh/skills            400
<agentsHome>/skills      500   （本机 agentsHome 指向 ~/.claude）
bundledSkillDir          内置
```

`watch` 默认开启，Markdown 改动即时生效；插件改动才需重启 `dsh web`。

### hook 协议（本项目最关键的发现）

DSH 原生实现 Claude Code hook 协议（`@deepseek-ai/dsh-hooks-claude-code`），六个事件：

```
SessionStart · UserPromptSubmit · PreToolUse · PostToolUse · Stop · SubagentStop
```

`Stop` hook 返回 block 会让 agent 继续（源码文案 `continue: blocked by Stop hook`）。
配置项 `configPath` 必填，接受 settings 格式（带 `hooks` 键）或裸 `hooks.json`。

**意义**：Trail of Bits 的 `fp-check` 靠 `hooks.json` 的 Stop 门禁强制"没验证完不许收工"，
而 DSH 原生支持同一套协议 —— **这套强制机制不需要写 JavaScript，JSON 可原样搬**。
另有 `dsh-hooks-codex` 支持 Codex 格式。

### 跨 harness 可行性

- DSH 加载 `~/.claude/skills`，兼容 Claude Code 与 Codex 的 hook 协议
- Codex 直接支持 Claude 的 plugin marketplace 格式（Trail of Bits README 明载）
- 所以 **`SKILL.md` 这一层天然跨三家**，一套 Markdown 三家共用
- harness 特定的只有三件事：hook 配置格式、宿主插件代码、分发入口

### DSH 插件机制

- 插件即 npm 包，装法 `dsh plugin --profile web add <包名>`（转发 pnpm）
- 官方目录 `https://awesome-dsh-plugin.com/plugins.json`（GitHub Pages，大陆直连被拒，需代理）
- 技能包型插件的最小实现：复用官方 `FileSystemSkillProvider`，核心约 6 行
  （样本见 `reference/dsh-plugin-anatomy/provider-index.ts`，共 126 行，其中纯核心 6 行）

---

## 已推翻的结论（不要继承）

### ❌ "确定性测量（调用图 / 爆炸半径 / 测试覆盖）是生态空白区"

**这个结论错了，起因是搜索方法论有缺陷。**

上一轮分析时对 catalog 加了 `category === 'security'` 过滤，而这类工具本来就散落在
`tools` / `git` / `dev` 类目，导致漏判。去掉过滤后重搜的真实情况：

| 赛道 | 实际占位 |
|---|---|
| 代码图 / 调用图 | **已有 10+ 个**：`geml`(26★)、`dsh-codegraph`(9★)、`dsh-tool-lens`(dl=2186)、`dsh-code-index`(dl=1135)、`dsh-plugin-kit#codegraph`(dl=1956) 等 |
| 波及面 + 调用方测试覆盖 | `dsh-blast-radius`（git 类目，0★，dl=517）已做 |
| 覆盖率 | `dsh-code-coverage` |

**教训**：做竞品/能力覆盖分析时，**必须全类目搜索，不能按 category 过滤**。
`tools/probe-gaps.js` 已按此修正。

### ⚠️ 尚未验证的空白假设

以下仍需在全类目下重验，不要当作已确立的事实：

- 可利用性判定（6 门禁 / 恶魔代言人）是否真的无人做
- git 历史回归分析（`git log -S` 追溯 + 重加检测）是否真的无人做

---

## 待办

1. **用全类目重做竞品定位分析**（`tools/probe-gaps.js`），确立真正的空白区
2. 确定确定性引擎的职责边界：做什么、明确不做什么
3. 确定落地形态与推进顺序
4. 决定引擎的事实产出契约（引擎输出字段 ↔ 判定层消费字段对齐）

### 落地形态的既有倾向（未最终确认）

```
方案 A：纯 Markdown 技能（0 行 JS）        ← 建议起步
方案 B：加 hook 门禁（0 行 JS，一个 configPath）
方案 C：打包成插件（约 20–130 行 TS provider）
```

倾向 A → B → C 不跳级：方法论价值只能靠真实审计结果证明，包插件只是分发手段。

---

## 工作约定（本仓库）

### 必须遵守

- **提交不得含任何 AI 署名**：不加 `Co-Authored-By`，不加 "Generated with"，不加任何工具署名
- **对外文本（PR / issue / 评论 / 公开发布内容）必须先写入草稿文件给用户过目**，用户说"发"才发，不得自行发布
- 公开文本**只写事实与决策**（背景 / 改动 / 验证 / 设计取舍），**绝不写**"需要你定""等你确认""听你的"这类内部问句；需拍板的事只在对话里私下问
- 引入任何第三方插件或依赖前，**先拉源码审计干净再装**
- 提交前跑通该跑的验证，不要凭印象说"应该没问题"

### 沟通

- 用户是非科班背景，**决策时需要讲解原理**，不要只丢结论和代码
- 直接给答案，不绕弯子

---

## 环境与工具坑（本机实测）

| 坑 | 绕法 |
|---|---|
| `web_search` / `web_fetch` 报 "Every engine failed" 或 "resolves to a non-public IP" | DNS 是 fake-ip（198.18.x.x）。改用 `tools/` 下的 Node 脚本，经本地代理 CONNECT 隧道 `127.0.0.1:7897` 直连 |
| `registry.npmjs.org` 等直连失败 | 同上，走代理隧道 |
| 写工作区之外的路径被拒 | 放宽一次沙箱（`danger-full-access`），本机固定绕法 |
| `curl` 报 `schannel: SEC_E_NO_CREDENTIALS` | 沙箱下无法取证书凭据；改用 Node（自有 TLS 栈） |
| PowerShell 里 `node -e "..."` 转义易崩 | 把脚本写成 `.js` 文件再执行 |

---

## 关键文件导航

| 路径 | 是什么 |
|---|---|
| `docs/methodology-zh.md` | **核心计划文件**。中文审计方法论，基于 Trail of Bits 三个插件逐条对照重写 |
| `reference/trail-of-bits/` | 三个上游插件的 24 个原文文件（CC-BY-SA-4.0，见 NOTICE.md） |
| `reference/competitors/` | 竞品 `dsh-skill-pack-security` 的技能原文 |
| `reference/dsh-plugin-anatomy/` | DSH 技能包型插件的最小骨架样本 |
| `tools/probe-gaps.js` | **全类目**能力覆盖分析（做定位分析用这个） |
| `data/dsh-plugins.json` | DSH 生态 3931 个插件目录快照（2026-09-19） |

方法论文档的详细内容（九个元机制、三阶段流程、6 门禁、13 条误报清单、9 类缺陷专项要求）
全部在 `docs/methodology-zh.md`，本文件不重复。

---

## 许可注意

`reference/trail-of-bits/` 是 **CC-BY-SA-4.0**（Trail of Bits）。
`docs/methodology-zh.md` 基于其重写，若被认定为改编物则需以同许可分发。
本仓库自身许可证**尚未确定**，发布前需先厘清。详见 `NOTICE.md`。
