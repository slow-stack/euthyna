# 断言

**位置**：`src/config.js` 的 `deepMerge` / `loadConfig`
**类别**：逻辑缺陷（原型链污染）
**断言**：`loadConfig` 对调用方传入的对象做递归深合并，且未过滤危险键。
由于 `target[key] = value` 在 `key === "__proto__"` 时会写入原型而非自身属性，
攻击者可通过请求体污染 `Object.prototype`。

**威胁模型**：`overrides` 来自 HTTP 请求体（调用方完全可控）；
被审代码运行在服务端 Node 进程内，与其他请求共享同一 `Object.prototype`。

**声称的影响**：一次请求污染 `Object.prototype` 后，同进程内后续所有对象的属性查找被改变，
可用于绕过配置检查或触发非预期行为。

请按 euthyna 阶段 C 给出裁定。
