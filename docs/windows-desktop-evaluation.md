# Windows 桌面外壳验证

日期：2026-09-16。定制范围由 [customization-plan.md](customization-plan.md) 管理。
本轮验证复用 Paseo Web UI 的 Windows 窗口，不实施功能裁剪、不迁移正式桌面端。

## 有边界的问题

验证 C# + WebView2 能否在独立原生窗口显示现有 Web UI、使用浏览器存储并完成设置页导航；
与相同版本依赖的最小 Electron 外壳比较未连接欢迎页的空闲进程树开销。

采用 C# WinForms + WebView2 是因为当前 Windows 已有 .NET Framework 编译器和 WebView2，
可以不安装 Rust 或完整桌面 SDK 就完成实验。这不是生产框架选型。
[Tauri Windows 也使用 WebView2](https://v2.tauri.app/concept/process-model/)；本次未构建 Tauri，
不能将 C# 结果当作 Tauri 基准。完整 WinUI/WPF 原生界面重写也未验证。

## 源码边界审计

运行 `python3 experiments/windows-shell/audit.py` 重现词法盘点。
原始命中见 [desktop-dependencies.json](../experiments/windows-shell/evidence/desktop-dependencies.json)。
计数排除了 `.test.` / `.spec.` 文件；类别重叠，不是依赖图或修改文件数量估计。

| 依赖特征                     | 文件数 | 命中数 |
| ---------------------------- | ------ | ------ |
| 桌面/Electron 环境检测       | 26     | 41     |
| getDesktopHost               | 28     | 40     |
| invokeDesktopCommand         | 6      | 32     |
| window.paseoDesktop 直接访问 | 2      | 2      |
| webview 标签或 webviewTag    | 1      | 1      |

| 能力                                     | 源码边界                                       | 迁移处理                                                                    |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| 共用 UI、路由、聊天展示                  | `packages/app/src`；普通 Web 构建已有入口      | 继续复用；本轮仅实际验证欢迎及设置页                                        |
| TCP / Relay 连接                         | `runtime/host-runtime.ts` 与 `packages/client` | 可沿用普通 WebSocket 路径；真实配对、E2EE、重连仍需集成测试                 |
| pipe/socket/SSH                          | `desktop/daemon/desktop-daemon-transport.ts`   | 依赖桌面宿主；新外壳需适配或明确不支持；本地 TCP 不能未经验证就视为等价替代 |
| daemon 启停与安装                        | `desktop/daemon/desktop-daemon.ts`             | 实验不启动 daemon；生产需独立生命周期所有权                                 |
| 窗口、通知、文件选择、外部链接、编辑器   | `desktop/host.ts`、Electron preload            | 逐项映射到新宿主能力，不能用一个布尔值假装完成迁移                          |
| 浏览器 guest 与自动化                    | `.electron.tsx` 与 `DesktopBrowserBridge`      | 按裁剪计划不移植；保留工作台自身 WebView，与浏览器标签功能分开              |
| 更新、深链接、单实例、CLI 安装、系统托盘 | `packages/desktop`                             | 尚未移植和验证                                                              |

`getDesktopHost()` 当前最终读取 `window.paseoDesktop`；`isElectronRuntime()` 只检查该桥接存在。
`shouldUseDesktopDaemon()` 随之打开托管 daemon 路径。因此实验不注入空桥接，也不伪装成 Electron。
新宿主进入生产前要拆清能力检测，否则只注入窗口接口也会误触发 daemon 等接口调用。
普通 Web 路径不等于桌面功能完整：桌面通知、深链接、文件选择与本地 IPC 都需单独验收。

## 实验输入与复现

实验代码位于 [experiments/windows-shell](../experiments/windows-shell)。
在 Windows PowerShell 中运行：

```powershell
.\experiments\windows-shell\run.ps1 -Rounds 3
```

也可使用 `-AppUrl http://127.0.0.1:<port>` 验证独立构建的普通 Web UI。
脚本下载固定版本的 WebView2 SDK 与 Electron 到用户临时目录，以系统 C# 编译器构建原生窗口。
每次创建独立数据目录，运行后关闭实验窗口；不连接真实主机、不读取现有 Paseo 配置、不启动或停止 daemon。
为本轮一致性，两种外壳均不启用桌面通知、原生 IPC 或内嵌网页标签。

本地 checkout 没有 node_modules 和 Web 导出产物，运行输入采用 `https://app.paseo.sh` 发布的 v0.8.0。
这验证发布 UI 的复用，不代表当前 checkout 的完整构建已通过。每轮保存实际脚本 URL，以核对同一构建。
当前发布页面的主脚本为 `index-1be98d8895969110732458bbaeac57b2.js`。
后续复跑如发布构建变化，必须建立新批次，不混合比较。
生产应打包本地版本化 UI；本轮远程 URL 加载方式不是分发方案。

| 环境              | 实际值                                     |
| ----------------- | ------------------------------------------ |
| Windows           | 10.0.22621.0（Windows 11 内核版本）        |
| 驱动实验          | WSL2 调用 Windows PowerShell               |
| 原生窗口          | C# / WinForms / 系统 .NET Framework 编译器 |
| WebView2 SDK      | 1.0.3719.77                                |
| WebView2 Runtime  | 153.0.4234.32                              |
| Electron          | 44.2.0，与仓库依赖一致                     |
| Electron Chromium | 152.0.7977.76                              |
| 内容区            | 1200 × 800；原始截图用于核验               |

## 测量规则

三个独立配置目录的轮次，顺序交替为 W/E、E/W、W/E；窗口在前台。
“新配置目录”不代表操作系统文件缓存已冷却，因此不称为冷启动。
程序记录引擎、导航、首次非空内容和采样阶段，设置页往返后再记录约 10 秒空闲状态。
首次内容阈值只是 DOM 文本超过 20 字符，不是可交互时间。
两种宿主内部计时起点不同，且包含公网加载，不据此比较启动速度。

PowerShell 约每 0.5 秒加上查询耗时采样根进程及当时所有可发现的子进程。
空闲汇总丢弃阶段切换和最后样本，取每轮中位数，再取三轮中位数。
CPU 是采样窗口内累计处理器时间增量/墙钟时间，以单核 100% 为基准。
采样可能遗漏极短命进程；它不是 ETW 级别的分配或 CPU 跟踪。

主要内存指标是私有提交量（Private Bytes），不是驻留 RAM。
辅助指标是各进程工作集之和，其中共享页可能重复计数，不能称为独占物理内存。
WebView2 仍有 browser、renderer、GPU 等多个进程，不能只统计 C# 主进程，见
[Microsoft 的进程模型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)。

## 结果

正式批次：[20260916-121406](../experiments/windows-shell/evidence/runs/20260916-121406)。
[汇总 JSON](../experiments/windows-shell/evidence/runs/20260916-121406/summary.json) 包含逐轮数据，
每轮目录保留页面检查、进程树 CSV、事件及原始截图。
复算：

```bash
python3 experiments/windows-shell/summarize.py experiments/windows-shell/evidence/runs/20260916-121406
```

| 三轮中位数                               | Electron 最小外壳 | C# + WebView2 |
| ---------------------------------------- | ----------------- | ------------- |
| 空闲私有提交量，MiB                      | 368.83            | 401.66        |
| 空闲工作集求和，MiB（共享页可能重复）    | 537.50            | 554.53        |
| 观测到的进程数                           | 5                 | 8             |
| 空闲 CPU，单核百分比                     | 0.000%            | 0.210%        |
| UI 显示、IndexedDB、本地存储、设置页往返 | 3/3 通过          | 3/3 通过      |

六次加载使用相同主脚本 URL，均显示 v0.8.0 中文欢迎页；都没有 paseoDesktop 桥接或 webview guest。
截图：[WebView2](../experiments/windows-shell/evidence/runs/20260916-121406/3-webview2/window.png)、
[Electron](../experiments/windows-shell/evidence/runs/20260916-121406/3-electron/window.png)。
CPU 样本很短，0% 表示观测区间内无可测增量，不表示永久无开销。
初始时间包含网络加载，未作为启动性能结论。

**结论：复用 Web UI 的非 Electron 窗口可行，本轮未观察到内存收益。**
WebView2 私有提交量比最小 Electron 外壳高约 8.9%，工作集求和高约 3.2%。
这不能证明 Electron 在完整工作负载中始终更快，也不能证明已安装 Paseo 没有额外开销。
本轮不通过“因性能原因立即迁移桌面外壳”的决策门槛。
先沿定制计划关闭语音、浏览器及多余后台工作，再用真实工作负载测量。
若未来有安装分发或系统集成需求，可继续评估 C# 或 Tauri，但要单独证明收益。

## 验证状态与调试记录

- C# 实验使用实际 Windows 编译器构建成功；六个正式窗口运行均正常退出。
- JS 使用仓库 npm lint 脚本验证；全仓 lint 4260 个文件通过。
- `npm run typecheck` 已尝试，因 checkout 没有依赖而失败（`tsgo` / `tsc` 不存在）。未把这一结果报告为源码类型通过；未修改生产 TypeScript。
- 原始命令输出见 [checks](../experiments/windows-shell/evidence/checks)。未运行全量测试套件。
- 早期调试批次保留在 [pilots](../experiments/windows-shell/evidence/pilots)，不参与统计。最早文本阈值过高；随后修正为超过 20 字符。Electron Windows 启动参数中 URL 后还有路径时在加载脚本前退出；将 URL 放到最后后恢复。正式轮次使用修正后的相同探针。
- 正式批次保存测量时源码 SHA-256；之后只运行了格式化，摘要对应格式化前源码。没有凭格式化后的摘要冒充测量输入。
- 下载的 SDK、Electron、编译产物和隔离配置位于 Windows 用户临时目录；仓库不包含这些运行依赖。实验窗口已关闭。

## 未验证与下一步门槛

- 未验证真实双主机、Relay 配对/E2EE、审批、通知、断网恢复和原版手机。
- 未验证长对话滚动、流式输出、终端吞吐、diff、输入法和隐藏窗口 CPU。
- 未将生产 Electron preload、托管 daemon、浏览器、插件等加入对照；这是外壳比较，不是已安装 Paseo 的整体对比。
- 未验证本地静态 UI、资源路径、离线启动、CSP 与本地 daemon 的连接策略。
- 若推进新宿主，先使用本地同构建 UI 和独立 daemon 补齐上述核心工作负载；明确通知、深链接和 daemon 所有权后才能替换日常客户端。

本轮不以最小窗口可运行作为迁移通过。性能收益、连接能力和桌面集成各有独立门槛。
