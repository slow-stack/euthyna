# 断言

**位置**：`src/archive.js` 的 `archiveDataset`
**类别**：命令注入
**断言**：`archiveDataset` 用模板字符串把 `datasetName` 拼进 shell 命令后交给 `execSync`，
未做任何转义或白名单。`execSync` 默认经由 shell 执行，因此 `datasetName` 中的
shell 元字符（`;`、`&`、`|`、`` ` ``）会被 shell 解释，从而执行额外命令。

**威胁模型**：`datasetName` 来自管理界面的输入框。断言未说明该界面是否需要管理员权限，
请自行核验调用链并明示你的假设。

**声称的影响**：以服务账号身份执行任意 shell 命令。

请按 euthyna 阶段 C 给出裁定。
