# 把 euthyna 用作 PR 门禁（GitHub Actions）

中文原文 · [English](ci-integration.md)

> **本文是什么**：一份可直接粘贴的配方，让 pull request 接受 `euthyna audit` 门禁，
> 并说明门禁变红时每个退出码的含义。它只使用 CLI 已经发布的退出码契约——不解释任何
> flag，不解析任何报告。
>
> **局限**：history 生产者读 git，所以需要 `fetch-depth: 0`（或至少 `--base` 可达）。
> dependency 生产者读 lockfile；它回答的是 manifest 锁定了什么，而不是被锁版本有没有
> CVE——那个裁定按设计留给 agent 层（见 [`fact-contract-zh.md`](fact-contract-zh.md) §6.3）。

## 门禁，一步版

把它放进想加门禁的仓库，存为 `.github/workflows/audit.yml`：

```yaml
name: euthyna audit

on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # 历史归属要遍历真实的 git 对象
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: 变更面审计（删除代码来源 + 依赖锁定版本）
        run: npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD
```

这就是整个门禁。退出码按 CLI 发布的契约解读：

| 退出码 | 在 PR 门禁里的含义 | 合并按钮该做什么 |
|---|---|---|
| `0` | 已测量，没有 security 分类的发现 | 直接合并 |
| `10` | 已测量；至少一条 fact 属于 security 分类（删除代码来自安全修复、`--pickaxe` 下的重新引入） | 合并前由人读一遍报告——这是设计中的停留点，不是 bug |
| `1` | 用法错误（`--base` 写错、flag 错） | 修 workflow，不是修 PR |
| `2` | 完全无法测量（找不到 lockfile **不是**这种情况——缺数据按未评估报告，不是致命错） | **`2` 绝不合并**；「没测成」不等于「干净」 |

GitHub 把任何非零退出当作步骤失败，所以 `0` 显示绿，`10`、`1`、`2` 都显示红。如果希望
`10`（有发现）显示绿但留下评论而不是挡合并，捕获后翻译：

```yaml
      - name: 变更面审计（删除代码来源 + 依赖锁定版本）
        run: |
          npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD
        continue-on-error: true
        id: audit
      - name: 执行契约（10 = 留给人工审阅，其余非零失败）
        if: always()
        run: |
          code=${{ steps.audit.outcome == 'success' && 0 || 1 }}
          if [ "$code" -eq 0 ]; then exit 0; fi
          echo "euthyna audit 未测成干净（或发现了 security 分类的历史）；见上一步。" >&2
          exit 1
```

`ponytail:` 两步版用 shell 重述了一遍退出码，把 `10` 和 `2` 混在一起；一步版才是诚实的
门禁。只有当 `10` 不该挡合并时才用两步版。

## 把报告挂到 PR 上

运行会把人类可读的报告打进步骤日志。要作为附件挂到 PR 上：

```yaml
      - name: 变更面审计
        run: |
          npx --yes euthyna@latest audit --base "origin/${{ github.base_ref }}" --head HEAD \
            | tee audit-report.txt
        continue-on-error: true
        id: audit
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: euthyna-audit-report
          path: audit-report.txt
```

下游消费方（评论机器人、裁定 agent）要读 fact 而不是散文时，加 `--json` 并把 artifact
指向 JSON 文件。

## 这个门禁回答什么、不回答什么

- **回答**：这个 PR 里哪些被删除的行来自被分类为 `security` 或 `fix` 的提交（origins
  默认开启——归到最初引入者，而不是最后修改者），manifest 锁定了哪些 lockfile 依赖、
  位置在哪。
- **不回答**：任何东西是不是漏洞。`10` 的意思是*存在可供裁定的材料*；六道门的裁定
  发生在 agent 层（`euthyna gate`），这个 workflow 刻意不跑它——workflow 产不出门禁
  要求的证据纪律，假装能产就是在制造裁定。

## 附注

- `--pickaxe` 增加「被删除又加回」检测，代价是对每条删除行做一次 `git log -S` 探测
  （有上限）；当威胁模型是「修过的东西被改回来」时开启。
- `github.base_ref` 是 PR 的目标分支，所以常规场景下 `origin/main` 就是正确的 `--base`；
  叠 PR（stacked PR）需要真实的分叉点。
- `npx euthyna@latest` 什么都没锁；跟着 npm 的 `latest` 标签漂移的门禁，其结论跨时间
  不可比。在意一致性就钉住版本（`euthyna@0.5.0`）。
