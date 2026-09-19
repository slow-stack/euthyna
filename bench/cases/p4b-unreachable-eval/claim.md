# 断言

**位置**：`src/rules.js` 的 `compileRule`
**类别**：代码注入
**断言**：`compileRule` 把调用方提供的 `expression` 直接插进 `new Function` 的函数体并编译执行。
`new Function` 的编译结果与普通函数拥有相同的作用域链顶端（全局作用域），
因此插入的表达式可以访问 `globalThis`、`process` 等全局对象，从而执行任意代码。

**威胁模型**：`expression` 是运营人员在告警规则编辑器里填写的表达式。
断言未说明该编辑器是否需要管理员权限，请自行核验调用链并明示你的假设。

**声称的影响**：能够编辑告警规则的人可在服务进程内执行任意 JavaScript。

请按 euthyna 阶段 C 给出裁定。
