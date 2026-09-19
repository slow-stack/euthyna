# DSH 交付门禁事实核查（Stop hook）

> 本文核查 DSH 的 Stop hook 能否承担交付门禁，并记录一条**已被实测推翻**的结论。
> 所有结论均由 `tools/check-stop-gate.mjs` **实际运行**得出，而非阅读源码推断。
> 复现：`node tools/check-stop-gate.mjs`（只读，不启动进程，不修改任何配置）。

---

## 1. 被推翻的结论

曾被采纳的结论是：

> fp-check 的 `hooks.json` **JSON 可原样搬**；这套强制机制不需要写 JavaScript。

**这条不成立。** 实测：把 Trail of Bits `fp-check` 的 `hooks.json` 原样配进 DSH，
**一个 hook 都不会运行**。原因有两层，各自独立致命。

---

## 2. 第一层：`prompt` 类型的 hook 被直接跳过

`fp-check/hooks/hooks.json` 里的两个 hook **都是 `"type": "prompt"`**：
Stop 一个（"检查 6 门禁有没有走完"），SubagentStop 一个（"检查子代理输出完整性"）。

DSH 的桥接只执行 **shell command** 形态的 handler。实测输出：

```
hooks-claude-code: skipping unsupported "prompt" hook on Stop (only command hooks run)
```

源码位置：`dsh-hooks-claude-code/lib/index.js:73`（`if (type !== "command") { … skipped … }`）、
`:147`（打上面这条警告）。`dsh-hook-protocol` README 也明载：「只有 command 钩子会运行；
`http`、`mcp_tool`、`prompt` 与 `agent` handler 会被跳过并给出警告。」

**后果**：要搬这套门禁，必须把 prompt 里那段自然语言判断**改写成一段可执行脚本**。
方案 B 不是「0 行 JS」，而是「一个 gate 脚本 + 一个 configPath」。

---

## 3. 第二层（更致命）：Stop hook 看不到对话

即便写成了 command hook，它的 stdin 也只有这些字段。实测抓到的完整 payload：

```json
{"session_id":"sess-1","transcript_path":"","cwd":"<工作区绝对路径>",
 "hook_event_name":"Stop","stop_hook_active":false}
```

对 fp-check 的用法来说，每一项都是坏消息：

| 字段 | 实测值 | 为什么致命 |
|---|---|---|
| `transcript_path` | **恒为空字符串** | 桥接文档明说「持久化 seam 不暴露产物路径，且默认 zstd 压缩的会话日志无法被 hook 脚本读取」 |
| `last_assistant_message` | **不存在** | 看不到 agent 最后说了什么 |
| `stop_hook_active` | **恒为 `false`** | 没有「上次已经拦过」的标记 |
| 对话内容 | **完全没有** | payload 里没有任何消息数组 |

**结论**：fp-check 门禁的核心动作是「扫描对话，检查每个 bug 的 5 个阶段与 6 个门禁是否都走过」。
这个动作在 DSH 的 command hook 上**在物理上无法实现**——它拿不到对话。

能拿到的只有 `cwd`（工作区路径）和一个会话 id。因此 DSH 上的门禁必须是
**产物式（artifact-based）**，而不是**对话式（conversation-based）**：

```
可行：检查 .euthyna/evidence.jsonl 是否存在、是否覆盖了全部阶段、
      报告文件是否落盘、某个测试命令有没有真的跑过（靠 PreToolUse 记账）
不可行：检查 agent 有没有"在对话里"完成恶魔代言人 13 问
```

`PreToolUse` / `PostToolUse` 钩子**能**拿到 `tool_name` / `tool_input` / `tool_response`，
所以正确姿势是：**用 Pre/PostToolUse 逐次记账，用 Stop 读账本结账。**

---

## 4. 仍然成立的部分：拦截确实有效

门禁机制本身没被推翻，只是实现方式变了。实测三条通路：

| 写法 | 结果 |
|---|---|
| 脚本 **退出码 2**，把理由写到 **stderr** | ✅ 拦截，理由逐字传给 agent |
| stdout 输出 `{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny","permissionDecisionReason":"…"}}` | ✅ 拦截 |
| stdout 输出 fp-check 的 `{"ok":false,"reason":"…"}`（且退出码 0） | ❌ **不拦截**，被当成普通 stdout |

拦截后的模型可见文案是 `continue: blocked by Stop hook`（未提供理由时的默认值），
有理由时逐字传递。折叠规则：`deny > ask > allow`，退出码 2 解码为 `block`，与 `deny` 同级（rank 3）。

---

## 5. 三个必须自己处理的坑

### 5.1 门禁必须自带限流，否则死循环

DSH 没有轮次预算。`agent/turn-stopping` 只在「轮次即将结束且待处理队列为空」时触发，
而拦截是通过 `agent.steer()` 往队列塞一条消息让循环继续。
宿主 README 原话：

> **没有内置轮次预算**：工具调用或 steering 会让当前轮次继续；
> 限制失控轮次的策略必须从既有生命周期扩展点（如 `agent/turn-stopping`）执行取消。

且 `stop_hook_active` 恒为 `false`，桥接文档也警告：「无条件阻塞 hook 会在每个步骤中强制
continuation，除非它自我限制。」

**要求**：gate 脚本必须自己写状态（例如「本会话已拦 3 次」）并在超限后放行。

### 5.2 hook 配置是进程级、只在启动时读一次

桥接文档：「一份配置应用于整个进程：启动时只读取一次」。
改 `hooks.json` 需要重启 `dsh web`——**这与技能 Markdown 的热重载不同**。
迭代门禁逻辑时这是个真实的摩擦点。

### 5.3 子代理拿不到门禁

`SubagentStop` **只观测，不能阻塞**（桥接源码里 SubagentStop 分支不做决策折叠）。
且 `SubagentStop` 恒报 `agent_type: "general-purpose"`，
fp-check 那种「按代理类型分别检查输出完整性」的写法在这里失效。

---

## 6. 对落地形态的影响

| 方案 | 此前判断 | 实测后 |
|---|---|---|
| A. 纯 Markdown 技能 | 0 行 JS | ✅ 不变。仍然应该是**起点**——门禁的前提是方法论本身有效 |
| B. hook 门禁 | 「0 行 JS，一个 `configPath`」 | ❌ 实为：**一个 gate 脚本（约 100–200 行）+ configPath**，且只能做产物式门禁 |
| C. 原生插件 | 「约 20–130 行 TS」 | ✅ 但价值上升：原生插件在 `agent/turn-stopping` 上拿得到 `agent` 对象与会话，**能做对话式门禁**，且不需要重启、不需要外部脚本 |

**推论**：如果 euthyna 的门禁想检查「6 门禁有没有真走完」这类**对话内事实**，
那 command hook 这条路走不通，必须走 C（原生插件）。B 只适合
「报告文件有没有落盘」「测试命令有没有真跑过」这类**产物式事实**。

---

## 7. 复现方式

```powershell
node tools/check-stop-gate.mjs
```

脚本做的事：伪造一个最小 `ctx`，用**真实的** `dsh-hooks-claude-code` 插件
`apply()` 一个临时 `hooks.json`（同时含 prompt hook 与 command hook），
捕获它注册的监听器与警告日志，再以桩执行器返回 `exitCode: 2`，
断言 `agent.steer()` 收到的文本等于 hook 的 stderr。

输出 `ALL CHECKS PASSED` 即本文全部结论成立。脚本不联网、不 spawn 进程、不写配置。
