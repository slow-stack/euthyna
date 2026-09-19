# euthyna

> **εὔθυνα** —— 雅典官员离任时的账目审计。任期结束时必须交出账目接受审查，通不过，就无法体面地离任。

一个给 AI 编码 agent 用的**代码安全审计框架**。

它不是又一个扫描器，而是审计流程的**编排者**与审计结论的**裁决者**。

---

## 名字的来历

古希腊雅典的官员在任期届满时，不能拍屁股走人。他必须向审计官提交任内的全部账目，接受一项名为 **euthyna**（εὔθυνα）的审查。审查通过，他才能体面离任；账目不清，就要面对审判。

这个项目的核心机制，就是这件事的翻版：

> **agent 说"我做完了"不算数。账目（证据）交齐、门禁通过，才算交付。**

命名沿用 `mneme`（μνήμη，"记忆"）的路子——希腊语普通名词，一个词直接对应功能，不绕弯。

---

## 这个项目要解决什么

AI 编码 agent 现在很能写代码，但它报出来的安全问题**不可信**，原因有两个：

1. **它爱报假货。** 看到一段"看着危险"的代码就说是漏洞，不做数据流追踪，还倾向于把严重性往高里评。
2. **它算不准数。** 问它"这个函数有多少个调用方"，它只能翻几个文件猜；问它"这次改动有没有测试覆盖"，它靠印象答。

这两个毛病，靠"提示它仔细点"是治不好的。所以这个项目要做两件事：

- **补上它算不准的**：用确定性代码算出调用面、测试缺口、历史来源这些硬事实（这是 LLM 天生做不好的）
- **管住它爱乱报的**：每条结论必须过 6 道门禁，拿不出证据就只能降级为"观察"，不许写成"发现"

---

## 现状

**方案选型阶段**，尚未开始写代码。定位分析已按全类目重做完毕。

### 已完成

| 事项 | 产物 |
|---|---|
| 方法论 | `docs/methodology-zh.md` —— 基于 Trail of Bits 三个插件原文逐条对照重写的中文方法论 |
| **竞品定位（全类目重做）** | `docs/positioning-zh.md` —— 三个赛道、八个测量工具的能力对照、已确证空白八项 |
| **DSH 门禁事实核查** | `docs/dsh-stop-gate-zh.md` —— 用运行验证推翻了此前关于 hook 可原样搬迁的结论 |
| 源头原文留档 | `reference/trail-of-bits/` —— 24 个原文文件 |
| 宿主能力核实 | 见下节「已核实的宿主事实」 |
| 生态竞品目录 | `data/dsh-plugins.json` —— DSH 生态 3931 个插件的完整快照 |
| 调研脚本 | `tools/` —— 15 个查询 / 抓取 / 验证脚本，可复用 |

### 定位结论（一句话）

测量层（调用图 / 覆盖率 / 依赖 / 密钥）与门禁层（交付前强制）**都已被占满**。
真正的空白在中间那一层：**没有人把测量出来的事实，接进一套安全专属的结论判定纪律，
并让判定结果成为交付门禁。**

### 待办

- [ ] 确定确定性引擎的职责边界（做什么、**明确不做什么**）
- [ ] 决定引擎的事实产出契约（引擎输出字段 ↔ 判定层消费字段对齐）
- [ ] 确定落地形态与推进顺序
- [ ] 用 quick 档在真实仓库上实跑一次，量误报率
- [ ] 定许可证（见 `NOTICE.md` §1.3，发布前必须定）

---

## 已核实的宿主事实

以下均通过阅读本机 DSH 源码核实，**其中带 🧪 的由 `tools/check-stop-gate.mjs` 实际运行验证过**，不是推测：

### 技能契约

DSH 的技能 frontmatter 只认五个字段：`name` / `description` / `whenToUse` / `invocation` / `metadata`。

- `name` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `invocation` 缺省为 `{ modelInvocable: true, userInvocable: true }`
- **DSH 不认 Claude Code 的 `allowed-tools` 字段**——从别处搬技能时必须处理

### 技能发现路径（数字小者优先）

```
<项目>/.dsh/skills       100
<项目>/.agents/skills    200
customSkillDirs          300
<dshHome>/skills         400
<agentsHome>/skills      500
bundledSkillDir          内置
```

🧪 `agentsHome` 的解析式是 `config.agentsHome ?? $DSH_AGENTS_HOME ?? ~/.agents`，
本机走默认值，即 **DSH 实际加载的是 `~/.agents/skills`，不是 `~/.claude/skills`**。

`watch` 默认开启，Markdown 改动即时生效（插件改动才需要重启 `dsh web`）。

### hook 协议

DSH 原生实现了 Claude Code 的 hook 协议（`@deepseek-ai/dsh-hooks-claude-code`），支持七个事件：

```
SessionStart · UserPromptSubmit · PreToolUse · PostToolUse · Stop · SubagentStart · SubagentStop
```

`Stop` 可以阻塞并强制模型再跑一轮（模型可见文案 `continue: blocked by Stop hook`）。
🧪 实测确认：**脚本退出码 2 + 理由写到 stderr 即可拦截，理由逐字传给 agent**。
`SubagentStop` 则**只观测、不能阻塞**。

⚠️ **一条早期结论已被运行验证推翻**：Trail of Bits `fp-check` 的 `hooks.json` **不能原样搬到 DSH**——
它的两个 hook 都是 `"type": "prompt"`，而 DSH 只运行 shell command 形态的 handler，
实测会打出 `skipping unsupported "prompt" hook on Stop (only command hooks run)`。
更关键的是，DSH 的 Stop hook **拿不到对话内容**（`transcript_path` 恒为空），
所以「扫描对话检查门禁是否走完」这种用法在 DSH 上无法照搬。

完整的实测记录、三条拦截通路与三个必须自己处理的坑，见 `docs/dsh-stop-gate-zh.md`。
复现方式：`node tools/check-stop-gate.mjs`。

### 为什么这个项目可以跨 harness

- Codex 直接支持 Claude 的 plugin marketplace 格式（Trail of Bits README 明载）
- 因此 **`SKILL.md` 这一层内容天然跨三家**，一套 Markdown 三家共用
- 真正 harness 特定的只有三件事：hook 配置格式、宿主插件代码、分发入口

---

## 目录结构

```
euthyna/
├── README.md                 本文件
├── AGENTS.md                 给 AI agent 的项目上下文（会话交接用）
├── NOTICE.md                 第三方内容许可声明 + 许可方案待拍板项
├── docs/
│   ├── methodology-zh.md     中文审计方法论（核心计划文件）
│   ├── positioning-zh.md     竞品定位分析（全类目重做）
│   └── dsh-stop-gate-zh.md   DSH 门禁事实核查（含实测修正）
├── reference/
│   ├── trail-of-bits/        Trail of Bits 三个插件原文（24 文件，CC-BY-SA-4.0）
│   ├── competitors/          竞品技能原文（dsh-skill-pack-security）
│   └── dsh-plugin-anatomy/   DSH 插件最小骨架样本 + 上游插件清单
├── tools/                    调研脚本（Node，走本地代理隧道）
└── data/
    ├── dsh-plugins.json      DSH 生态插件目录快照（3931 条，约 4MB）
    └── audit-space.txt       定位探针的完整输出（含命中上下文）
```

### 关于 `tools/`

这些脚本是调研留下的，之后查竞品、查名字占用、验宿主行为还用得上：

| 脚本 | 用途 |
|---|---|
| `probe-audit-space.js` | **带命中上下文的定位探针**（做定位分析用这个，别用只打名字的 `probe-gaps.js`） |
| `check-stop-gate.mjs` | **Stop 门禁契约的可复现验证**：端到端跑真实 hook 桥接，断言拦截通路 |
| `fetch-catalog.js` | 经代理隧道抓取任意 URL（可下载插件目录） |
| `gh-search.js` | GitHub 仓库搜索 |
| `gh-tree.js` | 列出仓库文件树并按扩展名统计 |
| `gh-pull.js` | 批量下载仓库文件 |
| `probe-names.js` / `probe-naming.js` | 插件命名占用与命名分布分析 |
| `probe-gaps.js` | 旧版全类目覆盖探针（只打名字，仅作粗筛） |
| `probe-greek.js` | 希腊词根候选名的占用检查 |
| `npm-check.js` / `npm-info.js` | npm 包名可用性与详情查询（`npm-check.js` 支持命令行传名） |
| `inspect-plugin.js` | 查看目录里某个插件的完整元数据 |

运行前提：本机代理在 `127.0.0.1:7897`（脚本内的 `PROXY` 常量）。
所有查询类脚本读**仓库内**的 `data/dsh-plugins.json`，不依赖外部路径。

---

## 数据快照说明

`data/dsh-plugins.json` 的 `updated` 字段是 **2026-09-18**（从 `https://awesome-dsh-plugin.com/plugins.json` 抓取；该域名托管在 GitHub Pages，大陆直连被拒，需走代理）。

它是**快照**，会过期。需要最新数据时：

```powershell
node tools/fetch-catalog.js awesome-dsh-plugin.com /plugins.json data/dsh-plugins.json
```

---

## 许可

**本项目自身的许可证尚未选定**，发布（公开仓库 / 发 npm 包 / 发技能包）之前必须定。

`reference/trail-of-bits/` 下的内容版权归 Trail of Bits，采用 **CC-BY-SA-4.0**。
该许可的 ShareAlike 条款是否会影响本仓库其余部分、两种可选方案及其代价，
连同两份同行判例，写在 `NOTICE.md` §1。
