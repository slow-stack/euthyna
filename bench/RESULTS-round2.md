# 第二轮结果（2026-09-19）—— 每案例 3 次独立裁定

## 这轮在测什么

第一轮的 10/10 只回答「纪律能否判对」；第二轮回答「这个判对是稳定的还是噪声」。
同一断言交给 3 个互相独立的裁定者（盲编号，互相不知道对方存在），看分布是否翻转。

开跑前先修掉了第一轮遗留的最弱证据链：

- `p1`/`p2`/`p3` 补上真实调用方（`src/api.js`：只有登录，没有角色/工作区校验），
  信任边界不再靠模块注释支撑；`exploits.js` 改为从请求处理器**端到端**驱动，
  10/10 期望仍然成立。
- `bench/score.js` 支持每案例多次裁定，并输出自我不一致（裁定噪声）清单。

## 结论

```text
10 案例 × 3 次 = 30 次独立裁定

真漏洞 12 次（4 案例 × 3）：抓住 12，漏掉 0，弃权 0
非漏洞 18 次（6 案例 × 3）：判对 18，误报 0，弃权 0

召回率 100%   特异度 100%   做出裁定 30/30
自我不一致的案例：0/10
```

| 案例 | ground truth | run 1 | run 2 | run 3 | 稳定 |
|---|---|---|---|---|---|
| `p1-prototype-pollution` | 真 | TRUE POSITIVE | TRUE POSITIVE | TRUE POSITIVE | ✓ |
| `p1b-prototype-pollution-guarded` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |
| `p2-path-traversal` | 真 | TRUE POSITIVE | TRUE POSITIVE | TRUE POSITIVE | ✓ |
| `p2b-path-traversal-guarded` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |
| `p3-command-injection` | 真 | TRUE POSITIVE | TRUE POSITIVE | TRUE POSITIVE | ✓ |
| `p3b-execfile` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |
| `p4-code-injection` | 真 | TRUE POSITIVE | TRUE POSITIVE | TRUE POSITIVE | ✓ |
| `p4b-unreachable-eval` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |
| `c1-comment-only` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |
| `c2-test-fixture` | 假 | FALSE POSITIVE | FALSE POSITIVE | FALSE POSITIVE | ✓ |

**零翻转。** 5 对「同模式、只差一道守卫」的近邻在 30 次裁定里没有被混淆过一次。
第一轮的 10/10 因此不是单次运行的运气——在更严的协议、更硬的案例上重复出了同样的数。

## 这一轮的主要工作其实是堵污染通道

### 协议逐轮收紧

- **run 1**：无文件协议，结论从主对话流过。⚠️ 独立性弱于后两轮，读三轮分布时要打这个折扣。
- **run 2**：file-only 协议 v1。启动时发现 3 个案例（case-05/06/10）的 run-1 结论
  还留在记忆库里——这 3 个裁定者就地处决重开。
- **run 3**：v2 —— 回传只许一行 `DONE case-NN-run3`；**禁止列举结果目录**
  （run-2 有裁定者自查时列了目录，从文件名和大小看到了兄弟案例，已如实申报）；
  旧临时目录删掉重建、不许读。

本轮记忆库多次重新长出带结论的条目——其中一条把 run 2 的十个结论全部列出，
另一条直接写着某个待跑案例的裁定词与利用机制。累计归档 60 余条（可逆），
每批裁定者启动前清一次并用上下文探针验证。补跑的 4 个案例，其 A 申报
（是否被注入记忆）全部确认只收到流程类条目，没有任何案例的结论。

### 两个关不上的残留

1. **`AGENTS.md`**：宿主自动注入每个裁定者，而仓库地图点名了 `bench/RESULTS.md`
   是结果文件。只能靠提示词禁令加申报兜底，无法根除。
2. **主控对话的自动摘要**：即使持续归档也会再长出。run 3 期间曾长出一条含
   **已交付**案例结论的摘要；在跑案例的申报均确认未见本案答案，且该条不含任何
   在跑案例的结论。这个窗口只能压缩，不能关死。

### 模型切换成了意外的跨模型检验

run 3 中途模型额度耗尽（ds-v4.1-flash → glm-5.3-flash），6 个裁定者死在半路：
case-03/04 赶在失败前把完整报告落盘（结尾四块齐全，已验收），
case-01/02/07/08 补跑。补跑的 4 个案例因此**前两轮与第三轮不是同一个模型**——
零翻转照旧成立。对「同条件重复」这是减分项，对「结论不依赖某个模型」是加分项，两头都记。

## 裁定者看穿的断言不精确处（全部照判，且判对）

断言不精确是**有意的**——真实世界的断言经常不精确，看穿它是纪律的一部分：

- **case-01**：断言对 `innerHTML` 读/写的描述与源码相反。
- **case-03**：断言把根因指在赋值行；真正的 sink 是递归帧——`target["__proto__"]`
  返回的是真 `Object.prototype`，`isPlainObject` 放行，递归把 target 换成了原型本身。
- **case-05**：断言说「未做规范化」；实际 `path.join` 会规范化 `..`，
  真正缺的是**归属检查**（结果可以落在 `REPORTS_DIR` 之外）。
- **case-07**：可利用元字符是**宿主相关**的。裁定者实测 Windows cmd.exe：
  `&`/`|` 可注入，`;`/反引号不行——实测而非引用通识。
- **case-08**：断言说 `execSync`，源码是 `execFileSync`——不经 shell，
  注入机制不存在。它判 FALSE POSITIVE 的原因是**机制缺失**，不是守卫存在。

另有两份报告的方法值得单独记：

- **case-04（run 3）** 给阴性结果配了**消融对照**：逐字复制过滤循环、只删守卫那一行，
  同一向量立刻污染成功——证明阴性是真实测量，而不是夹具悄悄失效。
- **case-06（run 3）** 的 VERDICT 行本身就是一句话反驳：22 项真实执行的逃逸输入
  无一读到目录外的 `canary.txt`。

## 局限性（必须和结果一起读）

- **样本小**：真漏洞一行只有 4 案例 × 3 = 12 次。100% 的置信区间依然很宽；
  这是强方向性信号，**不是比率**。
- **案例是刻意构造的**。测「纪律能否区分真伪」，不测「在真实代码里能否发现」。
- **run 1 的独立性弱于 run 2/3**（无文件协议）。
- **三轮不是同一模型**（run 3 跨了一次模型切换）。
- **污染通道只能压缩、不能关死**（见上）。
- **不测「发现」能力**：所有裁定都是拿现成断言做的。

## 复现

```powershell
node bench/exploits.js                              # ground truth 端到端成立（10/10）
node bench/prepare-blind.js                         # 盲副本（无答案、不透明编号、CommonJS 声明）
# 每案例每次一个裁定者：只读该案例目录 + 技能目录；报告落盘 %TEMP%；回传一行 DONE
node bench/score.js bench/verdicts-round2.json      # 10×3 混淆矩阵 + 稳定性
```

裁定者协议全文见 `bench/README.md` 的「盲测最大的敌人」一节。
第一轮结果与三次缺陷记录见 `bench/RESULTS.md`。
