# 案例研究：euthyna 在 crewAI 上的一次验证运行（2026-09-20）

[English](case-study-crewai.md) · 中文

> **本文档是什么**：它记录 euthyna 的一次**方法验证运行**——把 euthyna 的两个确定性测量
> （`history`、`coverage`）和六门禁判定纪律，跑在一个真实的 **Python** 代码库上。
> 上一个案例研究跑在 JavaScript 代码库（axe-core）上；本次是 Python 侧的对位验证：
> 这套方法在大型 Python 项目（有真实历史、真实测试、真实维护流程）上是否仍然成立？
>
> **结论先行**：方法成立。`history` 在 Python 仓库上无需改动即工作（git blame 与语言无关）；
> **coverage 事实生产者本次扩展为可读 coverage.py JSON（format 3）**——此前它只读 c8/V8
> 输出，所以 Python 是明确的未验证缺口。两个状态（从未调用 / 被调用过）都在 crewAI 自身
> 测试运行产生的真实 coverage.py 数据上验证通过。
>
> **这不是对 crewAI 的评价**：本报告不构成对 crewAI 安全状况的背书。0 个真阳性只是本次
> 限定范围下的一次运行结果；未评估的判据列在第 1 节。

**审计模式**：快速（限定范围，测误报率 + 验证 Python 兼容性）
**目标仓库**：crewAI（上游 `crewAIInc/crewAI`），主包 `lib/crewai/src/crewai`（105,778 行源码）
**基线 commit**：`0374c6312`（2026-09-20，本地已同步至官方最新）
**执行的阶段**：阶段 C（结论面验证）+ 阶段 B（变更面，一个 commit）+ 两个确定性测量
**报告存放位置**：报告存放在 euthyna 仓库内，**未写入被测仓库**。

---

## 0. 执行摘要

| 指标 | 值 |
|---|---|
| 粗筛候选 | 3（2 处 subprocess 视为同源一组 + 1 处 pickle） |
| TRUE POSITIVE | **0** |
| FALSE POSITIVE | 2（subprocess 机器指纹；锁移动变更面） |
| INCONCLUSIVE | 1（pickle 反序列化） |
| 非安全观察 | 2 |
| **本次粗筛的误报率** | **2/3 = 67%** |

**方法验证结果**：

| 验证点 | 结果 |
|---|---|
| `history` 在 Python 仓库上工作 | ✅ 真实运行：commit `32f5e7444` 删除了 12 行来自 `c5a8fef118` 的代码，归属与分类正确 |
| `coverage` 读取 coverage.py JSON（format 3） | ✅ 真实运行：`PickleHandler.load` 被测试调用（UNKNOWN）、`FileHandler.log` 未被调用（ESTABLISHED），两态均正确 |
| 六门禁判定纪律在 Python 代码上成立 | ✅ 三个候选分别死于不同门禁或缺乏代码内证据，均有具体证据 |

**结论**：在这个目标上，**67% 的模式粗筛候选是误报**，剩下的一个是真实风险类，但其完整
攻击链依赖仓库之外的供应链假设。这是「看起来危险」与「真的是漏洞」之间差距的又一次量化
样本——正是 euthyna 存在的原因。

---

## 1. 覆盖表（先列未评估项）

| 判据 | 状态 | 原因 |
|---|---|---|
| 全仓漏洞扫描 | ❌ 未评估 | 快速模式只粗筛高危模式，非全量审计 |
| 依赖漏洞（OSV 等） | ❌ 未评估 | 未运行依赖漏洞查询 |
| 密钥扫描（全量） | ⚠️ 部分 | 粗筛 0 命中；0 命中 ≠ 无密钥 |
| SQL 注入 | ❌ 未评估 | 字符串插值模式 0 命中；ORM 层未审计 |
| 并发 / TOCTOU（全仓） | ⚠️ 部分 | 只检查了锁移动变更面 |
| 构建 / CI 配置 | ❌ 未评估 | 超出快速模式范围 |

**因此本报告不能作为「crewAI 没有安全问题」的背书。** 它只说明：在本次限定的粗筛范围与
判定纪律下，没有产生真阳性，且方法本身在 Python 代码库上可复现地工作。

---

## 2. 粗筛方法与候选来源

模拟无纪律扫描器：对 `lib/crewai/src/crewai`（排除 `tests/` 和 `__pycache__`）做经典高危
模式正则粗筛。

| 模式组 | 命中数 | 说明 |
|---|---|---|
| `shell=True` / `os.system` / `subprocess` | 2 | 均在 `events/listeners/tracing/utils.py` |
| `eval` / `exec` / `pickle` / `yaml.load` | 6 | 6 处集中在 `utilities/file_handler.py`（import + save/load） |
| 硬编码密钥字面量 | 0 | — |
| `requests` 无 `verify=False` | 0 | — |
| 路径穿越（`../`） | 10 | 多为 console_formatter 里的模板字符串，非文件操作 |
| SQL 字符串插值 | 0 | — |
| `os.environ` 密钥读取 | 0 | — |

粗筛收敛为 **3 个候选**（2 处 subprocess 同源归为一组）：

1. `events/listeners/tracing/utils.py:215` — `subprocess.run(["system_profiler", ...])`
2. `events/listeners/tracing/utils.py:234` — `subprocess.run(["wmic.exe", ...])`
3. `utilities/file_handler.py:166` — `pickle.load(file)`（`# noqa: S301`）

外加阶段 B 变更面候选：

4. commit `32f5e7444` —「Skip lock acquisition in CrewTrainingHandler.load when file is missing」

---

## 3. 裁定详情

### BUG #1 FALSE POSITIVE — `events/listeners/tracing/utils.py:215` 的 subprocess 调用

**门禁 2（可达性）FAIL**：命令与参数全部硬编码（`/usr/sbin/system_profiler SPHardwareDataType`、
`C:\Windows\System32\wbem\wmic.exe csproduct get UUID`），无 `shell=True`，无任何用户输入
进入命令或参数，`capture_output=True` 仅读取输出用于机器指纹。攻击者无法控制该命令。
这是读取本机硬件 UUID 的正常遥测标识，不是命令注入。

- 证据：`lib/crewai/src/crewai/events/listeners/tracing/utils.py:215-249`
- 复现：`git blame -L 215,249 -- lib/crewai/src/crewai/events/listeners/tracing/utils.py`
- 误报清单对照：条目 9（模式识别≠漏洞分析）、条目 4（数据源上下文——常量非网络数据）

### BUG #2 FALSE POSITIVE — commit `32f5e7444` 的「删除锁逻辑」变更面

**门禁 3（真实影响）FAIL**：粗看是一个安全修复提交删除了 12 行来自锁提交 `c5a8fef118`
的代码。实读 diff 后**锁逻辑实质保留**：`store_lock` 只是从「无条件获取」移到「文件存在时
获取」，真正的 `open` + `pickle.load` 仍在锁内。提交信息明确动机（性能：每次 kickoff 都
调 `_use_trained_data` → `load()`，不训练时不应抢跨进程 Redis 锁）。

两个行为差异均非安全回归：

1. `os.path.getsize() == 0` 空文件短路被移除——但空文件 `pickle.load` 抛 `EOFError`，
   新代码 `except (FileNotFoundError, EOFError): return {}` 兜底，行为等价。
2. `os.path.exists` 检查移到锁外——没有删除文件的路径（`clear()` 是 `save({})` 不删文件），
   检查与加锁读取之间不存在 TOCTOU 利用面。

- 证据：`git show 32f5e7444 -- lib/crewai/src/crewai/utilities/file_handler.py`
- `history` 产出：12 行来自 `c5a8fef118`，分类 `fix`，复现命令已附
- 误报清单对照：条目 1（追踪完整校验链）、条目 6（核验 TOCTOU 主张）

### BUG #3 INCONCLUSIVE — `utilities/file_handler.py:166` 的 pickle 反序列化

**重述断言**：`CrewTrainingHandler.load()` → `pickle.load(file)` 无条件反序列化，
攻击者控制该文件内容时可执行任意代码（CWE-502）。

**门禁**：

| 门禁 | 结果 | 证据 |
|---|---|---|
| 1 流程 | ✅ | 数据流、PoC、历史全部完成 |
| 2 可达性 | ⚠️ 未证明 | 攻击者**不能**远程直接写入 `.pkl`；写入侧是本地 `train()` 流程（`crew.py:972`，数据来自 LLM 评估结果）；读取侧是用户配置路径（`crew.trained_agents_file` 字段 / `CREWAI_TRAINED_AGENTS_FILE_ENV`）。利用前提是「用户主动加载攻击者提供的文件」（供应链/配置投毒）——此路径**无法在本仓库代码内证明** |
| 3 真实影响 | ✅ | pickle RCE = 任意代码执行，严重 |
| 4 PoC 验证 | ✅ | 可执行 PoC：恶意 `__reduce__` 载荷经 `PickleHandler.load()` 执行了 `os.getenv("USERNAME")`（真实非空输出） |
| 5 数学边界 | ✅ | `pickle.load` 无任何净化/白名单，条件必然成立 |
| 6 环境 | ✅ | 无沙箱/防护阻断 |

**裁定：INCONCLUSIVE** —— 无门禁 FAIL，但门禁 2 的「攻击者控制」依赖仓库之外的供应链假设
（用户加载不可信文件），完整攻击链无法在代码内确立。按 euthyna 规则，不能报 TRUE POSITIVE；
按恶魔代言人第 12 问，也不能因「利用方式不太可能」就报 FALSE POSITIVE。

**给项目方的建议（作为观察，非裁定）**：这是全仓唯一的 `pickle.load`（作者以
`# noqa: S301` 明确知悉）。`trained_agents_file` 是公开配置字段，若用户从不可信来源获取
crew 配置或训练产物，则构成真实的供应链 RCE 面。建议：改用受限反序列化
（`pickletools` 白名单或 JSON），或在文档中明确「不要加载不可信训练文件」。

- 证据：`lib/crewai/src/crewai/utilities/file_handler.py:154-166`（`load` 方法）
- 数据流：`crew.py:336 (trained_agents_file 字段)` → `agent/core.py:1442 (_use_trained_data)` → `agent/core.py:724 (apply_training_data)` → `file_handler.py:166 (pickle.load)`
- 写入侧：`crew.py:972 (train() 流程)` → `training_handler.py:8 (save_trained_data)` → `file_handler.py:152 (pickle.dump)`
- 历史：`pickle.load` 由 `d1343b96e`（2025-10-20, v1.0.0）引入；`c5a8fef118`（2026-03-13）加锁
- PoC：载荷仅执行 `os.getenv`，无破坏效果

---

## 4. 方法验证详情

### 4.1 `history` 在 Python 仓库上工作（验证点）

```powershell
node <euthyna 仓库>/bin/euthyna.js history --base 32f5e7444^ --head 32f5e7444 --repo D:\crewAI
```

真实输出（摘录）：

```
已确证 (1)
  • 本次变更删除了 12 行来自提交 c5a8fef118 的代码（文件：…/file_handler.py）。
    提交信息："fix: add cross-process and thread-safe locking to unprotected I/O (#4827)"，分类：fix
```

`git blame` 与语言无关，所以 `history` 在 Python 仓库上无需改动即工作。退出码 0。

### 4.2 `coverage` 读取 coverage.py JSON——本次运行新增的能力

测试运行（限定模块；禁用 xdist 使 trace 保持在进程内）：

```powershell
uv run --with coverage python -m coverage run \
  --include="*/src/crewai/utilities/file_handler.py" \
  -m pytest lib/crewai/tests/utilities/test_file_handler.py -o addopts="" -p no:randomly
uv run --with coverage python -m coverage json -o <路径>/crewai-filehandler.json
```

euthyna 对真实数据的查询：

| 符号 | 结果 | 证据 |
|---|---|---|
| `load`（`PickleHandler.load`，测试调用过） | UNKNOWN「至少被调用过一次」 | `file_handler.py:154` |
| `log`（`FileHandler.log`，测试未调用） | ESTABLISHED「一次都没有被调用」 | `file_handler.py:65` |

两态均正确，与 c8 路径语义一致。**本次新增的 coverage.py 格式支持（commit `231e369`）
在真实 Python 项目上验证通过。**

**coverage.py 格式要点（与 c8 的差异，供后续审计参考）**：

- 顶层是 `{"meta": {...}, "files": {...}}`，文件条目在 `files` 下
- `functions` 映射「函数名 → `{executed_lines, missing_lines, start_line}`」，**无调用计数**
- 从未调用的函数仍在 `functions` 中且 `executed_lines` 为空 → 两态映射：空 = ESTABLISHED（从未调用），非空 = UNKNOWN（被调用过）
- 类方法名为 `Class.method`；euthyna 支持裸方法名后缀匹配

---

## 5. 非安全观察（**不是发现**）

### 观察 1：`os.path.getsize() == 0` 空文件短路被移除

锁移动提交（`32f5e7444`）移除了 `load()` 里的空文件快路径。行为等价（EOFError 被捕获），
但零字节文件现在会走锁和 open 尝试。仅性能层面，记录备查。

### 观察 2：`trained_agents_file` 在每次构建任务 prompt 时都会被加载

`apply_training_data`（`agent/core.py:724`）在每次构建 prompt 时运行并打开 pickle 文件。
从不训练的生产部署每次 kickoff 都会读一次文件（除非文件不存在）——这正是锁移动提交声明的
动机。记录为 INCONCLUSIVE 发现的背景。

---

## 6. 过程记录：一个候选如何被执行推翻

锁移动变更面（BUG #2）是 axe-core 运行中过程记录的对位版本。那里，一个貌似成立的逃逸被
执行推翻；这里，一个貌似成立的安全**回归**被「实读 diff 而非轻信提交摘要」推翻：

- 第 1 步：`history` 报告「12 行来自锁提交 `c5a8fef118`」——按手册这是红旗：一个 fix 提交
  删除了另一个 fix 提交的代码。
- 第 2 步：`git show 32f5e7444` 揭示被删的是**无条件获取锁**，不是锁本身；读取仍在
  `store_lock` 内。
- 第 3 步：两个行为差异（空文件短路移除；`exists` 移到锁外）逐一对照「删文件/TOCTOU」
  可能性——都不存在。
- 第 4 步：裁定 FALSE POSITIVE，附变更面证据。

**记录的经验**：「来自 fix 提交的删除行」是**触发检查的信号，永远不是结论**。本案方向
（貌似真实的回归其实不是）是 axe-core 案例（貌似成立的逃逸其实不成立）的镜像。

---

## 7. 计数汇总

- TRUE POSITIVE：0
- FALSE POSITIVE：2
- INCONCLUSIVE：1
- 非安全观察：2

---

## 8. 本次运行暴露的能力缺口（如实记录）

1. **coverage.py JSON 在本次之前不可读**——原生产者只接受 c8/V8 输出。现已支持
   （format 3），带回归测试；coverage.py 的 `--source`/`--include` 语义仍需在技能的
   产出器手册中补文档。
2. **Python 方法命名**：coverage.py 产出 `Class.method`；后缀匹配已加且验证，但其冲突行为
   （两个类有同名方法）还没有测试覆盖。
3. **`-o addopts=""` 是必需的**——要禁用仓库的 xdist 默认配置才能做进程内 trace，
   这是 Python 目标上值得记录的一个部署细节。

---

## 9. 限制声明

- 快速模式：只粗筛 7 组高危模式，非全量审计
- 覆盖率数据只覆盖 `file_handler.py`（聚焦验证，非全仓覆盖率）
- 未运行依赖漏洞查询、深度密钥扫描、CI 配置审计
- crewAI 没有 `SECURITY.md`，无法做流程对比
- INCONCLUSIVE 发现的门禁 2 依赖仓库本身无法证明的供应链假设——这正是它是 INCONCLUSIVE
  而不是 TRUE POSITIVE 的原因
