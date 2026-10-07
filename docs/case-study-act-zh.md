# 案例研究：euthyna 在 act 上的一次验证运行（2026-10-08）

[English](case-study-act.md) · 中文

> **本文档是什么**：它记录 euthyna 的一次**方法验证运行**——把 euthyna 的确定性测量
> （`history`、`deps`）和六门禁判定纪律，跑在一个真实的 **Go** 代码库上。前两个案例
> 分别跑在 JavaScript（axe-core）和 Python（crewAI）上；本次是 Go 侧的对位验证：
> 这套方法在大型 Go 项目上是否成立？
>
> **结论先行**：`history` 和 `deps` 在 Go 仓库上无需改动即工作（git 归属与语言无关；
> go.mod 属于 deps 已支持的三种清单之一）。**coverage 是本次确认的能力缺口**：Go 的
> `go test -coverprofile` 产出文本格式，现有生产者只认 JSON（c8/V8、coverage.py），
> 已用真实输出复现了拒答行为。粗筛的 4 个高危候选全部死于门禁或代码内证据——包括一个
> 自带真实安全通告编号（GHSL-2023-004）的文件，其穿越修复今天仍然有效，PoC 实测证明。
>
> **这不是对 act 的评价**：本报告不构成对 act 安全状况的背书。0 个真阳性只是本次限定
> 范围下的一次运行结果；未评估的判据列在第 1 节。

**审计模式**：快速（限定范围，测误报率 + 验证 Go 兼容性）
**目标仓库**：act（上游 `nektos/act`，v0.2.89），Go 源码 18,042 行（不含测试与 testdata）
**基线 commit**：`4f41128`（2026-06-01，v0.2.89，本地完整克隆 1,317 个提交）
**执行的阶段**：粗筛（Go 高危模式组）+ 变更面（两个 commit 的 history）+ 依赖面（go.mod）+ 一个可执行 PoC
**报告存放位置**：报告与 PoC 存放在 euthyna 仓库侧，**未写入被测仓库**（act 克隆在 `.scratch/`，gitignored）。

---

## 0. 执行摘要

| 指标 | 值 |
|---|---|
| 粗筛候选 | 4（exec 组 2 处同源一组 + artifact cache 绑定 + artifact 服务穿越 + FileEntry 写文件） |
| TRUE POSITIVE | **0** |
| FALSE POSITIVE | 4 |
| INCONCLUSIVE | 0 |
| 非安全观察 | 2 |
| **粗筛候选中的误报占比** | **4/4 = 100%**（本次未建立真阴性样本，故不称统计意义上的误报率） |

**方法验证结果**：

| 验证点 | 结果 |
|---|---|
| `history` 在 Go 仓库上工作 | ✅ 真实运行两次：v4 重写提交（5 条事实）；GHSL 修复提交（删除的 59 行被归属到 artifact 服务最初的实现提交 `11f6ee37a6`） |
| `deps` 读取 go.mod | ✅ 真实运行：104 条事实，每条都如实标注「声明版本非解析版本」（deps 读 go.mod 的需求声明，不做模块图解析） |
| `coverage` 读取 Go 覆盖率数据 | ❌ **本次确认的缺口**：`go test -coverprofile` 的文本格式被正确拒答（`Unexpected token 'm', "mode: set\n" is not valid JSON`），拒答行为本身符合「缺数据不是干净」的设计 |
| 六门禁判定纪律在 Go 代码上成立 | ✅ 4 个候选中 3 个死于门禁 2（可达性），1 个（穿越）在门禁 4（PoC 验证）被实测证伪；每个都有具体证据 |

**结论**：在这个目标上，**全部 4 个粗筛候选都是误报**，且其中最有故事性的一个——自带
CVE 级通告编号的 artifact 服务——其历史穿越面（GHSL-2023-004）已被 `safeResolve` 修复，
本次用可执行 PoC 复验了修复仍然有效。这是「看起来危险」与「真的是漏洞」之间差距的又一次
量化样本；同时本次暴露了一个明确的能力缺口（Go coverage 格式），与 crewAI 运行当年暴露
coverage.py 缺口的模式一致。

---

## 1. 覆盖表（先列未评估项）

| 判据 | 状态 | 原因 |
|---|---|---|
| 全仓漏洞扫描 | ❌ 未评估 | 快速模式只粗筛高危模式，非全量审计 |
| 依赖漏洞（OSV 等） | ❌ 未评估 | deps 只裁决「锁定了什么版本」，CVE 裁定按设计留给 agent 层 |
| Go 覆盖率测量 | ❌ **不可用** | 文本格式不受支持，本次以真实输出确认（第 4.3 节） |
| 密钥扫描 | ⚠️ 部分 | 粗筛命中 0（testdata 里的 vendored JS 已排除）；0 命中 ≠ 无密钥 |
| SQL 注入 | ❌ 未评估 | 目标仓库无 SQL 使用面 |
| workflow 语义（GitHub Actions 模拟器的正确性） | ❌ 未评估 | 超出快速模式范围 |

**因此本报告不能作为「act 没有安全问题」的背书。** 它只说明：在本次限定的粗筛范围与判定
纪律下，没有产生真阳性，且方法本身在 Go 代码库上可复现地工作（coverage 除外，如实记录）。

---

## 2. 粗筛方法与候选来源

对 `pkg/` 与 `cmd/`（排除 `*_test.go`、`testdata/`、vendored JS）做 Go 版高危模式正则粗筛：

| 模式组 | 命中数 | 说明 |
|---|---|---|
| `exec.Command` / `exec.CommandContext` | 2 | `pkg/gh/gh.go:20`、`pkg/container/host_environment.go:301` |
| tar 解包 / `filepath.Join` 拼档案名 | 2 | 均为**构造** tar（`filecollector`、`action_cache`），非解包不可信档案 |
| `json.NewDecoder` / `yaml.Unmarshal` | 1 | `artifactcache/handler.go:221` 解码 HTTP body（生产代码；yaml 命中全在测试里） |
| `net.Listen` / `ListenAndServe` | 2 | `artifactcache/handler.go:109`、`artifacts/server.go:303` |
| `InsecureSkipVerify` / `md5` / `sha1` | 0 | testdata 里的 vendored JS 已排除 |
| 硬编码密钥字面量 | 0 | — |
| `os.WriteFile(filepath.Join(...))` 可变路径 | 1 | `container/host_environment.go:56`（FileEntry 写入） |

粗筛收敛为 **4 个候选**（2 处 exec 同源归为一组）：

1. `pkg/gh/gh.go:20` + `pkg/container/host_environment.go:301` — `exec.CommandContext` 组
2. `pkg/artifactcache/handler.go:109` — cache 服务绑定外网 IP
3. `pkg/artifacts/server.go` — artifact 服务无鉴权 + 历史穿越面（GHSL-2023-004）
4. `pkg/container/host_environment.go:56` — `os.WriteFile(filepath.Join(destPath, f.Name))`

外加变更面候选：commit `e1e5671`（Artifacts v4 后端重写，涉及安全修复所在的同一文件）。

**act 的信任模型（裁定前必须声明）**：act 在本地运行**用户自己的** GitHub Actions
workflow，执行 workflow 指定的命令是产品契约而非漏洞。真正的攻击者角色只有三种：
远端 action 的作者（action 仓库可以来自任何人）、容器镜像的维护者、以及运行期间同网络的
对端。以下裁定全部基于这个模型。

---

## 3. 裁定详情

### BUG #1 FALSE POSITIVE — `exec.CommandContext` 组

**门禁 2（可达性）FAIL**：两处调用的命令来源都不是攻击者可控输入。
`pkg/gh/gh.go:20` 以硬编码参数调用 `gh auth token`；`host_environment.go:301` 执行的是
workflow step 的 `run:` 命令——那是用户自己写的（见信任模型声明），且 `--container` 不
生效时直接在宿主跑 workflow 本来就是 act 的明示行为（`HostEnvironment` 的存在就是为它）。

- 证据：`pkg/gh/gh.go:20-23`；`pkg/container/host_environment.go:285-309`
- 误报清单对照：条目 9（模式识别 ≠ 漏洞分析）、条目 4（数据源上下文）

### BUG #2 FALSE POSITIVE — artifact cache 服务绑定外网 IP

**重述断言**：`net.Listen("tcp", fmt.Sprintf("%s:%d", h.outboundIP, port))`
（`artifactcache/handler.go:109`）把 cache 服务暴露给局域网，无鉴权可写缓存。

**门禁 2（可达性）FAIL**：实读代码，全部 6 条路由都注册在 `"/" + h.token + apiPath`
前缀下（`handler.go:96-103`），token 是 16 字节 CSPRNG 输出的 hex（`handler.go:90-94`），
共 128 位熵。路由匹配本身就是鉴权：不持有 token 的请求到不了任何 handler。绑定外网 IP
是**有意设计**——容器需要从容器网络侧回连宿主拿缓存，绑 127.0.0.1 反而破坏功能。

- 证据：`pkg/artifactcache/handler.go:90-109`
- 误报清单对照：条目 6（核验主张时先读实现）、条目 9
- 附带观察见第 5 节观察 1（与 BUG #3 形成的对比是本案例的过程记录）

### BUG #3 FALSE POSITIVE — artifact 服务的路径穿越（历史通告 GHSL-2023-004 的修复有效性）

**重述断言**：`artifacts/server.go` 的上传/下载路由把 `itemPath`/`path` 直接拼进文件路径，
攻击者可用 `../` 逃逸 `baseDir` 写任意文件（CWE-22）。该文件曾有真实安全通告：
修复提交 `63ae215` 的信息自述「fix: update artifact server to address GHSL-2023-004」
（通告正文内容本报告未核对，此处只采信仓库内证据：提交信息与测试夹具
`pkg/artifacts/testdata/GHSL-2023-004/artifacts.yml`）。

**门禁**：

| 门禁 | 结果 | 证据 |
|---|---|---|
| 1 流程 | ✅ | 数据流、PoC、历史全部完成 |
| 2 可达性 | ✅ | 路由无任何 token 前缀、无 Authorization 检查（与 BUG #2 的 cache 服务形成对比）；服务以 `127.0.0.1` 可达，PoC 实测通过 |
| 3 真实影响 | ✅（假设穿越成立） | 逃逸出 `baseDir` 即任意文件写 |
| 4 PoC 验证 | ✅ **穿越被证伪** | 见下方 PoC |
| 5 数学边界 | — | 被 PoC 覆盖 |
| 6 环境 | ✅ | 无沙箱阻断 |

**PoC（真实 `Serve()`、真实 TCP、真实文件系统）**：完整可运行源码如下（放入
`pkg/artifacts/` 运行 `go test -run TestEuthynaPoc -v`；act 克隆在 `.scratch/`，本源码
已内联于此，供 `.scratch` 清理后复现）：

```go
package artifacts

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestEuthynaPocUnauthenticatedUploadAndTraversal(t *testing.T) {
	baseDir := t.TempDir()
	parent := filepath.Dir(baseDir)

	addr := "127.0.0.1"
	port := "39517"
	base := fmt.Sprintf("http://%s:%s", addr, port)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := Serve(ctx, baseDir, addr, port)
	defer stop()

	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := http.Get(base + "/"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("server did not start")
		}
		time.Sleep(50 * time.Millisecond)
	}

	req, _ := http.NewRequest(http.MethodPut, base+"/upload/123?itemPath=../../../euthyna-poc.txt", strings.NewReader("euthyna-poc-content"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	rbody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	t.Logf("PUT /upload status=%d body=%s", resp.StatusCode, rbody)

	clamped := filepath.Join(baseDir, "123", "euthyna-poc.txt")
	if data, err := os.ReadFile(clamped); err != nil {
		t.Errorf("expected the payload clamped inside baseDir at %s: %v", clamped, err)
	} else {
		t.Logf("clamped into baseDir: %s (%q)", clamped, data)
	}

	escaped := filepath.Join(parent, "euthyna-poc.txt")
	if _, err := os.Stat(escaped); err == nil {
		t.Errorf("TRAVERSAL: file escaped baseDir to %s", escaped)
	} else {
		t.Logf("no file outside baseDir: %s", escaped)
	}

	gresp, err := http.Get(base + "/artifact/123/euthyna-poc.txt")
	if err != nil {
		t.Fatal(err)
	}
	gbody, _ := io.ReadAll(gresp.Body)
	gresp.Body.Close()
	t.Logf("GET /artifact status=%d body=%q", gresp.StatusCode, gbody)
	if gresp.StatusCode != http.StatusOK {
		t.Errorf("expected unauthenticated download to succeed, got %d", gresp.StatusCode)
	}

	// the GET handler never closes the file; on Windows the still-open handle
	// breaks t.TempDir cleanup. Force the finalizer to prove the fd is only
	// reachable through GC, not through any Close call.
	stop()
	cancel()
	runtime.GC()
	time.Sleep(100 * time.Millisecond)
}
```

实测输出：

```
PUT /upload status=200 body={"message":"success"}
clamped into baseDir: …\001\123\euthyna-poc.txt ("euthyna-poc-content")
no file outside baseDir: …\euthyna-poc.txt
GET /artifact status=200 body="euthyna-poc-content"
--- PASS: TestEuthynaPocUnauthenticatedUploadAndTraversal (0.18s)
```

**穿越死，无鉴权活**。

**裁定：FALSE POSITIVE**——穿越修复（`63ae215` 引入 `safeResolve`，替换裸
`fmt.Sprintf("%s/%s", runID, itemPath)`）在当前 HEAD 依然完整覆盖上传、下载与 v4 路由
（`safeResolve` 在 `server.go` 与 `artifacts_v4.go` 共 13 处调用）。

**给项目方的建议（作为观察，非裁定）**：与 cache 服务对齐——artifacts 服务全部路由无
token、无任何鉴权，且 `--artifact-server-addr` 默认绑**外网 IP**（`cmd/root.go:118`），
`--artifact-server-path` 虽是可选（不传则服务不启动），但一旦启用即向局域网开放无鉴权的
文件上传/下载。按声明攻击者模型（同网络对端）明确评估影响面：对端可以**无鉴权写任意
内容进 `baseDir` 下的任意路径**（含覆盖既有 artifact，即投毒用户随后下载的产物——下游
后果取决于用户对产物做的事，属供应链面）与**无鉴权读全部 artifact**（用户暂存的产物
内容泄露），外加观察 2 的句柄泄漏构成平凡 DoS。影响被 `safeResolve` 限制在 `baseDir`
内、服务需显式 opt-in、且需要同网络位置——三者合起来使它不构成「可报裁定」的发现，
但影响面本身是真实的。建议默认绑 `127.0.0.1`，或照 cache 服务加 token 前缀。

### BUG #4 FALSE POSITIVE — `os.WriteFile(filepath.Join(destPath, f.Name))` 的 FileEntry 写入

**门禁 2（可达性）FAIL**：`FileEntry` 的生产方全部是 act 内部代码（`runner/expression.go:204`、
`runner/run_context.go:242,425`、`runner/step.go:158-170`），文件名硬编码（env 文件、
event payload 等），不来自 workflow 文本、远端 action 或容器镜像。`filepath.Join` 的
`..` 风险在此没有攻击者可控输入可乘。

- 证据：`grep -rn "FileEntry{" pkg --include='*.go'`（非测试 10 处，全部内部常量名）
- 误报清单对照：条目 9

### 变更面 — commit `e1e5671`（Artifacts v4 后端）未删除安全修复代码

v4 重写大改 `pkg/artifacts/`。`euthyna history` 对该提交产出 5 条事实：4 条 go.sum 依赖
换血、1 条 `run_context.go` 单行（来源 `11f6ee37a6`，分类 none）。**没有任何删除行归属到
GHSL 修复提交 `63ae215`**——`safeResolve` 在 v4 重写中存活（BUG #3 的 13 处调用即证据）。
方法上，这是 crewAI 案例「貌似安全回归实则不是」的对位验证：这次连触发检查的红旗都没有。

### 变更面 — commit `63ae215`（GHSL-2023-004 修复）的来源追溯

`euthyna history --base 63ae215^ --head 63ae215` 产出 2 条归属：修复删除的 59 行代码来自
`11f6ee37a6`（"Asset server implementation (#677)"，artifact 服务最初的实现提交），
14 行来自 `7105919f0c`（chunked upload 支持）。**漏洞代码的出生证明被追溯到了引入它的
提交**——这正是 `history` 存在的目的，且在 Go 仓库上无需任何改动。附带的诚实输出：
`-S` 探针上限 40 用尽的提示、7 行过短内容（< 12 字符）不追溯的提示，均如实打印而非静默。

---

## 4. 方法验证详情

### 4.1 `history` 在 Go 仓库上工作（验证点）

```bash
node <euthyna 仓库>/bin/euthyna.js history --base 63ae215^ --head 63ae215 --repo <act 克隆>
```

真实输出（摘录）：

```
已确证 (2)
  • 本次变更删除了 59 行来自提交 11f6ee37a6 的代码，分布在 2 个文件。提交信息：
    "Asset server implementation (#677)"，分类：none
  • 本次变更删除了 14 行来自提交 7105919f0c 的代码，分布在 2 个文件。提交信息：
    "Added support for chunked uploads. (#1208)"，分类：none
```

`git blame` / `git log -S` 与语言无关，`history` 在 Go 仓库上无需改动即工作。退出码 0。

### 4.2 `deps` 读取 go.mod，并如实声明自己的边界

`euthyna audit` 合并报告中，go.mod 的每个依赖产出一条事实，每条都带同样的诚实标注：

> 依赖 github.com/docker/cli 在 go.mod（go）中被声明为版本 v29.3.0+incompatible ——
> **这是声明的需求版本，非最终解析版本（go.sum 不含版本，无法在此验证解析结果）**

Go 的依赖裁决语义与 npm/Cargo 不同：go.mod 只承载需求声明，选定的构建清单是 MVS 对整个
模块图（各 go.mod）求解的结果，go.sum 记录的是「版本+哈希」对而非选定清单。deps 生产者
不做模块图解析，所以只答「声明了什么」——它没有假装能回答它回答不了的问题。这与
fact-contract「测量器只回答能确定回答的问题」的原则一致。

> 修订说明：本次运行的工具输出原文写着「go.sum 不含版本」，该措辞不准确（go.sum 每行
> 都有版本）；工具消息已随本 PR 更正为「go.sum 记录版本与哈希，但不含 MVS 选定的构建
> 清单」。

### 4.3 `coverage` 不支持 Go 格式——本次确认的能力缺口

```bash
go test -coverprofile=act-cover.out ./pkg/artifacts/ -run TestEuthynaPoc   # 成功，14.7%
node bin/euthyna.js coverage --coverage act-cover.out --symbol safeResolve
```

真实输出：

```
本次运行没有产出任何事实。
⚠ 未评估的判据（缺数据不等于干净）：
  • test_coverage: 无法读取覆盖率数据 …: Unexpected token 'm', "mode: set\n" is not valid JSON。
    未运行测试或测试未产出覆盖率时，这属于「未评估」，不是「未被覆盖」
```

Go 的 profile 是文本格式（`mode: set` 头 + `file.go:起始行.起始列,结束行.结束列 语句数 命中数`，
**不含函数名**）。行为正确（拒答而非假装覆盖），但这是 Go 目标上确证的缺口——与 crewAI
运行当年 coverage.py 缺口的模式一致。补齐它需要把行区间映射回函数（解析源码函数声明），
工作量大于 coverage.py 那次（`Class.method` 直接在 JSON 里）。

---

## 5. 非安全观察（**不是发现**）

### 观察 1：两个本地服务的鉴权不对称

cache 服务：token 前缀保护全部路由（BUG #2）。artifacts 服务：零鉴权（BUG #3 的 PoC 证明）。
两者绑定地址默认值相同（外网 IP，`cmd/root.go:118,124`）。按攻击者模型评估，对端可做
三件事：写任意内容进 `baseDir`（artifact 投毒）、读全部 artifact、经观察 2 的句柄泄漏
耗尽资源。不报裁定的理由不是「影响不存在」，而是利用前提的叠加：服务需显式 opt-in、
需要同网络位置、影响边界由 `safeResolve` 钳在 `baseDir` 内。不对称本身暗示零鉴权不是
设计决定而是遗漏——若上游确认这是有意为之，本观察应升格重估。

### 观察 2：`GET /artifact` 处理器从不关闭文件句柄

`server.go:261-271`：`fsys.Open` 打开的文件经 `io.Copy` 后**没有任何 Close**。PoC 在
Windows 上实测撞见：测试结束后 `t.TempDir` 清理失败（`The process cannot access the file
because it is being used by another process`），只有 GC finalizer 兜底。每个下载泄漏一个
句柄，长期运行的 artifacts 服务会累积。纯资源泄漏，非安全发现。

---

## 6. 过程记录：PoC 如何同时证伪一个主张、证实另一个

- 第 1 步：粗筛把 `server.go` 列为候选——既有历史通告编号，又有当前代码里无鉴权的路由。
- 第 2 步：拆开两个主张分别取证。**穿越**主张：`safeResolve` 的两段式 Join 是标准的
  「先钳到根再回 baseDir」写法，但门禁纪律不接受「看起来对」，要求执行证据。
- 第 3 步：写 Go test 驱动真实 `Serve()`（非 httptest mock），发真实穿越载荷：PUT 200、
  文件落在 `baseDir/123/`、`baseDir` 外无文件、GET 200 读回。**一个 PoC 同时证伪穿越、
  证实无鉴权**。
- 第 4 步：两个主张分别裁定——穿越 FALSE POSITIVE（门禁 4 PoC 证伪），无鉴权暴露不构成
  发现（影响被钳制在 `baseDir` 且服务需显式 opt-in）→ 观察 1。

**记录的经验**：一个候选可以同时携带一个死主张和一个活主张。按门禁拆开裁定，而不是给
整个文件下一个结论。

---

## 7. 计数汇总

- TRUE POSITIVE：0
- FALSE POSITIVE：4
- INCONCLUSIVE：0
- 非安全观察：2

---

## 8. 本次运行暴露的能力缺口（如实记录）

1. **Go coverage 文本格式不可读**——`go test -coverprofile` 产出 `mode: set` 文本，现有
   生产者只认 JSON。拒答行为正确；补齐需要把行区间映射回函数（Go profile 不含函数名），
   比 coverage.py 那次工作量大。已在真实输出上复现（第 4.3 节）。
2. **go.sum 换血淹没代码信号**——依赖升级提交会把几十条 go.sum 删除行（消息常含
   "security"，被正确分类）塞进 history 报告，代码文件的真实信号被稀释。这是 Go 目标的
   部署细节（crewAI 案例里 `-o addopts=""` 的对位物）；按路径过滤或降噪是后续改进方向，
   本次未实现。
3. **deps 对 go.mod 只能答「声明了什么」**——选定构建清单是 MVS 对整个模块图求解的
   结果，deps 不做模块图解析，这是生产者的设计边界而非 go.sum 的内容缺失。若需解析
   版本，需要引入 `go list -m`（这会打破「执行 git 之外的东西要显式同意」的边界，
   需要单独决策）。

---

## 9. 限制声明

- 快速模式：只粗筛高危模式组，非全量审计；workflow 语义（act 作为 Actions 模拟器的
  正确性）完全未评估
- coverage 测量在 Go 目标上不可用，本次无覆盖率数据支撑
- GHSL-2023-004 通告正文未从外部核对，只采信仓库内证据（提交信息、修复内容、测试夹具）
- act 上游最后推送 2026-08-09（克隆 HEAD 2026-06-01）；「上游是否已知悉观察 1/2」未核对
- PoC 的「局域网对端可达」未实测（单机无法证明），仅实测了「无鉴权」与「穿越被钳」
  两个可在单机证明的命题——观察 1 的定性不受影响，但利用面大小取决于部署环境
