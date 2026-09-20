# 断言

**位置**：`src/archive.js` 的 `archiveDataset`
**类别**：路径穿越（写入侧）
**断言**：`archiveDataset` 构造归档输出路径时未做任何规范化处理，
`datasetName` 中的 `..` 路径段会原样进入 tar 的 `-czf` 输出文件名，
使归档文件被写到预期的 `backups/` 目录之外；若目标位置已有同名文件则被覆盖。

**威胁模型**：`datasetName` 来自 dashboard 的「archive now」按钮
（`POST /api/datasets/:name/archive`）。断言未说明该路由的守卫强度，
请自行核验调用链并明示你的假设。

**声称的影响**：以服务账号身份在预期归档目录之外创建或覆盖文件。

请按 euthyna 阶段 C 给出裁定。
