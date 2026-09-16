# Paseo 轻量定制计划

状态：2026-09-16 与用户确认的范围；本文件是定制决策的唯一来源。已进入首批功能裁剪与后台优化，验证结果见下文。
桌面技术验证见 [Windows 桌面验证](windows-desktop-evaluation.md)。

## 使用场景与约束

- 家里只在 WSL 运行 daemon 和本地 agent，不保留 Windows 桌面安装。公司电脑使用 Windows x64 免安装 ZIP，同时运行本地 daemon 和 agent。
- 公司客户端同时连接公司 daemon 与家里 WSL；手机与公司通过 Relay 访问家里 WSL。
- 手机使用原版 App，不修改、不重新发布。保留协议、配对、加密、重连和版本兼容。
- Windows 保留独立 App 窗口及聊天工作台 UI；本轮保留 Electron，暂不重写外壳。
- 家里与公司各自持有项目、工作区与会话，不引入跨主机执行状态复制。
- 关闭桌面窗口不应隐式结束后台 agent。桌面关闭与 daemon 停止分别控制。

## 完整裁剪范围

“候选”属于已同意评估的范围，不等于已经完成删除；不以隐藏菜单冒充运行成本下降。

| 功能                               | 决策               | 实施边界与验收                                                                                   |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 全部语音、听写、播报、本地语音服务 | 确定关闭           | 两台 daemon 均关闭，定制电脑端移除入口；检查服务不启动。手机原版禁用表现需实测，不能保证入口消失 |
| 内嵌浏览器与浏览器自动化           | 确定移除电脑端能力 | 不创建网页标签和 guest 进程；外部 HTTP(S) 链接交系统浏览器；不删除手机可能发送的协议类型         |
| Relay                              | 必须保留           | 配对、端到端加密、断线重连、手机后台恢复                                                         |
| 多主机与核心会话工作流             | 必须保留           | 创建、发送、中断、审批、历史补齐、归档与恢复、完成及待审批通知                                   |
| Project / Workspace 身份及持久化   | 必须保留           | 工作区执行目录、worktree 归属和恢复不能失真                                                      |
| 文件监听与 Git 自动刷新            | 重点精简           | 区分 UI demand 与执行/自动化 demand；释放无人关注的 UI 订阅，保留必要身份检测，提供手动刷新      |
| 未使用的 Provider                  | 仅启用实际使用者   | 保留 Claude、Codex、OpenCode、Cursor 和通用 ACP；其余内置 Provider 默认关闭                      |
| 插件                               | 默认关闭、按需启用 | 后续业务扩展逐项启用，不删除扩展契约                                                             |
| Hub                                | 无需求时停用       | 不影响 Relay；确认停用后无关系维护及远程连接                                                     |
| 开发服务代理、公开预览地址、探活   | 无需求时停用       | 用户目前未提出公开预览需求；无目标不轮询                                                         |
| PR/CI 查询、自动归档               | 默认关闭候选       | 保留手动 Git 操作；清楚告知自动更新和自动归档不再发生                                            |
| 定时任务、heartbeat                | 无需求时停用候选   | 先核验是否已有有效任务，不静默删除数据                                                           |
| 多窗口、辅助面板                   | 精简候选           | 首版单窗口；保留必要工作区标签、导航和设置                                                       |
| 官网与移动端构建发布               | 排除定制交付流程   | 不声称降低客户端运行内存，不必删除上游源码                                                       |
| 终端、文件浏览、diff、worktree     | 保留基本能力       | 按需加载和释放后台资源；不取消并行 agent 的目录隔离                                              |

## 文件监听与 Git 的行为目标

打开文件或 diff 面板时获取最新状态，持有必要订阅；关闭后释放 UI 拥有的订阅。
侧栏允许暂时显示缓存，切换工作区、相关操作完成或手动刷新时更新。
无客户端连接不代表无后台需求：运行中的 agent、审批、通知和保留的自动化继续工作。
保留项目身份、执行目录及 worktree 生命周期所需检测。实现遵守
[file-observation.md](file-observation.md) 的订阅释放屏障，不在页面另造轮询。

## 实施顺序

1. 固化本计划，建立 Windows 桌面外壳验证及性能基线，决定是否迁移外壳。
2. 配置关闭语音与未使用集成，验证未启动相关进程；保留已确认的 Provider。
3. 移除定制电脑端浏览器入口及运行路径，处理已有浏览器标签的持久化兼容。
4. 根据测量精简文件监听、Git 刷新和隐藏工作区订阅；保留手动刷新。
5. 验证原版手机与两台 daemon 的 Relay、聊天、审批、恢复和通知。

## 验收与边界

分别记录桌面进程树、daemon、Provider 子进程的 CPU 与内存，不能只比较主进程。
场景包括无连接空闲、连接空闲、单 agent、长对话、终端输出和多个工作区。
使用相同 UI 构建、相同窗口尺寸、相同工作负载；启动分开记录冷启动和暖启动。
没有测量的收益标记为假设。关闭功能必须保留既有协议解析，并核验原版手机行为。
不得未经授权重启正式 6767 daemon；实验使用独立目录与配置。

当前未决：最明显的卡顿场景、已有插件/调度的使用情况，以及两台主机实测的资源基线。

## 当前部署状态（2026-09-16，Lite.7）

本机 `paseo` / `paseo-lite` 入口、supervisor 和 worker 已切换到 `/home/syat/.local/share/paseo-lite/0.8.0-lite.7`，监听 `127.0.0.1:6767`。用户授权后在无运行中 Agent 时切换，配置与 Relay 身份 SHA256 不变，Relay control 已连接。回滚备份：`/home/syat/.local/share/paseo-migrations/20260916-200648-lite7`。本次上下文优化的范围与限制见 [上下文审计](codex-context-audit.md)。

Windows 免安装交付 `Paseo-Lite-0.8.0-lite.7-x64.zip`，源码 `e25f33db9`，SHA256 `a5f9d053df8df39d9f91d23cef697fb29db7242010e0a15a278b5b94e3565930`。包内 8 个关键文件与 WSL/验证构建逐一一致，隔离 Windows 启动、图片粘贴及重载字节一致性检查通过，无页面错误，ZIP CRC 和归档内 app.asar 一致性校验通过。家里 Windows 不安装；公司本地 Agent 必须停止旧包 daemon 后换用新版，单纯退出窗口不保证停止后台服务。手机继续使用原版 App 连接 WSL。

## 加密终端粘贴图片修复（lite.5，2026-09-16）

用户确认：公司 Windows 有终端文件加密；同一截图以 Ctrl+V 粘贴，Codex App 正常，Paseo 附件预览空白且模型报告文件头 `%TSD-Header-###%`。尚未直接读取公司失败附件，因此不能声称已在企业加密环境复现。

代码确认旧路径：剪贴板 Blob → Electron 写临时 `.png` → 再读文件 → Base64 上传。修复为剪贴板/blob/bytes/data URL 使用已有 IndexedDB Blob 存储，预览与上传使用同一份字节；旧 desktop-file 元数据和手选文件 URI 继续路由原存储，清理覆盖两套存储。没有修改企业加密设置，也没有解密旧附件。

桌面上传前用实际图片解码校验，无法解码时阻止发送并提示重新截图粘贴；附件编码异常不再被静默过滤成仅文本发送，草稿由现有失败恢复路径保留。

Codex 适配器改用原生 `image` + data URL 输入，避免 provider 再写临时图片。已通过本机 Codex 0.154.0 `app-server generate-ts` 生成的 v2/UserInput 协议定义确认支持；这不等于已审阅闭源 Codex Desktop 的内部实现。PNG 字节与 data URL 透传有回归测试。

验证：附件相关 10 项、Codex adapter 152 项测试通过，全工作区类型检查与修改文件 lint 通过。Windows 实际 ClipboardEvent 粘贴 240×80 PNG（3101 字节），预览正常，IndexedDB 存储及页面重载后字节完全一致、可解码，无页面异常；截图 `.artifacts/windows/lite5-clipboard.png`。未发起付费模型调用，未在公司加密终端直接验证。

交付 `.artifacts/windows/release/Paseo-Lite-0.8.0-lite.5-x64.zip`，ZIP CRC 通过，SHA256 校验文件同目录。公司端先使用新客户端、删除旧坏附件后重新粘贴，即可验证客户端修复；WSL 暂不需要重启来验证这一部分。Codex 原生 image 直传需要新版 daemon，WSL 新目录 `/home/syat/.local/share/paseo-lite/0.8.0-lite.5` 已准备，正式 6767 服务未切换。测试 Windows 程序和它启动的临时 daemon 已清理。

## 输入与 Codex 上下文优化（lite.4，2026-09-16）

- 客户端 Alt+Enter 在光标/选区处显式插入换行，优先于补全与发送，输入法组合事件不拦截；Shift+Enter 保留兼容，Enter 和 Ctrl/Command+Enter 发送语义不变。中英文通用设置提示同步更新。
- Codex adapter 默认单个工具结果历史预算 4000 token，覆盖创建、恢复与发送配置；追加简短按需读取提示，要求对截断证据继续定向读取。正式角色指令和独立/交叉复核完整保留。未修改 Codex 全局设置、模型窗口、思考级别和压缩阈值。
- 排查发现历史样本存在多次长文档/大 JSON 整篇读取和重复读取；没有证明是窗口变小或 Paseo 每轮重发整个 UI 历史。样本范围及局限见 [Codex 上下文排查](codex-context-audit.md)。具体问题会话尚待用户指认；未做付费模型 A/B，不能量化收益。
- 验证：输入状态 20 项、Codex adapter 152 项测试通过，全工作区类型检查和修改文件 lint 通过；server、Electron 和 Expo 构建通过。Windows 实际草稿输入验证 Alt+Enter 选区换行通过，无发送；截图 `.artifacts/windows/lite4-alt-enter.png`，测试进程已清理。
- 交付 `.artifacts/windows/release/Paseo-Lite-0.8.0-lite.4-x64.zip`，ZIP CRC 通过，校验文件同目录 `SHA256SUMS-lite.4.txt`。归档内版本和工具预算设置均已核验。
- WSL `/home/syat/.local/share/paseo-lite/0.8.0-lite.4` 已准备；正式 daemon 仍为 lite.2，未切换/重启。服务端节省上下文与自动命名关闭尚未在家里 WSL 生效，须经用户同意切换并重新加载会话。已有长上下文不会立即缩小。

## 设置与运行路径收敛（lite.3，2026-09-16）

用户授权：设置分为常用与高级、缩小 Windows 外边框、标签右键归档 agent、排查额外 token；确认默认关闭自动 AI 标题/分支命名。

- 常用保留通用、外观、通知、权限，以及主机概览、项目、连接、配对、Agent 和 Provider；布局、编辑器、快捷键、集成、诊断、关于、元数据、工作区、用量、终端归入可展开的高级设置。直达高级页时自动展开。
- 移除插件设置入口及其页面运行挂载，旧链接显示已停用说明；移除语音播放诊断及桌面输入框残留麦克风；Web/桌面使用独立禁用实现，不再挂载听写订阅或语音运行时，原版手机 App 不变。Electron 移除内嵌浏览器的 IPC、捕获、键盘、弹窗和 profile 初始化路径，webview 继续禁止。
- Windows frameless 窗口关闭 thickFrame，消除系统厚外沿；保留自绘标题栏与窗口控制。Windows 实机验证窗口外框/客户区均为 1200 × 800，左边缘 WM_NCHITTEST 返回 HTLEFT（10）；最大化与还原通过。尚未人工拖拽逐边验证。
- Agent 标签右键菜单增加明确的归档操作；仅 agent 有此项，运行中的 agent 使用已有确认框；归档成功后清理对应标签，失败沿用已有回滚与提示。
- 默认停止自动工作区模型命名，使用首条消息摘要，保留现有分支名。手动改名及明确点击的元数据生成不变。

### Token 排查边界

自动工作区命名原来会启动内部模型会话，并在结构化输出失败时重试（最多两次）；候选模型失败还可继续尝试其他候选。该后台路径在 lite.3 关闭，不能把主聊天选择的模型当成全部调用来源。

检查本机 WSL 配置与可解析 daemon 日志：未找到可确认的重复自动命名调用记录；没有调度任务，语音和插件关闭，AW 已退役。这不等于所有历史或公司主机都没有额外调用；未取得公司侧完整模型用量与账单，不能量化节省比例。

主机追加角色指令约 1518 字符，属于模型输入的一部分，不能等同于 1518 token。遵循用户要求保留正式 Paseo 角色/复核逻辑，不削掉小巴小保的独立轮或交叉轮。过程折叠只影响显示；读取状态、Git 刷新与 Relay 心跳本身不是模型调用。手动提交/PR 文案生成及用户授权的多 agent 复核仍会消耗 token。

验证：全工作区类型检查、修改文件 lint、Electron/Expo/server 构建通过；菜单 10、窗口 14、自动命名 2 项测试通过。Windows 隔离配置验证常用/高级展开、窗口控制、daemon 启动通过，无页面异常；测试进程已清理，未安装到家里 Windows。

交付：`.artifacts/windows/release/Paseo-Lite-0.8.0-lite.3-x64.zip`（188204217 字节），ZIP CRC 通过，SHA256 `07936fd68ee3c806a7a37bf9ec2a77828cb0a978b9ddfc3a6dd1d706a00a50e6`。应用归档已确认版本 lite.3、thickFrame 关闭及自动命名关闭。实机截图位于 `.artifacts/windows/lite3-settings-common.png` 和 `lite3-settings-advanced.png`。

WSL 新运行目录 `/home/syat/.local/share/paseo-lite/0.8.0-lite.3` 已安装，CLI 启动与自动命名关闭代码已核验；正式 6767 服务仍运行 lite.2，尚未切换/重启，待用户确认。配置、角色、Relay 配对数据未变动。自动命名关闭仅在新版 daemon 中生效，公司本地使用新客户端内置 daemon 即生效，家里 WSL 须待切换。

## 会话体验优化（2026-09-16，lite.2）

- **完成后折叠整轮过程**：定制客户端在回答结束后收起本轮中间说明、思考、工具调用与任务清单，保留用户消息、最终回答的全部 Markdown 块和通知。点击“展开本轮过程”可以恢复查看。进行中的当前轮保持展开；只修改展示，不删除历史或改变协议。虚拟列表的行修订会跟随折叠状态更新。
- **Codex 原生会话改名**：Provider 增加可选的 `renameNativeSession` 能力，Codex 使用 `thread/name/set` 写入原生标题。运行中与已关闭的持久化会话均可改名，后者不会为改名创建交互会话。先完成原生改名再保存 Paseo 标题，失败向调用方报错。其他 Provider 的命名行为不变；这不是所有 Provider 的双向实时标题监听。
- **Claude 浅色主题**：保留 `claude` 设置选项，改为暖白底、深色正文和陶土橙强调色；侧栏、代码语法色、终端及阴影同时采用浅色语义。

验证：4 个定向测试文件共 363 个测试通过；服务端依赖链构建、所有工作区类型检查、变更文件 lint 与 Electron 平台 UI 导出通过。隔离原生 Codex 会话改名成功，关闭 app-server 后重新启动读取仍得到新名字。浅色设置页浏览器冒烟无页面异常，截图为 `.artifacts/windows/claude-light-settings.png`。

Windows 交付版本为 `0.8.0-lite.2`，路径 `.artifacts/windows/release/`。 已验证本机 Windows 安装，安装器退出码为 0，注册表版本核验为 `0.8.0-lite.2`；用户随后决定卸载家里 Windows 客户端，公司使用同版本 ZIP，完整解压后运行 `Paseo.exe`。ZIP 免安装，但配置与会话仍存储在用户目录，不是随 ZIP 搬迁的数据便携模式。用户随后授权切换，WSL daemon 与 `paseo-lite` / `paseo` 入口已运行 `~/.local/share/paseo-lite/0.8.0-lite.2`。继续沿用完整版的 `~/.paseo`，15 个 Provider 配置、7 个角色预设、31 条历史会话及项目、Relay 身份保持不变；迁移前备份及文件摘要保存在 `~/.local/share/paseo-migrations/20260916-143444/`。AW 活动入口及历史任务已归档，两套罗盘改用 Paseo 同会话交叉复核，接线规则由 PQSelector 的 `docs/PASEO_WORKFLOW.md` 维护。原版手机 UI 不因服务端更新而改变折叠或主题行为。

## 第四批实施与交付（2026-09-16）

按五步推进，当前先交付 Windows 包，随后通过 Relay 验收公司与手机。

1. **空闲集成审计已完成（家里 WSL）**：`~/.paseo/schedules` 为空，无 `hub-relationship.json`；无 Hub 关系时控制器不建立连接。插件配置由轻量模板关闭。不删除历史任务、关系或模型。调度服务改为仅有 active 且有 nextRunAt 的任务时保留计时器；创建/恢复重新启用，暂停/删除最后任务后停用。
2. **桌面生命周期已落实**：定制桌面只保留一个窗口，并发打开复用窗口；菜单改为 Show Window，移除前端新窗口入口。保留主窗口、文件/终端/审批及通知。默认关闭 UI 后 daemon 继续运行；已有显式关闭后台设置仍保留，移除上游强制重置退出行为的迁移。Windows 实际关闭 UI 后确认 runner 和 worker 仍存活。
3. **定制打包**：`npm run build:desktop:lite` 仅构建 daemon/CLI、桌面 UI 和 Windows x64 NSIS/ZIP，不发布网站或手机端。版本 `0.8.0-lite.1`，独立桌面名称 Paseo Lite，禁止查询/安装上游桌面更新。首次启动合并 `config/lightweight.json`，备份旧配置，保留 Relay 地址、自定义 ACP、Cursor 命令及其他字段；写入一次性标记，后续启动不覆盖用户设置。桌面身份独立，但本地主机仍使用 `~/.paseo`，不会与原版另起一个竞争的主机。
4. **联调进行中**：Windows 隔离目录实际启动 UI 与托管 daemon 成功，确认首次配置合并、原配置备份、语音/浏览器工具/插件关闭且 Relay 保留。WSL 已从本地 tarball 安装到 `~/.local/share/paseo-lite/0.8.0-lite.1`，合并配置并启动 6767 daemon；31 条历史 agent 记录保留且按需初始化。命令入口为 `~/.local/bin/paseo-lite`。Windows 包内客户端经公网 Relay 成功读取 WSL 状态，连接及查询约 2976 ms。Claude/Codex/OpenCode 和已有自定义 Provider 可用，Cursor 适配器保留但本机未检测到命令。公司网络、原版手机及聊天/审批/重连/通知仍需实际配对验收。
5. **性能初测**：Windows 桌面+本地 daemon 空工作区，8 个进程，10 秒空闲采样：合计工作集 1087.7 MiB、私有内存 777.3 MiB、CPU 约单核的 0.47%。工作集相加包含共享页，不能当作独占物理内存。尚无相同工作负载的原版对照，不能据此声称节省比例；单 agent、长对话、终端、多工作区与冷/暖启动对照仍待完成。

本批定向测试：调度 60 个、桌面窗口/设置/更新 32 个，共 92 个测试；未跑全量测试。服务端依赖链构建、桌面构建、所有工作区类型检查与 Electron UI 导出通过。后续桌面设置改动另做定向复查。

### 交付物与剩余验收

- Windows x64：`.artifacts/windows/release/Paseo-Lite-0.8.0-lite.1-x64.exe`（约 135 MiB）及同名 ZIP（约 180 MiB），校验值在同目录 `SHA256SUMS.txt`。ZIP 需完整解压后运行 `Paseo.exe`。本地定制包未配置代码签名证书。
- daemon/CLI 及内部依赖共 7 个 tarball：`.artifacts/wsl/`。均为本地构建，无 npm/GitHub 发布。
- Windows 图标已从实际 EXE 与安装器提取核验；测试桌面和测试 daemon 已清理，正式 WSL daemon 保持运行。
- 原版 CLI 的 `daemon status` 将连接与查询分别限制为 1500 ms，公网 Relay 握手可能因此误报不可达。本轮用包内客户端默认 15 秒连接预算验证成功，没有修改协议或绕过认证；该 CLI 探测期限仍待调整。
- 未完成项：公司与原版手机真实会话验收，以及同负载原版/定制版的完整性能对照。当前空闲采样不能替代这些验收。

### Windows 图标

Windows 专用图标为炭黑圆角底、浅色 P 与绿色终端符号；原版手机图标不变。
源图 `packages/desktop/assets/icon-windows.png`，多尺寸 ICO 为 `icon-windows.ico`，包含 16/24/32/48/64/128/256 像素层，供 EXE、窗口、NSIS 安装与卸载图标共用。
使用内置 imagegen 生成，提示词为：

> Create one production Windows desktop application icon for a custom lightweight Paseo app, a remote coding-agent controller. Square 1024x1024 icon asset, actual transparent outside a dark charcoal rounded square tile, tile fills 94% canvas. Center a single bold geometrical ivory P monogram with an open negative-space path and one restrained mint-green terminal cursor accent. Beautiful precise optical balance, extremely simple silhouette and thick strokes recognizable at 16 pixels. Flat vector-like crisp edges, no perspective, no mockup, no text other than the abstract P shape, no glow, no shadows outside tile, no decorative circuitry, no fine detail. Premium understated developer-tool identity.

Windows 的跨平台构建先生成目录，再用 Windows rcedit 写入 ICO 与版本资源，再从该目录封装安装包；没有把缺少 Wine 的中间产物当成完成交付。

## 第三批实施（2026-09-16）

本批完成 Git/PR 查询的面板可见性控制和空闲监听维护精简。

- 隐藏的保留面板不再因缓存失效而发起 Git 状态、PR 状态、PR 提示或活动列表请求；已开始的请求允许完成。重新显示时读取最新状态，仍保留缓存供立即渲染，不增加轮询。
- diff 的 Git 状态查询遵守调用方的 enabled 设置。既有 diff、提交和文件查询已有保留面板门控，继续保留。
- 健康的工作区监听不再运行周期性初始化检查。只有初始化未完成或失败时才安排延迟重试，恢复或释放最后订阅后停止；底层监听器故障的降级轮询和恢复仍保留。
- 定制 daemon 关闭仓库监听启动时及周期性的自动 `git fetch`。本地分支和工作区元数据监听继续工作；远端引用需用户执行 fetch/pull 才更新，UI 刷新不等同于拉取远端。

验证使用独立源码镜像，没有应用正式主机配置或重启 daemon。

| 检查                         | 结果                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| Git/监听回归                 | 63 个测试通过，覆盖健康空闲十分钟无维护计时器、失败后恢复、退订取消重试 |
| 前端 Git/PR 查询             | 13 个测试通过，覆盖隐藏时失效不请求、重新显示后刷新、共享查询去重       |
| 变更文件 lint                | 0 错误、0 警告                                                          |
| 服务端构建和全工作区类型检查 | 通过                                                                    |

桌面 UI 的 Electron 平台导出通过。

本批共 2 个定向测试文件、76 个测试，没有运行全量测试。上述计时器结果针对测试中的健康 Git 观察服务，不表示整个 daemon 没有计时器或 CPU 开销。

剩余工作：核验 Hub/调度使用情况、多窗口和辅助面板候选裁剪、定制打包与两台主机配置部署，以及真实 Windows 性能与原版手机 Relay 联调。未使用集成的模板关闭项仍需部署后验证实际无后台资源。

## 第二批实施（2026-09-16）

本批完成侧栏与文件/diff 的监听需求拆分，手机协议和客户端安装包不变。

- 侧栏工作区订阅只保留仓库元数据监听，继续接收分支与身份变化；不再因此递归扫描、监听整个项目代码目录。
- diff 与独立文件订阅按需获得递归监听。最后一个使用者退出时释放；仍有文件订阅时关闭 diff 不会误释放其资源。有文件监听时，其变更仍更新对应工作区 Git 状态，侧栏不为此持有监听。
- 面板关闭时尚未完成的监听初始化，在完成后会检查需求并释放，不留下孤立监听。
- 重新打开 diff 强制读取新内容，覆盖无监听期间的文件修改。现有手动刷新继续保留。
- 前端已有隐藏 diff 面板退订机制，本批修复服务端被侧栏引用持续占用的问题。实现边界见 [文件监听](file-observation.md)。

侧栏脏文件统计允许暂时缓存；元数据变化、已有执行事件及显式刷新仍可更新。
本批没有停止后台 agent，也没有按客户端连接数停用执行服务。

验证环境沿用 `/tmp/paseo-trim-validation`，Node 22：

| 检查                               | 结果                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Git 与监听生命周期                 | 60 个测试通过，覆盖按需启动/关闭、重新打开、独立文件订阅、延迟初始化释放和状态刷新 |
| 会话工作区观察器                   | 19 个测试通过，确认采用元数据订阅并保留分支通知及多工作区关系                      |
| diff 管理器                        | 13 个测试通过，重新打开会要求最新内容                                              |
| 服务端依赖链构建、全工作区类型检查 | 通过；最后服务端改动另行复查                                                       |
| 变更文件 lint                      | 0 错误、0 警告                                                                     |

本批共 3 个定向测试文件、92 个测试，没有运行全量测试。测试验证无文件/diff 需求时递归监听目标为 0；仓库元数据监听仍保留。
没有实测 Windows 内存收益或完成原版手机 Relay 联调。
隐藏 Git/PR 查询和空闲维护已在第三批处理；Hub/调度使用情况尚待核验，不删除已有任务或关系。

## 首批实施（2026-09-16）

- 语音默认关闭；所有语音能力禁用时，运行时直接进入 disabled 就绪状态，不初始化本地服务、不下载模型、不建立恢复计时器。显式启用的旧配置仍生效，需要合并下面的配置。
- 定制 Web/Electron 不挂载 VoiceProvider，隐藏语音与听写入口。原版手机继续使用现有安装包，通过 daemon 的能力状态禁用语音。
- Electron 禁用 webview，移除浏览器 preload 桥接与新建入口。旧浏览器标签显示保存的链接，允许外部打开，不恢复 guest 或 favicon 请求。桌面窗口、通知及 daemon 管理桥接保留。
- 开发服务探活按路由订阅启动和停止：零目标时没有探活轮询；添加目标恢复，删除最后目标停止。
- daemon 不再保留定时 PR/CI 状态轮询；显式刷新和事件触发的 Git 更新保留。侧栏递归监听的后续拆分见第二批实施。
- Copilot、Pi、OMP 默认禁用，保留适配器与协议。自定义 ACP 不受内置默认值限制；Cursor 使用已有 ACP 适配器。

### 两台主机配置

[config/lightweight.json](../config/lightweight.json) 是待合并配置模板，不是自动加载文件。
新建隔离主机可将其用作配置；已有主机将对应字段合并到各自 `$PASEO_HOME/config.json`，
保留原有连接、凭据、环境变量和自定义 Provider，不能用模板整体覆盖旧文件。
Cursor 模板命令为 `cursor-agent acp`，需要主机已安装支持 ACP 的 Cursor CLI；可按实际安装路径调整 command。
环境变量优先于文件配置，尤其检查 `PASEO_DICTATION_ENABLED` 和 `PASEO_VOICE_MODE_ENABLED` 没有重新启用语音。

模板保留 Relay，关闭 browserTools、插件、合并后自动归档与可选公开服务代理。
本地工作区服务路由仍保留；公开代理关闭不等于删除本地路由。
已有 Hub 关系、调度与 heartbeat 数据本轮不修改。
本轮没有覆盖正式主机配置或重启 6767 daemon；须安装新构建并应用配置后才在家里与公司生效。

### 验证

验证环境为独立的 `/tmp/paseo-trim-validation` 源码镜像，Node 22；没有启动正式 daemon。

| 检查                                        | 结果                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| 语音配置与全禁用运行时                      | 9 个测试通过；禁用时无初始化、下载或监控计时器            |
| 服务探活                                    | 9 个测试通过；无路由空闲一分钟不轮询，增删路由控制计时器  |
| Git 刷新                                    | 56 个测试通过；不保留 PR/CI 轮询，显式刷新仍执行 Git 读取 |
| Provider 注册                               | 50 个测试通过；保留指定默认值与通用/Cursor ACP            |
| Electron preload                            | 2 个测试通过；无浏览器桥接，保留窗口、通知及 invoke       |
| 服务端依赖链、App 依赖、Electron 主进程构建 | 通过                                                      |
| 所有工作区类型检查                          | 通过；最后的 App/Server 改动已复查                        |
| lint                                        | 全仓检查发现的两处问题已修复，变更文件复查通过            |

共 6 个定向测试文件、126 个测试；没有运行全量测试套件。

`PASEO_WEB_PLATFORM=electron expo export --platform web --max-workers 2` 通过。
使用 Chromium 加载该导出产物，欢迎页和设置页均正常渲染，页面运行异常为 0，webview 数为 0。
这是独立页面冒烟检查，不代表已验证 Windows 安装包、真实会话或原版手机。
本地截图：`/tmp/paseo-trim-ui-smoke.png`、`/tmp/paseo-trim-ui-settings.png`。
本轮尚未得到真实 Windows 资源收益或原版手机 Relay 联调结果，不将理论收益作为实测。
