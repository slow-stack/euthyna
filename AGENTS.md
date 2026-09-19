# AGENTS.md — euthyna 项目上下文

> 这份文件是给在本目录工作的 AI agent 读的。DSH 会自动加载它（候选文件名 `AGENTS.md` / `CLAUDE.md`，从项目根沿祖先链读取）。
> 它承载上一轮对话的研究结论，目的是让你不必重新调研已经查清的事，也不必继承已经被推翻的错误结论。
>
> **注意**：「已推翻的结论」章节是**故意保留**的。目前已有三条结论翻车，
> 保留翻车记录是为了让你不重蹈覆辙，不是让你继承它们。

---

## 一句话

`euthyna` 是一个给 AI 编码 agent 用的**代码安全审计框架**：补上 agent 算不准的确定性事实，管住 agent 爱乱报的结论。

## 名字来历

εὔθυνα —— 雅典官员离任时的**账目审计**。任期结束必须交出账目接受审查，通不过就无法体面离任。
项目核心机制即此：**agent 说"我做完了"不算数，账目（证据）交齐、门禁通过，才算交付。**

命名沿用 `mneme`（μνήμη，"记忆"）的路子：希腊语普通名词，一个词直接对应功能。

## 当前阶段

**方案 A 已起步，技能可加载。** 定位分析已重做（`docs/positioning-zh.md`），
事实契约已成稿（`docs/fact-contract-zh.md`），技能主入口与阶段 C 已落地
（`.agents/skills/euthyna/`，在本仓库内即时生效）。

下一步是**在真实仓库上跑一次 quick 档**，量误报率——方法论的价值只能靠这个证明。

---

## 已核实的事实（不要重新调研）

以下均通过阅读本机 DSH 源码核实；带 🧪 的由 `tools/` 下脚本**实际运行**验证过，不是推测。

### 技能契约

DSH 技能 frontmatter 只认五个字段：`name` / `description` / `whenToUse` / `invocation` / `metadata`。

- `name` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- `invocation` 缺省 `{ modelInvocable: true, userInvocable: true }`
- **不认 Claude Code 的 `allowed-tools`** —— 从别处搬技能时必须处理

### 技能发现路径（数字小者优先，项目级可覆盖全局）

源码：`dsh-skill-filesystem/lib/index.js:150-187`（`roots()`）。

```
<项目>/.dsh/skills       100   PROJECT_DSH_RANK
<项目>/.agents/skills    200   PROJECT_AGENTS_RANK
customSkillDirs          300   CUSTOM_RANK
<dshHome>/skills         400   USER_DSH_RANK    （本机 DSH_HOME=~\.dsh，该目录不存在）
<agentsHome>/skills      500   USER_AGENTS_RANK
bundledSkillDir          内置  BUNDLED_SKILL_RANK
```

🧪 **`agentsHome` 实际指向 `~/.agents`，不是 `~/.claude`。**
解析式 `config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents")`（`lib/index.js:78`）。
本机实测 `DSH_AGENTS_HOME` 为空、profile 配置无 `agentsHome`，故走默认值。
判决性实验：65 个仅存在于 `~/.agents/skills` 的技能出现在会话技能目录；5 个仅存在于
`~/.claude/skills` 的技能（`avoid-ai-writing` / `de-ai-writer` / `efecto-fx` / `shuorenhua` /
`stop-slop-zh`）**全部缺席**。

> ⚠️ 上一轮写的「本机 agentsHome 指向 ~/.claude」**是错的**，已修正。
> 另：`brainstorming` 等技能两个目录里都没有，说明还存在**插件提供的技能根**（plugin provider），
> 上表只覆盖文件系统 provider。

`watch` 默认开启，Markdown 改动即时生效；插件改动才需重启 `dsh web`。

### hook 协议（⚠️ 上一轮结论有严重错误，已实测修正）

DSH 原生实现 Claude Code hook 协议（`@deepseek-ai/dsh-hooks-claude-code`），支持**七个**事件：

```
SessionStart · UserPromptSubmit · PreToolUse · PostToolUse · Stop · SubagentStart · SubagentStop
```

- `Stop` **能**阻塞：折叠为 `deny` 后走 `agent.steer()`，强制模型再跑一轮
- `SubagentStop` **只观测，不能阻塞**（源码里该分支不做决策折叠）
- `SubagentStart` 只能给仍在运行的同进程 child 注入上下文

#### ❌ 上一轮的错误结论：「fp-check 的 hooks.json 可原样搬，不需要写 JavaScript」

**实测推翻。原样搬过去一个 hook 都不会跑。** 两层原因，各自独立致命：

1. **`prompt` 类型的 hook 被跳过。** fp-check 那两个 hook 都是 `"type": "prompt"`，
   而 DSH 只执行 shell command handler（`lib/index.js:73`、`:147`）。
   实测打出的警告：`skipping unsupported "prompt" hook on Stop (only command hooks run)`。
2. **Stop hook 看不到对话。** 🧪 实测抓到的完整 stdin payload 就这些：

   ```json
   {"session_id":"…","transcript_path":"","cwd":"…","hook_event_name":"Stop","stop_hook_active":false}
   ```

   `transcript_path` **恒为空**（桥接文档：持久化 seam 不暴露产物路径，会话日志是 zstd 压缩的，
   hook 脚本读不了）；没有 `last_assistant_message`；没有任何消息数组。
   所以 fp-check 那句「扫描对话检查 6 门禁有没有走完」**在 DSH 上物理上做不到**。

**仍然成立的**：拦截机制本身有效。🧪 实测三条通路：

| 写法 | 结果 |
|---|---|
| 脚本 **退出码 2** + 理由写到 **stderr** | ✅ 拦截，理由逐字传给 agent |
| stdout 输出 `{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny","permissionDecisionReason":"…"}}` | ✅ 拦截 |
| stdout 输出 fp-check 的 `{"ok":false,"reason":"…"}`（退出码 0） | ❌ **不拦截** |

折叠规则 `deny > ask > allow`；退出码 2 解码为 `block`（rank 3，等同 `deny`）。
另：`configPath` 必填，接受 settings 格式（带 `hooks` 键）或裸 `hooks.json`。

**三个必须自己处理的坑**：

- **门禁必须自带限流**。DSH 没有轮次预算，`stop_hook_active` 恒为 `false`。
  无条件阻塞 = 每个 step 都强制 continuation，**死循环**。
- **hook 配置是进程级、启动时只读一次**。改 `hooks.json` 要重启 `dsh web`——与 Markdown 热重载不同。
- **子代理拿不到门禁**。`SubagentStop` 不能阻塞，且 `agent_type` 恒为 `general-purpose`。

复现：`node tools/check-stop-gate.mjs`（只读，不 spawn 进程，不写配置）。
完整分析见 `docs/dsh-stop-gate-zh.md`。另有 `dsh-hooks-codex` 支持 Codex 格式。

### 跨 harness 可行性

- DSH 加载的技能根是 `~/.agents/skills`（见上），**不是** `~/.claude/skills`
- Codex 直接支持 Claude 的 plugin marketplace 格式（Trail of Bits README 明载；
  `auditor-skill` 与 `formalswarm` 都带 `.claude-plugin/marketplace.json`）
- 所以 **`SKILL.md` 这一层天然跨三家**，一套 Markdown 三家共用
- harness 特定的只有三件事：hook 配置格式、宿主插件代码、分发入口

### DSH 插件机制

- 插件即 npm 包，装法 `dsh plugin --profile web add <包名>`（转发 pnpm）
- 官方目录 `https://awesome-dsh-plugin.com/plugins.json`（GitHub Pages，大陆直连被拒，需代理）
- 技能包型插件的最小实现：复用官方 `FileSystemSkillProvider`，核心约 6 行
  （样本见 `reference/dsh-plugin-anatomy/provider-index.ts`，共 126 行，其中纯核心 6 行）

---

## 已推翻的结论（不要继承）

### ❌ 1.「确定性测量（调用图 / 爆炸半径 / 测试覆盖）是生态空白区」

起因是搜索方法论有缺陷：上一轮对 catalog 加了 `category === 'security'` 过滤，
而这类工具本就散落在 `tools` / `git` / `dev` 类目。
去掉过滤后：调用图 10+ 个、爆炸半径有 `dsh-blast-radius`、覆盖率有 `dsh-code-coverage`。
完整对照表见 `docs/positioning-zh.md` §1。

**教训**：做覆盖分析**必须全类目搜索，不能按 category 过滤**。

### ❌ 2.「证据门禁 / 不许收工是生态空白区」

**同样错了。** 至少四个项目在做，且比预想的深：

- `dsh-doublecheck`（35★，dl=3120）：两个原生 Cordis 插件行、`intensity: remind/warn/block` 三档、
  **红绿测试证据门**（监听 `edit`/`write` 与 `bash`/`pwsh` 的测试命令，用正则判定什么算「跑过测试」）
- `formalswarm`（2★）：**「verdict 由真实退出码与用例数算出，绝不出自散文」**，fail-closed 到 `INCONCLUSIVE`
- `dsh-expert-team`（1★）：质量门禁由插件代码强制，而非提示词请求
- `loopx`（5893★）：持久化 Goal / Todo / 门禁 / 证据状态内核

**教训**：`formalswarm` 已经把我们的核心命题说完了，差别只在它**与安全无关**。

### ❌ 3.「git 历史安全回归分析无人做」

**被证伪。** `solanabr/auditor-skill`（54★，MIT）的 `commands/diff-audit.md` 第 14 行：

> Git-blame removed security code — code deleted in a "fix" / "CVE" commit is a CRITICAL regression.

另一处：`florianbuetow/claude-code` 的 `plugins/appsec/skills/regression`（但读自己的账本，不读 git）。

**但只证伪了一半，剩下的一半才是我们的地盘**：两处占位**都是 Markdown 里的模型指令**，
不是确定性引擎。`auditor-skill` 270 个文件里只有 6 个 `.sh`（14 KB），
`allowed-tools: Read, Grep, Glob, Bash, Task`——让 LLM 自己跑 `git blame`、自己读 commit message 下判断。

**教训**：「无人做 X」必须写成「无人做 X **且 X 的哪一层无人做**」。
三条假设翻车方式一模一样：把**提示词层的方法论**误当成**确定性引擎**，
或者只看 DSH 生态（3931 插件）就外推到 Claude Code / Codex 生态。

### ⚠️ 仍未测完的一项（不许当成结论）

「用 pickaxe（`git log -S`）**机械**检出被重新加回的漏洞」是否无人做——**属于未测，不属于已证**。
子代理的查询被 PowerShell 当成命令行开关吃掉了（`unknown shorthand flag: 'S'`），那条实际没跑成。
本轮复跑（改用 `gh api` URL 编码）返回结果过于宽泛——GitHub 代码搜索会分词——不足以下结论。

---

## 待办

1. **quick 档实跑**（最优先）：在真实仓库上跑一次，量误报率
   —— 方法论的价值只能靠这个证明。建议目标 `D:\axe-core\axe-core` 或 dsh-mneme 的某个真实 PR
2. **把阶段 A / B 与 9 类缺陷拆进技能 `references/`**
   （`change-audit.md` / `dependency-audit.md` / `bug-classes.md`），
   并把事实契约复制进去让技能自包含
3. **实现两件自研测量**：git 安全回归的机械判定；「符号 × 真实执行覆盖」的 join
   （后者的可行性正在独立验证中）
4. **完成许可清理**（见文末「许可注意」，两件工作）

### 落地形态的既有倾向（⚠️ 方案 B 的成本已被实测上调）

```
方案 A：纯 Markdown 技能（0 行 JS）          ← ✅ 已起步，技能可加载
方案 B：加 hook 门禁（原以为 0 行 JS）        ← 实为「一个 gate 脚本 + configPath」，且只能做产物式门禁
方案 C：打包成插件（原生 Cordis provider）    ← 价值上升：拿得到 agent 对象与会话，可做对话式门禁
```

**关键推论**：想检查「6 门禁有没有真走完」这类**对话内事实**，command hook 走不通（看不到对话），
必须走 C。B 只适合「报告落盘了吗」「测试命令真跑过吗」这类**产物式事实**。

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
| **`gh search code` 查含 `-S` 的短语会被当成命令行开关吃掉** | 改用 `gh api "search/code?q=<URL编码>"`，或 `--%` 停止解析 |
| **拉进来的第三方仓库自带 `AGENTS.md`，会被 DSH 自动加载并当成指令** | 本轮实测命中（`formalswarm/AGENTS.md` 讲的是它自己的 push 流程）。**第三方原文一律放 `.scratch/`**（已 gitignore），且不要在里面执行命令 |
| `git diff --stat` 报 `LF will be replaced by CRLF` | 本仓库在 Windows 上，行尾警告不影响内容；提交前用 `git diff --stat` 确认改动面即可 |

---

## 关键文件导航

| 路径 | 是什么 |
|---|---|
| `.agents/skills/euthyna/SKILL.md` | **技能主入口（方案 A 的产物）**。同时是源码与 DSH 项目级技能根（rank 200），改完即时生效、无需重启 |
| `.agents/skills/euthyna/references/verification-gates.md` | 阶段 C 全文：6 门禁 / 13 条误报清单 / 恶魔代言人 13 问 / PoC 规则 |
| `docs/fact-contract-zh.md` | **事实产出契约**：测量层 ↔ 判定层的接口。euthyna 的核心资产 |
| `docs/positioning-zh.md` | **竞品定位分析（本轮重做）**。三个赛道、八个测量工具、已确证空白八项、证伪记录 |
| `docs/dsh-stop-gate-zh.md` | **Stop 门禁事实核查**。推翻了旧结论，含可复现验证方式 |
| `docs/methodology-zh.md` | 中文审计方法论（阶段 A/B 与 9 类缺陷的正文仍在此，待拆分进技能 `references/`） |
| `reference/trail-of-bits/` | 三个上游插件的 24 个原文文件（CC-BY-SA-4.0，见 NOTICE.md） |
| `reference/competitors/` | 竞品 `dsh-skill-pack-security` 的技能原文 |
| `reference/dsh-plugin-anatomy/` | DSH 技能包型插件的最小骨架样本 |
| `tools/probe-audit-space.js` | **带命中上下文的定位探针**（做定位分析用这个，别用只打名字的 `probe-gaps.js`） |
| `tools/check-stop-gate.mjs` | **Stop 门禁契约的可复现验证**（端到端跑真实 hook 桥接） |
| `tools/probe-gaps.js` | 旧版全类目覆盖探针（只打名字，仅作粗筛） |
| `data/dsh-plugins.json` | DSH 生态 3931 个插件目录快照（`updated=2026-09-18`） |
| `data/audit-space.txt` | `probe-audit-space.js` 的完整输出（691 行，含命中上下文） |
| `.scratch/` | 拉下来的第三方原文与子代理产物（**已 gitignore，不入库**） |

> `tools/` 下所有脚本已改为读**仓库内**的 `data/dsh-plugins.json`，不再依赖 `D:\deepseek harness\`。

方法论文档的详细内容（九个元机制、三阶段流程、6 门禁、13 条误报清单、9 类缺陷专项要求）
全部在 `docs/methodology-zh.md`，本文件不重复。

---

## 许可注意（方案已拍板：引用不拷贝 + 原创重写）

`reference/trail-of-bits/` 是 **CC-BY-SA-4.0**（Trail of Bits）。

**已核实的法律事实**（CC 官方 legalcode 原文，非二手转述）：
- `Adapted Material` 的定义**明确包含 "translated"**——所以逐条对照的中文重写很可能构成改编物
- ShareAlike（§3(b)）只在**你分发（Share）**改编物时生效，且**只约束改编物本身**，不传染整个仓库

**同行判例**（`solanabr/auditor-skill` 的 `ATTRIBUTION.md`，MIT 许可，已发布）：
- 上游做成 **git submodule（gitlink 是引用不是拷贝）** ⇒ 不触发 ShareAlike
- ToB 的**方法论模式用自己的话重新实现**，逐条署名

同源判例：`dsh-skill-pack-security` 是 Apache-2.0，其 `THIRD_PARTY_NOTICES.md` 声明八个技能
与 `plugin_vet` 引擎**全部原创，未移植任何第三方代码**。

### ✅ 已定方案（2026-09-19）

**走「引用不拷贝 + 原创重写」**，目标是本仓库整体可用 MIT / Apache-2.0。

**因此还有两件未完成的清理工作**：

1. `docs/methodology-zh.md` 仍是**逐条对照改写**的产物，属改编物候选。
   要么用自己的结构与措辞重写，要么明确对它单独适用 CC-BY-SA-4.0。
   **新写的技能文件（`.agents/skills/euthyna/`）已按原创路线写**。
2. `reference/trail-of-bits/` 的 24 个原文若要随仓库分发，就带着 CC-BY-SA；
   若要整体 MIT/Apache，需改为**按需拉取**（脚本下载到 gitignored 目录），不再入库。

详见 `NOTICE.md` §1.3。**发布前必须做完这两件。**
