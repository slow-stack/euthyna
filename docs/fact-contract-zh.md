# 事实产出契约（Fact Contract）v0.1

> 这是 euthyna 的**核心资产**：定义「测量层」交给「判定层」的到底是什么。
> 定位分析的结论是 euthyna 不重造测量，那它就必须定义**接口**——这份文档就是那个接口。
>
> 状态：**设计稿，未经实跑验证**。字段会在第一次 quick 档实跑后修订。

---

## 0. 为什么需要这份契约

### 0.1 问题

定位分析（`docs/positioning-zh.md`）查出八个测量工具各测一段，
**八种互不兼容的输出形状**，而且**没有一个有进程退出码契约**。这意味着：

- 判定层（fp-check 那套 6 门禁 / 13 条误报清单）**无从消费**它们的输出
- 同一件事（比如「这个符号有多少调用方」）在不同工具里字段名不同、语义不同
- 最危险的是：**「没测到」和「测了是干净的」长得一样**

### 0.2 三条设计原则

| 原则 | 含义 | 反面教材 |
|---|---|---|
| **P1 事实与判断分离** | 契约里只跑事实。`「第 98 行有校验」` 是事实；`「所以下溢不可能」` 是判断，不进契约 | 让工具直接吐 `risk: high` |
| **P2 三态强制** | 每条事实必须能说「不知道」。**缺数据永远不等于干净** | 扫描没命中就报 `PASS` |
| **P3 可复算** | 每条事实必须带**复现它的命令**或**产出它的工具+版本**。第三方拿到记录就能自己重算结论 | 只给一句「已检查」 |

### 0.3 两条抄来的经验

- **来自 `dsh-trust-check`**：它把门禁面收窄到 **5 个字段**，并**明写「不要拿 `score` 或 `band` 做门禁」**；
  `errors` 非空一律当作**扫描失败**而不是 `clear`。
  ⇒ **我们也不放分数，门禁只吃可验证字段。**
- **来自 `formalswarm`**：它的判决能从 `outcome.json` 被读者**独立重算**，不需要相信任何散文。
  ⇒ **契约必须自足：只看记录就能复现判决。**

---

## 1. 契约的四个部分

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  Subject    │ →  │    Facts     │ →  │   Coverage   │ →  │  Verdict   │
│ 被审对象    │    │  确定性事实   │    │  测了什么/   │    │  判定结果   │
│ + 断言      │    │              │    │  没测什么     │    │            │
└─────────────┘    └──────────────┘    └──────────────┘    └────────────┘
```

**数据流是单向的**：测量层只写 `Subject` / `Facts` / `Coverage`；
判定层只写 `Verdict`。判定层**不许回填事实**（防止「先有结论再凑证据」）。

---

## 2. Subject —— 被审对象与断言

```jsonc
{
  "schemaVersion": "0.1",
  "subject": {
    "id": "F-001",
    "claim": "packet_handler 的整数下溢可被远程未认证用户触发",
    "location": {
      "file": "src/net/packet_handler.c",
      "line": 142,
      "symbol": "handle_packet",
      "commit": "a1b2c3d"        // 可选：被审版本
    },
    "bugClass": "integer",        // 9 类之一，见 methodology §3
    "scope": {
      "repo": "D:/repo/example",
      "baselineCommit": "f703c92" // 变更面审计的基线
    }
  }
}
```

**`claim` 必须是一句可判真假的断言。** 这是 Step 0「重述断言」的机器可读形式——
方法论文档说「一半的误报在这一步就崩塌」，那么这一步的产物就必须落进契约。

**`bugClass` 决定默认假设的方向**（methodology M7）：
内存破坏类默认「几乎总是误报」，逻辑缺陷类默认「不能让干净的静态分析说服你是误报」。

---

## 3. Facts —— 确定性事实

### 3.1 单条事实的形状

```jsonc
{
  "id": "fact-007",
  "kind": "guard",                    // 见 3.2 枚举
  "statement": "第 98 行校验 packet_size >= 16",   // 人可读，一句话
  "status": "established",            // established | refuted | unknown
  "evidence": {
    "file": "src/net/packet_handler.c",
    "line": 98,
    "snippet": "if (packet_size < MIN_PACKET_SIZE) return -1;"
  },
  "method": "static",                 // static | command | tool
  "command": "git grep -n 'MIN_PACKET_SIZE' a1b2c3d -- src/net/",  // method=command 时必填
  "producer": { "name": "euthyna-history", "version": "0.1.0" },   // method=tool 时必填
  "confidence": "exact"               // exact | approximate —— approximate 不得用于门禁
}
```

**三个字段是硬要求，缺一不可**：

- `status` —— 三态。`unknown` 是合法且**必须被尊重**的值
- `evidence.file` + `evidence.line` —— 证据强制到 `file:line`（methodology M5）
- `method` + (`command` 或 `producer`) —— 可复算（P3）

**`confidence: approximate` 的事实不得参与门禁判定。**
这条直接抄自 `dsh-blast-radius`：它的 `approximate` 标记（无 tsconfig 时的合成作用域）
**在 `enforce: true` 时也不参与阻断**。

### 3.2 事实类别（kind）枚举

按「判定层的哪一步消费它」组织：

| kind | 事实内容 | 谁产出 | 判定层用它做什么 |
|---|---|---|---|
| `location` | 被审代码的位置与符号归属 | 引擎 | 定位 |
| `flow` | `source → sink` 链，逐跳位置 | 引擎 / 数据流工具 | 门禁 2（可达性）、清单 1/3 |
| `guard` | 链路上的校验/净化，及其**性质** | 引擎 | 门禁 5（数学边界）、清单 1/2/5 |
| `reachability` | 从入口点到该处是否存在路径 | 调用图工具 | 门禁 2 |
| `trust_boundary` | 该处跨越的信任边界（内部可信 / 外部不可信） | 引擎 | 清单 4/8 |
| `attacker_control` | 该数据是否攻击者可控 | 判断层回填**禁止**；引擎给原始来源 | 门禁 2、清单 3 |
| `callers` | 调用点列表（生产 / 测试分开） | `dsh-blast-radius` / `dsh-tool-lens` | 影响面 |
| `test_coverage` | **被改符号的调用方是否有测试真的执行过** | **euthyna 自研**（见 §6） | 门禁 1、风险升级 |
| `history` | 被删代码的来源提交 + 其性质 | **euthyna 自研**（见 §6） | 门禁 1、红旗 |
| `reintroduction` | 该模式是否曾被移除又加回 | **euthyna 自研** | 红旗 REGRESSION |
| `dependency` | 依赖漏洞（含确认口径） | `dsh-dep-vuln-scan` 类 | 独立发现源 |
| `secret` | 密钥/凭据暴露 | `dsh-code-security` 类 | 独立发现源 |
| `artifact` | 报告/PoC 产物：路径、退出码、用例数 | 门禁脚本 | 门禁 1/4 |
| `environment` | 环境防护，且**区分「彻底阻止」与「仅抬高门槛」** | 引擎 | 门禁 6 |

> ⚠️ `guard` 与 `environment` 都要求一个**二分字段**：
> `{"effect": "prevents_entirely" | "raises_bar"}`。
> 这是 methodology M6 的核心，也是最容易被 LLM 混为一谈的地方——
> 契约必须在数据结构上强制区分，而不是靠提示词提醒。
> 已有工具没人产出这个字段（八个测量工具全部只看「有没有」，不看「防到什么程度」）。

### 3.3 ⛔ 契约里**不许出现**的东西

| 不许出现 | 为什么 |
|---|---|
| 任何分数（`score` / `risk: high` / 0–100） | 分数不可复算，会变成「拿分数当门禁」；`dsh-trust-check` 明确警告过 |
| 严重性等级 | 严重性是**判断**，不是事实。放进 Facts 等于让测量层替判定层下结论 |
| 修复建议 | 同上 |
| 「建议」「可能」「大概率」 | 契约是事实层，模糊词只会掩盖缺失（methodology M5 明令禁用 `probably` / `likely`） |

---

## 4. Coverage —— 诚实标注覆盖边界

这是 P2 的落地，也是**防假阴性**的关键。

```jsonc
{
  "coverage": {
    "evaluated": [
      { "kind": "guard", "producer": "euthyna-static", "count": 3 },
      { "kind": "callers", "producer": "dsh-blast-radius", "count": 12 }
    ],
    "notEvaluated": [
      { "kind": "test_coverage",
        "reason": "c8 未运行：项目无测试命令，profile 探测失败" },
      { "kind": "reachability",
        "reason": "动态调用无法解析：目标语言使用反射" }
    ]
  }
}
```

**硬规则**：

1. **`notEvaluated` 非空时，任何门禁的结论不得为 `pass`**——只能 `not_evaluated` 或 `fail`。
   这是 `formalswarm` 的 fail-closed 与 `dsh-trust-check` 的 `errors` 语义的直接移植。
2. **`notEvaluated` 必须带 `reason`**，且 `reason` 要具体到**为什么**（不是「工具不可用」，
   而是「哪个工具、因为什么不可用」）。
3. **空结果要显式区分**：「跑了但没发现」记 `evaluated` + `count: 0`；
   「根本没跑」记 `notEvaluated`。这两者在任何报告里都不许长得一样。

---

## 5. Verdict —— 判定结果

```jsonc
{
  "verdict": {
    "gates": [
      { "gate": "process",       "outcome": "pass",          "reason": "5 阶段均有证据", "evidenceRefs": ["fact-001","fact-004"] },
      { "gate": "reachability",  "outcome": "pass",          "reason": "入口点可达",     "evidenceRefs": ["fact-009"] },
      { "gate": "real_impact",   "outcome": "not_evaluated", "reason": "影响分类未完成" },
      { "gate": "poc",           "outcome": "fail",          "reason": "PoC 使用了 mock，判定无效", "evidenceRefs": ["fact-021"] },
      { "gate": "math_bounds",   "outcome": "pass",          "reason": "见代数证明",     "evidenceRefs": ["fact-007","fact-008"] },
      { "gate": "environment",   "outcome": "pass",          "reason": "无彻底阻止的防护", "evidenceRefs": ["fact-030"] }
    ],
    "disposition": "inconclusive",   // true_positive | false_positive | inconclusive
    "reason": "门禁 3 未评估、门禁 4 失败"
  }
}
```

**判定规则**（写死，不留解释空间）：

| 条件 | disposition |
|---|---|
| 6 门禁**全部** `pass` | `true_positive` |
| 任一门禁 `fail` | `false_positive` |
| 无 `fail`，但存在 `not_evaluated` | **`inconclusive`** ← 不许降级成 `false_positive` |

最后一行是最重要的一条。方法论文档里 fp-check 的原文说「只有全部阶段完成后才下 FALSE POSITIVE 裁定」——
**`inconclusive` 是比 `false_positive` 更诚实的出口**，而 DSH 生态里已经有 `formalswarm` 证明了
这个三态出口是可行的（`CONFIRM` / `REVISE` / `INCONCLUSIVE`）。

> ⚠️ 与 fp-check 原文的差异：原文只有两态（TRUE/FALSE POSITIVE），
> 因为它的 hook 可以无限强制继续直到补完。DSH 上**做不到**（Stop hook 必须自带限流，见
> `docs/dsh-stop-gate-zh.md`），所以必须有 `inconclusive` 这个诚实出口。

---

## 6. euthyna 自己要产出的两类事实

按已拍板的引擎边界，只做这两件（其余全部消费现成工具）：

### 6.1 `history` —— git 安全回归的**机械**判定

**要回答的**：这次变更删掉的代码，是不是一个安全修复？

```
输入：baselineCommit..headCommit 的 diff
产出：
  - 被删除的行 → git blame → 该行来自哪个提交
  - 该提交的 message 是否命中 fix|security|CVE|vuln（正则，可配置，命中即标注）
  - 该提交是否触碰过安全敏感路径（可配置）
输出 fact：
  { kind: "history", status: "established",
    statement: "第 142 行删除的校验由提交 abc123 引入，其 message 含 'CVE-2024-xxxx'",
    evidence: {file, line, commit: "abc123"},
    command: "git blame -L 142,142 f703c92 -- src/...",
    effect: "security_fix_removed" }     // ← 判定层据此直接触发 CRITICAL 红旗
```

**与已有占位的差别**：`auditor-skill` 是让 LLM 自己跑 `git blame` 再自己读 commit message 下判断；
这里是**机械判定并产出结构化事实**，同一个 diff 跑两次结果必须一致。

### 6.2 `test_coverage` —— 符号 × 真实执行的 join

**要回答的**：我改的这个符号，它的调用方里哪些**没有测试真的执行过**？

这是定位分析里最无可争议的空白（`dsh-blast-radius` 拿「测试引用」那一半，
`dsh-code-coverage` 拿「执行覆盖」那一半，谁也拼不起来）。

> ⚠️ **可行性正在独立验证中**（子代理在跑）。三个已知的语义陷阱必须先解决：
> 1. 「测试文件引用了这个符号」≠「测试执行了这个调用点」
> 2. 「调用方那一行被覆盖」≠「对**该被调符号**的那次调用被执行」
> 3. 转译 / source map / monorepo 会让行号对不齐
>
> 在验证结论回来之前，这个 kind **只能标 `approximate`**，因而**不得参与门禁**。

---

## 7. 待定问题（下一轮必须回答）

1. **契机的落地形态**：JSON 文件？会话事件？工具返回值？——三个都在 DSH 上有先例。
2. **谁写 `Verdict`**：判定层是 SKILL.md（模型写）还是插件（代码写）？
   写模型 → 灵活但不可复算；写代码 → 可复算但表达力有限。
   *倾向*：Facts 由引擎写，`Verdict` 由判定层写但**格式受 schema 约束**，两者都可复算。
3. **`attacker_control` 归谁**：它是判定（「攻击者能不能控制」），但门禁 2 需要它。
   当前设计是引擎给**原始来源事实**（`source` 是什么、经过哪些边界），判定层下结论。
4. **9 类缺陷的默认假设怎么进契约**：是 `bugClass` 字段 + 判定层的查表，还是别的方式？
5. **事实的粒度**：一条 fact 一句话，还是一条 fact 可带子事实？当前按「一句话」设计，
   实跑后可能发现太碎。

---

## 8. 这份契约与既有生态的关系

| 生态里的东西 | 关系 |
|---|---|
| `dsh-trust-check` 的 `audit-schema.md` | **同类物**，但它的对象是「DSH 插件的能力」，我们的对象是「代码安全结论」。它的两条经验已抄（收窄门禁面、不许拿分数做门禁） |
| `dsh-omv` 的 `contracts/*.json` | 它的契约描述 **HTTP API 的请求/响应**（`action` / `finding.*` / `campaign.*`），不是事实本身。**没有交集，但可并存**：`dsh-omv` 可以成为 Facts 的消费方 |
| SARIF | SARIF 描述**发现**（finding），不描述**事实**（fact）。可以把 Facts 渲染成 SARIF 输出，但契约本身比 SARIF 更底层 |
| `dsh-blast-radius` 的 `BlastRadius` | 它可以直接充当 `callers` 的生产者，需要一个适配层映射到本契约 |
| `dsh-dep-vuln-scan` 的输出 | 同上，映射到 `dependency` |

**结论**：本契约是**适配层**而非替代品。它不要求任何现有工具改造自己——
euthyna 负责把它们的输出翻译成统一事实。这也正是定位分析里说的「空白 #4（无共享 schema）」的填法。
