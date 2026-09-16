# Codex 上下文排查（2026-09-16）

## 证据范围

只读扫描本机 Paseo 保存的 native session ID，并关联 WSL Codex rollout；匹配到 11 个已归档的 Paseo Codex 会话。没有拿到用户指认的当前问题会话，以下是已确认的历史样本，不是同任务 A/B 性能结论。文档只记录统计，不保存会话正文、凭据或配置密钥。

- 关联样本使用 gpt-6-astra，首个已记录请求的输入为 16993–18096 token，上下文上限均为 258400。抽查同机 Codex Desktop rollout 也报告 258400；不能据此认为 Paseo 缩小了模型窗口。
- 11 个样本中有 3 个记录到压缩，共 4 次。一个样本在 210 次用量事件中压缩 2 次，工具输出 JSONL 累计约 1115107 字符；另一个 143 次事件、1 次压缩，工具输出约 1041678 字符。事件不是用户轮次，JSONL 字符也不是 token 或实际保留上下文。
- 检查长回包发现多文件整篇读取、重复读取工作流/AGENTS、长 JSON 与日志；单个序列化回包可超过 60000 字符。这是可优化的上下文增长来源，不能证明它是所有用户会话的唯一原因。
- Codex Desktop 的长任务也有压缩记录；现有样本不是同模型、同任务、同工具结果的严格 A/B，不能断言某客户端永不压缩。
- Paseo 的 Codex adapter 按 thread ID 恢复原生历史；turn/start 只构造本次新增输入，没有将 UI timeline 整份重新作为用户输入发送。新回归测试验证一次提交只发送一次新增输入。

## Lite.4 改动

- 仅在 Paseo Codex adapter 的会话配置中默认设置 `tool_output_token_limit: 4000`；创建、恢复与后续请求使用同一配置生成逻辑。未改用户全局 Codex 配置、模型窗口或压缩阈值。显式 customCodexConfig 仍可覆盖该默认值。
- 增加简短上下文使用约束：搜索定位后读取相关范围、一般先以约 2000 输出 token 读取、避免重复读取未变文档、对被截断的重要证据继续定向读取；保留角色职责及独立/交叉复核。
- 不删历史，不降低思考级别，不关闭自动压缩，不改正式小巴小保流程。
- 官方配置参考明确 `tool_output_token_limit` 控制单个工具结果存入历史的 token 预算：https://learn.chatgpt.com/docs/config-file/config-reference 。具体模型/tool 实现的实际截断与收益还需在更新后的问题会话观察，不能用原始 rollout 文件大小反推节省比例。

## 生效与验证

旧会话已有的大量上下文不会即时缩小；新预算主要限制后续输出。WSL 必须切换新版 daemon 并重新加载对应 provider 会话。手机仍使用原版 App，远端行为由 daemon 决定。

客户端同时增加 Alt+Enter 光标处换行，优先于补全选择和发送处理；IME 组合输入仍先交给输入法。保留 Shift+Enter 兼容，Enter 与 Ctrl/Command+Enter 行为不变。

验证结果和交付路径记录于 customization-plan.md。
