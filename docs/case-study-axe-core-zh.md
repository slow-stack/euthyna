# 案例研究：euthyna 在 axe-core 上的一次验证运行（2026-09-19）

[English](case-study-axe-core.md) · 中文

> **这份文档是什么**：它记录的是 euthyna 的一次**方法验证运行**——把 euthyna 的裁定门禁
> 放到一个真实的公开代码库上跑一遍，看它在有真实历史、真实测试、真实维护流程的代码上还站不站得住。
> axe-core 是这次运行的**被测对象**，不是任何人委托 euthyna 开展审计的项目。
>
> **结论先说**：本次运行**未发现任何漏洞**（真阳性 0）。粗筛出的 5 个候选全部在门禁处被推翻，
> 且各自死于不同的门禁，每一个都有可复现的证据。这份文档的价值就在这些推翻过程本身。
>
> **这不是对 axe-core 的评价**：本报告不构成对 axe-core 安全状况的背书——既不能说明它更安全，
> 也不能说明它更不安全。0 真阳性只是这**一次**运行在**限定范围**下的结果，未评估的判据见第 1 节。

**审计模式**：quick（限定 scope，用于测量**误报率**）
**目标仓库**：axe-core（上游 `dequelabs/axe-core`）
**基线提交**：`397f5fceb4ea759f26c57a852b0f3a0e8297b271`（2026-09-19T11:39:40+08:00）
**分支**：`fix/link-in-text-block-message`
**执行的阶段**：C（结论面验证，主体）+ B（变更面，限定在当前分支 diff）
**报告落盘位置**：报告写在 euthyna 仓库内，**不写进被测仓库**——写入被测仓库的工作区会让报告文件
出现在它的 `git status` 里，有被误提交的风险。这是**有意偏离**技能默认的「写到目标 cwd」。

---

## 0. 执行摘要

| 指标 | 值 |
|---|---|
| 粗筛候选数 | 5（出现在**出厂代码** `lib/` 中的高危模式） |
| 真阳性 TRUE POSITIVE | **0** |
| 假阳性 FALSE POSITIVE | **5** |
| 不可判定 INCONCLUSIVE | 0 |
| 非安全类观察 | 2 |
| **本次粗筛的误报率** | **5/5 = 100%** |

**结论**：在这一个目标上，**不带纪律的模式粗筛产出的候选 100% 是误报**。
五个候选各自死于不同的门禁，且每一个都有可复现的证据——

这正是 euthyna 要解决的问题的量化样本：**"看着危险"和"是漏洞"之间的差距是 100%。**

阶段 B（当前分支变更）**未发现安全问题**：变更纯增量，未删除任何校验，
爆炸半径可完全枚举，生成物已同步。

---

## 1. 覆盖表（先看没测什么）

按 euthyna 规则 3「缺数据 ≠ 干净」，先声明本次运行**没有**评估的判据：

| 判据 | 状态 | 原因 |
|---|---|---|
| 数据流 / 污点追踪（自动化） | ❌ 未评估 | 无 taint 工具；本次为人工追踪 |
| 调用图 / 爆炸半径（量化） | ⚠️ 部分 | 仅对变更涉及的 `isInTextBlock` 做了手工枚举；未做全仓调用图 |
| 测试覆盖映射 | ❌ 未评估 | 未运行 c8；无法断言「这些代码有没有被测试覆盖」 |
| 依赖漏洞 | ❌ 未评估 | 未运行 OSV 查询 |
| 密钥扫描 | ⚠️ 部分 | 仅做了正则粗筛（0 命中）；**0 命中不等于无密钥** |
| git 历史安全回归 | ❌ 未评估 | 该能力尚未实现（见 `docs/fact-contract-zh.md` §6.1） |
| 构建/CI 配置审计 | ❌ 未评估 | 超出 quick 档 scope |
| 未发布产物（`axe.js` bundle） | ❌ 未评估 | 只审了源码 `lib/`，未审构建产物 |

**因此本报告不能作为「axe-core 没有安全问题」的背书。** 它只说明：
**在本次运行限定的 scope 与判据下，没有发现真阳性。**

---

## 2. 粗筛方法与候选来源

模拟一个**不带纪律的扫描器**：对出厂源码 `lib/` 做经典高危模式正则匹配。

```
git grep -nE '<pattern>' -- 'lib/**'
```

| 模式 | 全仓命中 | **仅出厂代码 `lib/`** |
|---|---|---|
| `innerHTML` | 1710 处 / 226 文件 | **2** |
| `outerHTML` | 42 处 / 22 文件 | **7** |
| `insertAdjacentHTML` | 2 | 0 |
| `eval(` | 5 | 0 |
| `new Function` | 2 | **2** |
| `document.write` | 1 | 0 |
| `child_process` | 8 | 0 |
| `postMessage` | 32 处 / 10 文件 | **12** |
| 硬编码密钥（含熵检查） | 0 | 0 |

> **第一个量化发现**：`innerHTML` 全仓 226 个文件命中，其中 **227 个在 `test/`**，
> 出厂源码只有 **2 个**。一个不限范围的扫描器在这个仓库上会产出约 **99% 的纯噪音**。
> 这个「测试夹具 vs 出厂代码」的区分，本身就是误报率的最大单一来源。

---

## 3. 裁定明细

### BUG #1 FALSE POSITIVE — `lib/core/base/check.js:14` 的 `new Function`

**候选主张**：`createExecutionContext` 用 `new Function('return ' + spec + ';')()`
把字符串编译成函数，构成代码注入。

**门禁 2（可达性）FAIL：无信任边界跨越。**

数据流追踪结果：

| 环节 | 事实 |
|---|---|
| source | 参数 `spec`，来自 `Check.prototype.configure`（`check.js:203`）的 `spec[prop]` |
| 校验 1 | `check.js:8` — 若 `metadataFunctionMap[spec]` 存在，返回映射函数，**不进入 eval** |
| 校验 2 | `check.js:13` — 正则 `/^\s*function[\s\w]*\(/`，**字符串必须以 `function` 开头** |
| 校验 3 | `check.js:17` — 正则不匹配则 `throw ReferenceError` |
| 校验 4 | 包装形式 `'return ' + spec + ';'` — `return` 前缀使函数表达式之后的任何代码**不可达** |
| sink | `new Function(...)()` 返回一个**函数对象**，赋给 `this.evaluate` / `this.after` |

**唯一动态入口**：`lib/core/public/configure.js:61` → `audit.addCheck(check)` → `new Check(spec)`。
即**唯一能把字符串送进来的路径是公开 API `axe.configure`**。

威胁模型：任何能调用 `axe.configure({checks:[...]})` 的代码，**已经在页面里执行任意 JavaScript**。
该 API 没有跨越任何权限边界——攻击者不需要"注入"，他直接就有执行能力。

**门禁 3（真实影响）FAIL**：无 RCE、无提权、无信息泄露。调用方与被调用方同权限、同上下文。

裁定的辅助证据：源码自带 `/*eslint no-eval:0 */`（`check.js:6`）与
`/*eslint no-eval: 0 */`（`audit.js:239`），说明这是**作者知情的既定设计**，不是疏漏。

---

### BUG #2 FALSE POSITIVE — `lib/core/base/audit.js:254` 的 `new Function`

**候选主张**：同上，消息模板字符串被编译为函数。

**门禁 2（可达性）FAIL + 门禁 3（真实影响）FAIL**，理由同 #1。

补充事实：

| 环节 | 事实 |
|---|---|
| source | `metadata.messages[prop]`，来自 `addCheck(spec)` 的 `spec.metadata` |
| 校验 | `audit.js:253` `if (metadata.messages[prop].indexOf('function') === 0)` — 必须以 `function` **开头** |
| 包装 | `'return ' + ... + ';'` — 同 #1 的 `return` 前缀保护 |
| 入口 | 同 #1：`axe.configure` |

---

### BUG #3 FALSE POSITIVE — `lib/core/utils/pollyfill-elements-from-point.js:16` 的 `innerHTML` 赋值

**候选主张**：`style.innerHTML = ...` 构成 XSS。

**门禁 2（可达性）FAIL：sink 处不存在攻击者可控数据。**

**这是误报清单第 9 条（"不要把模式识别当成漏洞分析"）与第 5 条的教科书案例。**

实际代码：

```js
style.innerHTML = usePointer
  ? '* { pointer-events: all }'
  : '* { visibility: visible }';
```

赋给 `innerHTML` 的是**两个字面量常量之一**，由布尔 `usePointer` 三元选择。
`usePointer` 来自同文件第 6–10 行的一次能力探测（`element.style.pointerEvents === 'auto'`）。

整条链路上**没有任何外部输入**：没有参数、没有 DOM 属性、没有 location/URL、没有 postMessage。
攻击者可控数据不可能出现在 sink 处。

---

### BUG #4 FALSE POSITIVE — `lib/core/utils/valid-langs.js:10` 的 `innerHTML` 读取

**候选主张**：`document.querySelector('pre').innerHTML` 读取构成注入/XSS。

**门禁 2 FAIL：该行位于块注释内，属于被注释掉的说明文字，运行时根本不执行。**

用脚本精确判定了注释边界（不靠肉眼）：

```
块注释起始：第 1 行
块注释结束：第 50 行
第 10 行内容："const str = document.querySelector('pre').innerHTML;\r"
第 10 行在注释内？ true
```

上下文（第 1–8 行）说明这是**给维护者看的重新生成说明**：
「If we need to edit the list of langs, use the code below on the page https://www.iana.org/...」。

**这是本次运行最有说服力的误报样本**：一个纯文本模式匹配无法区分「代码」与
「注释里描述代码的文字」，而这两者在任何正则扫描器眼里一模一样。

---

### BUG #5 FALSE POSITIVE — `lib/core/utils/frame-messenger/` 的跨帧 `postMessage` 无 origin 校验

**候选主张**：12 处 `postMessage` 未做 origin 校验，构成跨域消息注入。

**门禁 2 FAIL：origin 校验存在，只是不在调用点，而在消息处理入口。**

这正是误报清单**第 1 条（追踪完整校验链）与第 1a 条（映射完整条件逻辑流）**要抓的陷阱——
**孤立分析代码**。

| 事实 | 位置 |
|---|---|
| 入站消息**有** origin 校验 | `message-handler.js:30` `if (!originIsAllowed(origin) \|\| !isNewMessage(messageId)) return;` |
| 校验实现 | `message-handler.js:8-15` `originIsAllowed()` |
| 出站目标受限 | `post-message.js:32-34` 无 `allowedOrigins` 时**直接返回 false，不发消息** |
| 附加窗口断言 | `post-message.js:19`、`message-handler.js:43/64` — `assertIsParentWindow` / `assertIsFrameWindow` |

**关于 `allowedOrigins.includes('*')` 通配**（`message-handler.js:12`）进一步追踪：

- 它不是隐式默认，而是由 `audit.js:168-181` 的 `setAllowedOrigins` 从配置解析
- 触发它的是一个**自我命名的字面量 `<unsafe_all_origins>`**
- `doc/API.md:280` 明文警告：
  > use `<unsafe_all_origins>`. **This is not recommended**.
  > Because this is the only way to test iframes on `file://`, it is recommended to use a
  > localhost server such as http-server instead.

即：**有文档、有命名警告、有替代方案建议、由集成方在每一帧显式开启的 opt-in 逃生口。**
按门禁 6 的分类，这属于「作者已知且文档化地抬高了风险」，不构成缺陷。

---

## 4. 阶段 B：当前分支变更（`fix/link-in-text-block-message`）

规模 9 文件 / +117 −17，落在 DEEP 档（< 20 文件）。实际审计了出厂代码部分（5 个文件）。

### 变更性质

| 文件 | 改动 |
|---|---|
| `lib/commons/dom/is-in-text-block.js` | 新增 `returnLengths` 选项：为 true 时返回 `{parentTextLength, widgetTextLength}` 而非布尔 |
| `lib/checks/color/link-in-text-block-evaluate.js` | 额外调用一次取长度，放进 `this.data(...)` |
| `lib/checks/color/link-in-text-block-style-evaluate.js` | 同上 |
| `lib/checks/color/*.json` | 两条 fail 文案追加说明句，插值两个长度 |
| `locales/_template.json` | 同步重新生成 |

### Phase 1 红旗检查（逐条）

| 红旗 | 结果 |
|---|---|
| 从 `fix`/`security`/`CVE` 提交中删除代码 | ❌ 无删除，纯增量 |
| 访问控制修饰符被移除 | ❌ 无 |
| 校验被删除且无替代 | ❌ 无。`noLengthCompare` 分支逻辑保留（新增 `&& !returnLengths` 条件，对既有调用方无影响） |
| 新增外部调用且无检查 | ❌ 无新增外部调用 |
| 高爆炸半径 + HIGH 风险变更 | ❌ 爆炸半径 4 个调用点，全部枚举如下 |

### Phase 3 爆炸半径（完全枚举）

| 调用方 | 传参 | 受影响？ |
|---|---|---|
| `lib/rules/link-in-text-block-matches.js:19` | `isInTextBlock(node)` | ❌ 返回布尔，路径未变 |
| `lib/rules/widget-not-inline-matches.js:18` | `{noLengthCompare:true, includeInlineBlock:true}` | ❌ 未传 `returnLengths`，走原分支 |
| `link-in-text-block-evaluate.js:94` | `{returnLengths:true}` | ✅ 本次新增 |
| `link-in-text-block-style-evaluate.js:38` | `{returnLengths:true}` | ✅ 本次新增 |

**`returnLengths` 是新选项，不存在依赖其旧行为的调用方** ⇒ 破坏性变更风险为零。

### Phase 2 测试覆盖

- `test/commons/dom/is-in-text-block.js` 新增 `returnLengths: true` 的断言（含 deepEqual 比对返回值）
- **并且覆盖了选项组合 `{noLengthCompare: true, returnLengths: true}`**（测试文件第 452 行）——
  这正是阅读实现时会被标记为「需要确认」的交互点，已被测试覆盖
- 两个 evaluate 的测试与消息文案测试同步更新

### 生成物一致性（axe-core 仓库硬性要求）

本仓库要求「改消息文案必须在同一个 commit 里重新生成 `locales/_template.json`」。
核对结果：**已同步**，diff 中 `locales/_template.json` 的三条文案与新 JSON 逐字一致。

### 阶段 B 裁定

**未发现安全问题。** 变更属于可枚举范围内的纯增量，无守卫移除，无新攻击面，生成物已同步，测试已覆盖。

---

## 5. 非安全类观察（**不是发现**）

按纪律，以下**不计入发现**，仅作记录。

### 观察 1：消息文案在「块元素」分支下会自相矛盾

`is-in-text-block.js` 的早退分支在 `returnLengths: true` 时返回 `{parentTextLength: 0, widgetTextLength: 0}`。
而新文案写的是：

> The rule applies because the link is surrounded by **${data.parentTextLength}** characters of text,
> which is more than the link's own **${data.widgetTextLength}** characters.

当两值均为 0 时，文案会输出「surrounded by 0 characters, which is more than ... 0 characters」——
**0 并不大于 0**，说明与事实不符。

- **性质**：消息准确性 / 用户体验问题
- **为什么不是安全发现**：门禁 3（真实影响）要求 RCE / 提权 / 信息泄露。文案措辞不影响任何一个。
- **触发条件未验证**：未确认新调用点是否真能到达该早退分支，**未验证**。
- **建议**：交由规则维护者判断文案是否需要加条件分支。

### 观察 2：`isInTextBlock` 在单次评估中被调用两次

两个 evaluate 函数新增的调用发生在规则 `matches` 已调用过 `isInTextBlock` 之后，
即同一次元素评估里对 DOM 文本做两遍遍历。

- **性质**：性能
- **为什么不是安全发现**：复杂度级别未改变（仍为同一量级的 DOM 遍历），不构成 DoS 复杂度缺陷。
  按技能对 DoS 类的要求——「必须证明实际最坏输入能触发，不要只声称」——**本次运行没有做这个证明**，
  因此不写成发现。

---

## 6. 过程记录：一条候选发现如何被执行推翻

记录一条候选发现被门禁推翻的完整路径，供后续校准。

**假设**：`check.js:13` 的正则 `/^\s*function[\s\w]*\(/` 中 `\s*` 允许换行，
因此可构造以换行开头的 `spec`，让 `'return ' + spec` 变成 `return\n<代码>`，
触发自动分号插入（ASI），使 `return` 提前结束，从而**执行注入的代码**。

**这个推理链条读起来完全成立**，并且给出了具体的 payload 构造方式。
按恶魔代言人第 1 问（「我是否在幻觉这个缺陷？」）的要求，这条假设**没有被直接采信**，
而是**跑了实验**：

```
  正常函数表达式     regex=true   -> 编译通过, 返回 function   __PWNED=undefined
  裸函数表达式       regex=true   -> 编译通过, 返回 function   __PWNED=undefined
  ASI 绕过尝试       regex=true   -> 编译通过, 返回 undefined  __PWNED=undefined
  同样但无换行       regex=true   -> 抛 SyntaxError
```

**假设被推翻**：payload 确实通过了正则、也确实编译成功（没有语法错误），
但 `__PWNED` 仍是 `undefined` —— **注入的代码没有执行**。

原因：`return` 之后的所有内容都不可达。函数声明会被提升（所以 `f` 存在），
但**调用语句** `f()` 位于 `return` 之后，永远不执行。
`return` 前缀本身就是一道有效的守卫，ASI 绕不过它。

**这一条的价值大于五个误报本身**：它证明**门禁不是形式主义**——
一个自洽、具体、听起来专业的漏洞主张，被一次实际执行推翻了。
少了这一步执行，它会被写进报告，成为第 6 个误报。

---

## 7. 计数汇总

```
TRUE POSITIVE   : 0
FALSE POSITIVE  : 5
  #1 check.js:14 的 new Function        — 门禁 2/3 FAIL（无信任边界）
  #2 audit.js:254 的 new Function       — 门禁 2/3 FAIL（同上）
  #3 pollyfill-elements-from-point.js:16 — 门禁 2 FAIL（sink 处无攻击者数据）
  #4 valid-langs.js:10                   — 门禁 2 FAIL（位于块注释内）
  #5 frame-messenger 的 postMessage      — 门禁 2 FAIL（校验在 handler，且通配为文档化 opt-in）
INCONCLUSIVE    : 0
非安全类观察     : 2（文案自相矛盾、重复遍历）
阶段 B 发现      : 0
```

---

## 8. 本次运行暴露的能力缺口（如实记录）

按规则 3，本次运行**因为能力缺失而没做的事**，是与结论同等重要的产出：

| 缺口 | 影响 |
|---|---|
| 无自动化数据流 / 污点追踪 | 本次 5 条数据流全部靠人工追踪。候选一旦变多就不可行——**这正是「补上确定性事实」要解决的** |
| 无 git 安全回归能力 | 无法回答「这次删除的代码是不是安全修复」。**该能力尚未实现** |
| 无覆盖率 join | 无法回答「这些代码有没有被测试碰过」。可行性已验证，见 `docs/fact-contract-zh.md` §6.2 |
| 无调用图工具 | 爆炸半径靠 `git grep` 人工枚举；在大型变更上不可扩展 |
| 只审源码、未审构建产物 | `axe.js`（1.33 MB bundle）完全未审 |

**最关键的一条**：本次 5 个候选的裁定**全部依赖人工阅读实现**。
把候选数放大 10 倍，这套流程就会退化成「来不及看，凭感觉判」——
也就是 euthyna 要解决的那个问题本身。

因此这次运行给出的判断是：在候选规模放大之前，**瓶颈在确定性测量，而不在审计范围**——
先把 `docs/fact-contract-zh.md` 里那两件测量做出来，让候选的筛除有机器证据可依。

---

## 9. 局限性声明

- **样本极小**：5 个候选，且由单一模式集生成。100% 的误报率**不能外推**为
  「所有粗筛都 100% 误报」。
- **目标特殊**：axe-core 是成熟的、有专职安全流程的库（仓库内有 `SECURITY.md`、
  Dependabot、CI）。在维护质量更低的目标上，真阳性率会更高。
- **未做真阳性能力的检验**：本次运行 0 真阳性，**不能说明本方法能识别真阳性**——
  它只说明了能筛掉假阳性。要检验召回率，需要一个**已知含真实缺陷**的目标（例如
  故意注入缺陷的靶场），本次未做。
- **未运行任何外部扫描器**：没有 semgrep / CodeQL / OSV 作为对照基线，
  因此「粗筛 5 个候选」不代表任何商业工具的输出规模。
- **未评估判据见第 1 节覆盖表**，本报告不构成安全背书。
