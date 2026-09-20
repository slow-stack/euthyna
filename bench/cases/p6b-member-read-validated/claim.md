# 断言

**位置**：`src/archive.js` 的 `archiveDataset`
**类别**：路径穿越（读取侧）
**断言**：`archiveDataset` 把 `datasetName` 原样作为 tar 的成员路径
（相对 `data/` 目录），没有拒绝包含路径分隔符或 `..` 的成员名。因此
`datasetName` 指向 `data/` 之外的文件时，该文件会被打包进归档，
任何能取回这份归档的人都能读到它。

**威胁模型**：`datasetName` 来自 dashboard 的「archive now」按钮
（`POST /api/datasets/:name/archive`）。断言未说明该路由的守卫强度，
请自行核验调用链并明示你的假设。

**声称的影响**：以服务账号身份读取 `data/` 之外的文件内容（经归档间接外带）。

请按 euthyna 阶段 C 给出裁定。
