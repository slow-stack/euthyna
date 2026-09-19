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

**已经能跑了。** 技能（方案 A）与两个确定性事实产出器都已落地并实跑验证。

### 怎么用

```powershell
# 被删除的代码来自哪里、那个提交是不是安全修复
node bin/euthyna.js history --repo D:\some\repo --base main --head HEAD
node bin/euthyna.js history --repo D:\some\repo --base main --pickaxe   # 另查「被移除又加回」

# 某个符号在测试运行中到底有没有被调用过
node bin/euthyna.js coverage --coverage coverage/coverage-final.json --symbol checkPermission
```

加 `--json` 得到结构化的事实报告。**退出码是对外契约**（生态里八个同类工具都没有这个）：

| 退出码 | 含义 |
|---|---|
| `0` | 已测量，没有安全相关的发现 |
| `10` | 已测量，且存在被分类为 `security` 的事实 |
| `1` | 用法错误 |
| `2` | **完全无法测量**——此时不得当作干净 |

零第三方依赖：跑 `npm test`（56 个用例）不需要 `npm install`。

### 已完成

| 事项 | 产物 |
|---|---|
| 方法论 | `docs/methodology-zh.md` —— 基于 Trail of Bits 三个插件原文逐条对照重写的中文方法论 |
| **事实产出器** | `bin/` + `src/` —— `history`（git 安全回归）与 `coverage`（调用计数，只能证伪） |
| **事实契约** | `docs/fact-contract-zh.md` —— 测量层 ↔ 判定层的接口，契约的约束由代码强制 |
| **竞品定位（全类目重做）** | `docs/positioning-zh.md` —— 三个赛道、八个测量工具的能力对照、已确证空白八项 |
| **DSH 门禁事实核查** | `docs/dsh-stop-gate-zh.md` —— 用运行验证推翻了此前关于 hook 可原样搬迁的结论 |
| **第一次 quick 档实跑** | `audits/AXE-CORE_EUTHYNA_AUDIT_2026-09-19.md` —— 5 个候选全为误报，含逐条裁定与局限性声明 |
| 源头原文留档 | `reference/trail-of-bits/` —— 24 个原文文件 |
| 生态竞品目录 | `data/dsh-plugins.json` —— DSH 生态 3931 个插件的完整快照 |
| 调研脚本 | `tools/` —— 查询 / 抓取 / 验证脚本，可复用 |

### 定位结论（一句话）

测量层（调用图 / 覆盖率 / 依赖 / 密钥）与门禁层（交付前强制）**都已被占满**。
真正的空白在中间那一层：**没有人把测量出来的事实，接进一套安全专属的结论判定纪律，
并让判定结果成为交付门禁。**

### 待办

- [ ] 用「已知含真缺陷」的靶场验证**召回率**——至今 0 真阳性，只证明了能筛掉假阳性
- [ ] 让技能真正调用事实产出器（CLI 已可用，技能还没写「何时调它、怎么读它的输出」）
- [ ] 把阶段 A / B 与 9 类缺陷拆进技能的 `references/`，并让技能自包含
- [ ] 定许可证并清理改编物（见 `NOTICE.md` §1.3，发布前必须做完）

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
