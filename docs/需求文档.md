# OurCode IDE 需求文档（Requirements Specification）

> 版本：1.0（草案）
> 日期：2026-08-10
> 状态：评审中
> 适用项目：`OurCode-ide/`

---

## 1. 项目概述

### 1.1 产品定义

OurCode IDE 是一款 **AI 驱动的桌面代码编辑器**，基于 Electron 构建。它将 AI 助手深度集成进编码工作流：用户可与助手对话，让它读取/编辑工作区文件、在集成终端中执行命令、通过人工确认机制（human-in-the-loop）全程掌控工具调用，也可将独立子任务委派给专门的子智能体（Subagent）自主完成。

### 1.2 产品定位

- **竞品对标**：VS Code + Copilot / Cursor / Windsurf / Claude Code 类工具
- **差异化优势**：
  1. 可**编辑的对话历史**（修改、删除、拖拽排序、任意点重新生成、分支对比）
  2. **8 类 LLM 提供商** + 多 API 分组 + 任意 OpenAI 兼容接口
  3. 四种 Agent 模式与细粒度工具权限控制
  4. 本地优先存储（SQLite），数据不出本机
  5. 沙箱化插件系统、技能（Skills）发现机制、MCP 服务器接入

### 1.3 目标用户

| 用户群 | 描述 | 核心诉求 |
| --- | --- | --- |
| 个人开发者 | 日常编码、重构、Debug | 减少重复劳动，AI 补全与对话辅助 |
| AI 工具重度用户 | 使用多模型对比回答 | 多提供商自由切换、Arena 对比 |
| 团队 / 企业用户 | 内部网关、私有模型 | 内网 Base URL、跳过证书校验、自定义请求头 |
| 安全敏感用户 | 处理敏感代码 | 本地存储、主密码加密、写操作确认 |

---

## 2. 功能需求（FR）

### 2.1 模块总览

```
OurCode IDE
├── 2.2 AI 助手与对话
├── 2.3 多提供商 LLM 支持
├── 2.4 智能体工具与自主工作流
├── 2.5 代码编辑器与工作区
├── 2.6 集成终端与 Git
├── 2.7 搜索与替换
├── 2.8 扩展与定制（插件 / 技能 / MCP / 快捷键 / 主题 / 国际化）
├── 2.9 安全与隐私
└── 2.10 其他（用量统计 / 自动更新 / 崩溃恢复）
```

---

### 2.2 AI 助手与对话

#### FR-2.2.1 流式聊天
- **FR-2.2.1.1** 助手回复必须逐字流式输出（streaming），而非一次性渲染。
- **FR-2.2.1.2** 思考块（Thinking）实时渲染，与正文区分展示。
- **FR-2.2.1.3** Markdown 内容渲染前必须经 DOMPurify 消毒（防 XSS）。
- **FR-2.2.1.4** 每条消息显示 token 用量、创建时间、上下文文件（contextFiles）。

#### FR-2.2.2 可编辑对话历史
- **FR-2.2.2.1** 可修改、删除任意历史消息（历史编辑模式开关，默认关闭防误触）。
- **FR-2.2.2.2** 支持从任意一条消息**重新生成**。
- **FR-2.2.2.3** 支持拖拽排序与批量删除（历史编辑模式下）。
- **FR-2.2.2.4** 编辑后消息需重新计算 tokenCount 与关联工具调用一致性。

#### FR-2.2.3 分支与对比
- **FR-2.2.3.1** 可从任意消息分叉出对话分支（ChatBranch），树形视图切换。
- **FR-2.2.3.2** 主分支 + 多子分支管理，分支可命名。
- **FR-2.2.3.3** Arena（竞技场）模式：多模型并行回答同一提示词，可一键采纳最佳结果。

#### FR-2.2.4 长期记忆
- **FR-2.2.4.1** 助手可保存（`remember` 工具）并检索项目记忆（Memory，`global` / `project` 两种作用域）。
- **FR-2.2.4.2** `aiAutoMemory` 开关控制助手是否可自动写入记忆（默认开启）。
- **FR-2.2.4.3** 记忆注入系统提示词，可在设置中管理与删除。

#### FR-2.2.5 可复用工作流
- **FR-2.2.5.1** 可将常用提示词保存为工作流模板（Workflow），一键发起重复性任务。

#### FR-2.2.6 会话管理
- **FR-2.2.6.1** 支持多会话（ChatSession）创建、切换、删除。
- **FR-2.2.6.2** 会话支持置顶（pinnedAt）与归档（archivedAt）。
- **FR-2.2.6.3** 会话记录创建时所属的项目路径（projectPath）。

#### FR-2.2.7 错误处理
- **FR-2.2.7.1** LLM 错误需结构化呈现（ChatError）：`auth` / `timeout` / `network` / `rate_limit` / `server` / `unknown` 类型，展示友好文案 + 可折叠的原始错误详情。

---

### 2.3 多提供商 LLM 支持

#### FR-2.3.1 提供商支持（8 类）

| 提供商 | provider 标识 | 说明 |
| --- | --- | --- |
| OpenAI | `openai` | 官方 API |
| Anthropic | `anthropic` | Claude 系列 |
| Google Gemini | `gemini` | Gemini 系列 |
| DeepSeek | `deepseek` | DeepSeek API |
| Groq | `groq` | Groq 云端推理 |
| Azure OpenAI | `azure` | Azure 托管 |
| Ollama | `ollama` | 本地模型 |
| 自定义 | `custom` / 任意 | OpenAI 兼容接口 |

#### FR-2.3.2 API 配置分组（ApiConfigGroup）
- **FR-2.3.2.1** 每组独立配置：名称、Base URL、API Key、系统提示词、默认模型、自定义请求头、颜色标签、排序优先级。
- **FR-2.3.2.2** 传输格式覆盖（apiFormat）：`auto` / `openai` / `responses` / `anthropic` / `gemini` / `ollama` / `azure`。
- **FR-2.3.2.3** 支持 `skipTlsVerify`：内网自签名 / 私有 CA 证书可跳过校验。
- **FR-2.3.2.4** Base URL 同时支持 `http://` 与 `https://`（内网可用 http）。
- **FR-2.3.2.5** 所有 API 请求由**主进程代理**发出，规避浏览器 CORS 限制。

#### FR-2.3.3 模型参数（ModelParams）
- **FR-2.3.3.1** 可配置：temperature、maxTokens（0 表示不限）、topP、frequencyPenalty、presencePenalty。
- **FR-2.3.3.2** 深度思考（reasoning）开关 + effort 级别（low / medium / high）。

#### FR-2.3.4 模型管理
- **FR-2.3.4.1** 引导式 Onboarding、分步连接测试。
- **FR-2.3.4.2** 自动拉取模型列表；支持自定义模型（CustomModel：上下文窗口、视觉、函数调用能力标注）。
- **FR-2.3.4.3** 内置模型元数据表（MODEL_METADATA），未知模型按前缀匹配。
- **FR-2.3.4.4** 配置导入 / 导出（可选加密）。

#### FR-2.3.5 模型行为优化
- **FR-2.3.5.1** LLM 响应缓存（`llmResponseCache`，默认开）：仅缓存确定性请求（temperature=0），命中时返回缓存并上报节省的 token。
- **FR-2.3.5.2** Anthropic prompt-caching（`anthropicPromptCache`，默认开）：注入 cache_control 断点。

---

### 2.4 智能体工具与自主工作流

#### FR-2.4.1 智能体工具集（Agent Tools）

| 工具 | 作用 | 读写性 |
| --- | --- | --- |
| `read_file` | 读取文件 | 只读 |
| `write_file` | 创建/覆写文件 | **写** |
| `edit_file` | 编辑文件 | **写** |
| `delete_file` | 删除文件 | **写** |
| `create_directory` | 创建目录 | **写** |
| `list_directory` | 列目录 | 只读 |
| `get_directory_tree` | 目录树 | 只读 |
| `search_files` | 按名称/内容搜索 | 只读 |
| `search_in_files` | 工作区全文搜索 | 只读 |
| `run_command` | 执行 shell 命令 | **执行** |
| `read_url` | 读取 URL | 网络 |
| `web_search` | 联网搜索 | 网络 |
| `ask_user_question` | 向用户提问 | 交互 |
| `manage_todo` | 维护任务清单 | 交互 |
| `submit_plan` | 提交实施计划 | 交互 |
| `run_subagent` | 委派子智能体 | 委派 |
| `list_agents` | 列出可用子智能体 | 只读 |
| `send_message` | 跨会话消息 | 交互 |
| `remember` | 写入长期记忆 | **写**（受 aiAutoMemory 控制） |

#### FR-2.4.2 权限与审批
- **FR-2.4.2.1** **写操作始终需要用户显式批准**；只读操作立即执行。
- **FR-2.4.2.2** 支持一键批量审批。
- **FR-2.4.2.3** 每个项目路径支持"始终允许该工具"白名单（TOOL_ALLOWLIST，localStorage）。

#### FR-2.4.3 四种 Agent 模式（projectEditMode）
| 模式 | 行为 |
| --- | --- |
| `confirm_before_change` | 每个文件修改工具前都询问（默认） |
| `auto_edit` | 自动批准文件编辑 |
| `plan` | 只读 → 提交计划 → 批准 → 执行 |
| `full_access` | 自动批准所有工具调用 |

#### FR-2.4.4 计划模式与任务清单
- **FR-2.4.4.1** Agent 可先提出实施计划（planContent + planStatus：`none`/`pending_approval`/`approved`/`canceled`），经批准后执行。
- **FR-2.4.4.2** 维护任务清单（TodoItem：`pending`/`in_progress`/`completed`/`failed`）。
- **FR-2.4.4.3** 任务中途可向用户提出澄清问题（UserQuestion，含选项）。

#### FR-2.4.5 Agent 运行记录
- **FR-2.4.5.1** 每次 Agent 运行持久化记录（AgentRun）：任务、状态（8 态：running / creating_plan / waiting_plan / approved_running / done / stopped / error / rejected）、计划、工具调用次数、文件变更数、步骤数、token 用量。
- **FR-2.4.5.2** 实时执行轨迹（AgentTraceEntry）：工具调用名称、分类图标（think/search/edit/execute/fetch/switch_mode/ask/other）、状态（running/success/error/rejected）。
- **FR-2.4.5.3** 工具调用轮数预算用尽时显示"继续"按钮继续执行（EXHAUSTED_MARKER）。

#### FR-2.4.6 Checkpoint 回滚
- **FR-2.4.6.1** 每个写工具执行前对涉及文件拍摄快照（Checkpoint），用户可回滚 AI 的编辑（Windsurf 风格）。

#### FR-2.4.7 子智能体（Subagent）
- **FR-2.4.7.1** 内置三类：`code-reviewer`（代码审查）、`test-generator`（测试生成）、`researcher`（检索）。
- **FR-2.4.7.2** 支持用户通过 `.ourcode/agents/*.md` 自定义子智能体。
- **FR-2.4.7.3** 子智能体以**权限单调递减**、迭代 / Token 预算、checkpoint 回滚方式执行。

#### FR-2.4.8 目标模式（Target Mode）
- **FR-2.4.8.1** Agent 模式下可开启目标模式：自动批准工具调用、轮数用尽后自动继续，直到用户判定目标完成并停止。

#### FR-2.4.9 跨会话协作
- **FR-2.4.9.1** `send_message` 支持跨会话消息，入站策略（`crossSessionInbound`）三档：`accept`（自动触发接收会话 Agent 循环）/ `hold`（仅入历史不处理）/ `refuse`（拒绝）。

#### FR-2.4.10 技能系统（Skills）
- **FR-2.4.10.1** 类 Claude Code 的 `SKILL.md` 发现机制：工作区 / 用户目录中的技能作为只读工具按需加载。
- **FR-2.4.10.2** 可从技能注册表一键安装技能。

#### FR-2.4.11 MCP 支持
- **FR-2.4.11.1** 通过 stdio 或 HTTP（streamable）连接 MCP 服务器。
- **FR-2.4.11.2** 接入外部工具、资源与提示词。
- **FR-2.4.11.3** 支持断线自动重连；连接测试（`mcp_config.example.json` 提供示例配置）。

#### FR-2.4.12 浏览器 UI 自测
- **FR-2.4.12.1** 接入 Playwright MCP 后，助手可打开真实浏览器对客户 Web 项目自动点击 / 输入并逐项验证（`ui-self-test` 技能），详见 `docs/BROWSER_SELF_TEST.md`。

---

### 2.5 代码编辑器与工作区

#### FR-2.5.1 编辑器基础（Monaco）
- **FR-2.5.1.1** 多标签编辑、Diff 视图、面包屑、Snippet、minimap。
- **FR-2.5.1.2** AI 行内补全（ghost text，`Tab` 接受）。
- **FR-2.5.1.3** 语法高亮按 60+ 扩展名映射（LANGUAGE_MAP），支持 TS/JS/Python/Go/Rust/C/C++/Java/C#/PHP/Web 等主流语言。

#### FR-2.5.2 大文件友好
- **FR-2.5.2.1** 大文件分块流式加载（FileStreamStart/Chunk，pull 模式），显示加载进度。
- **FR-2.5.2.2** 自动编码检测（chardet + iconv-lite）。
- **FR-2.5.2.3** 写入保留原编码与 BOM。
- **FR-2.5.2.4** 超大文件降级：纯文本模式 / 只读预览模式。

#### FR-2.5.3 文件工作区
- **FR-2.5.3.1** 文件浏览器（文件树 + 目录树），显示 Git 状态徽标（modified/added/deleted/renamed）。
- **FR-2.5.3.2** 快速打开（`Ctrl+P`）。
- **FR-2.5.3.3** 命令面板（`Ctrl+Shift+P`），类 VS Code。
- **FR-2.5.3.4** 最近文件列表。
- **FR-2.5.3.5** 文件变更面板（FileChangesPanel）。
- **FR-2.5.3.6** 多项目列表（ProjectListPanel）。

#### FR-2.5.4 保存与恢复
- **FR-2.5.4.1** 自动保存（autoSave 开关 + 间隔）。
- **FR-2.5.4.2** 热退出（hot-exit）备份：未保存的脏缓冲由主进程镜像，意外退出后自动恢复。

#### FR-2.5.5 LSP 诊断
- **FR-2.5.5.1** 按语言启用 LSP 服务器（如 Python 的 `pylsp`），诊断实时汇入 Problems 面板。
- **FR-2.5.5.2** LSP 服务器命令可配置（`lspServers`）。

#### FR-2.5.6 调试支持
- **FR-2.5.6.1** Debug 面板（DebugPanel），支持调试适配器协议（见 e2e fixture mock-debug-adapter）。

---

### 2.6 集成终端与 Git

#### FR-2.6.1 集成终端
- **FR-2.6.1.1** 基于 xterm.js + node-pty 的完整终端。
- **FR-2.6.1.2** 多标签、重命名、左右分屏。
- **FR-2.6.1.3** 深浅色 ANSI 配色。

#### FR-2.6.2 Git 面板
- **FR-2.6.2.1** 状态、Diff、暂存 / 取消暂存、提交、Push / Pull、日志。
- **FR-2.6.2.2** **AI 生成提交信息**。
- **FR-2.6.2.3** **Lifeguard 提交前预检**：AI 审查改动并分级（error / warning / info）提示潜在问题。

---

### 2.7 搜索与替换

#### FR-2.7.1 工作区全文搜索
- **FR-2.7.1.1** 大小写 / 全字 / 正则开关。
- **FR-2.7.1.2** 包含 / 排除文件模式（如 `*.ts,*.tsx` / `node_modules,.git,dist`）。
- **FR-2.7.1.3** 结果行高亮（matchStart/matchEnd）、点击跳转。
- **FR-2.7.1.4** 支持批量替换。

---

### 2.8 扩展与定制

#### FR-2.8.1 沙箱化插件系统
- **FR-2.8.1.1** 插件在 Web Worker 沙箱中运行。
- **FR-2.8.1.2** 清单文件（manifest）声明能力与显式权限。
- **FR-2.8.1.3** 可用权限（11 项）：`editor.read` / `editor.write` / `file.read` / `file.write` / `ai.chat` / `ai.completion` / `ui.panel` / `ui.statusbar` / `terminal.read` / `terminal.write` / `network`。
- **FR-2.8.1.4** 扩展点：命令（并入统一命令注册表）、快捷键、自定义面板、状态栏项。
- **FR-2.8.1.5** 内置插件安装 / 管理界面（PluginMarketplace）。
- **FR-2.8.1.6** 提供 CLI 脚手架 `create-nebula-plugin`。

#### FR-2.8.2 快捷键
- **FR-2.8.2.1** 预设：VS Code、JetBrains，或完全自定义键位。

#### FR-2.8.3 主题
- **FR-2.8.3.1** 深色 / 浅色 / 跟随系统，支持自定义强调色。

#### FR-2.8.4 国际化
- **FR-2.8.4.1** 中文（zh-CN）与英文（en-US）。
- **FR-2.8.4.2** `system` 模式跟随 OS 语言（zh-* → zh-CN，否则 en-US）。

#### FR-2.8.5 自定义 AI 命令
- **FR-2.8.5.1** 用户可创建自定义 AI 命令（名称 + 提示词 + 图标 + 快捷键）。

---

### 2.9 安全与隐私

| 编号 | 需求 |
| --- | --- |
| FR-2.9.1 | 文件系统访问受**显式白名单**限制（仅限用户打开过的文件夹） |
| FR-2.9.2 | 渲染进程使用严格的 Content-Security-Policy |
| FR-2.9.3 | API Key 使用 **AES-256-GCM 加密**，密钥与机器绑定（node-machine-id） |
| FR-2.9.4 | 可选**主密码**加密聊天数据的静态安全 |
| FR-2.9.5 | 聊天 Markdown 渲染前经 DOMPurify 消毒 |
| FR-2.9.6 | 本地优先存储（SQLite），数据不出本机（除用户主动配置的 API 调用） |
| FR-2.9.7 | 所有 `fs:*` IPC 处理器校验路径属于白名单目录（路径穿越防护） |

---

### 2.10 其他功能

#### FR-2.10.1 用量统计
- **FR-2.10.1.1** 四级分类（UsageEventCategory）：`llm` / `skill` / `subagent` / `mcp`。
- **FR-2.10.1.2** 仪表盘：总览（请求数 / token 入 / token 出 / 错误数）、日趋势、按模型 / 技能 / 子智能体 / MCP 工具排行、最近事件。
- **FR-2.10.1.3** 支持清空统计。

#### FR-2.10.2 自动更新
- **FR-2.10.2.1** 基于 electron-updater 的应用内更新：检查、下载、安装、进度、状态事件。
- **FR-2.10.2.2** 发布渠道：GitHub Releases（owner `16fengzhiyong` / repo `OurCode`）。

#### FR-2.10.3 崩溃恢复
- **FR-2.10.3.1** 意外退出后自动恢复未保存缓冲区（RestoreBackupsModal）。

---

## 3. 非功能需求（NFR）

### 3.1 性能

| 编号 | 需求 | 指标 |
| --- | --- | --- |
| NFR-3.1.1 | 应用冷启动时间 | ≤ 5s（开发机基准） |
| NFR-3.1.2 | 大文件（>10MB）打开 | 分块流式加载，首屏渲染 ≤ 3s，不阻塞 UI |
| NFR-3.1.3 | 流式响应首 token 延迟 | 网络正常时 ≤ 3s |
| NFR-3.1.4 | 10 万行文件的编辑操作 | 交互无明显卡顿（Monaco 虚拟化渲染） |
| NFR-3.1.5 | 全文搜索 | 中等规模项目（<1 万文件）结果返回 ≤ 5s |

### 3.2 安全

| 编号 | 需求 |
| --- | --- |
| NFR-3.2.1 | 密钥材料（API Key、主密码派生密钥）不得以明文落盘 |
| NFR-3.2.2 | 渲染进程不得直接访问 Node API（严格 contextIsolation + 白名单 preload） |
| NFR-3.2.3 | 插件在沙箱内运行，越权调用必须被权限模型拦截 |

### 3.3 可用性

- **NFR-3.3.1** 首次启动提供 Onboarding 引导（配置 API → 连接测试 → 开始对话），全程 ≤ 5 分钟可跑通。
- **NFR-3.3.2** 关键操作（工具审批、Agent 模式切换、分支切换）有明确的 UI 状态反馈。
- **NFR-3.3.3** 双语 UI 文案完整率 100%（zh-CN / en-US 键一一对应）。

### 3.4 兼容性

| 平台 | 支持 | 打包目标 |
| --- | --- | --- |
| Windows x64 | ✅ | NSIS 安装包 + Portable 免安装 |
| macOS | ✅ | DMG + ZIP |
| Linux | ✅ | AppImage + deb |

### 3.5 可维护性与质量

- **NFR-3.5.1** TypeScript 严格类型检查通过（`npm run typecheck`）。
- **NFR-3.5.2** ESLint 无 error（`npm run lint`）。
- **NFR-3.5.3** 单元测试覆盖率目标 ≥ 70%（Vitest）。
- **NFR-3.5.4** 关键用户旅程有 Playwright E2E 测试。
- **NFR-3.5.5** 原生模块（better-sqlite3 / node-pty）提供 ABI 重建方案（`npx electron-builder install-app-deps`）。

---

## 4. 技术架构需求

### 4.1 架构分层

```
┌─────────────────────────────────────────────┐
│  渲染进程 Renderer（React + TS + Tailwind）   │
│  components / services / stores / hooks      │
├─────────────────────────────────────────────┤
│  Preload（contextBridge 白名单 API）          │
├─────────────────────────────────────────────┤
│  主进程 Main（Electron）                      │
│  services: file-system / sqlite-store /      │
│  crypto / backup / mcp-manager / lsp / debug │
├─────────────────────────────────────────────┤
│  共享层 shared/（IPC 通道常量 + 类型契约）      │
└─────────────────────────────────────────────┘
```

### 4.2 技术栈选型

| 层次 | 技术 | 用途 |
| --- | --- | --- |
| 桌面壳 | Electron 30 + electron-vite | 主进程 / 构建 |
| UI | React 18 + TypeScript 5.5 | 渲染进程 |
| 样式 | Tailwind CSS 3 | 界面样式 |
| 编辑器 | Monaco Editor 0.50 | 代码编辑 / Diff |
| 终端 | xterm.js + node-pty | 集成终端 |
| 存储 | better-sqlite3 11 | 本地持久化 |
| 状态 | Zustand 4 | 前端状态管理 |
| 安全 | crypto（AES-256-GCM）+ node-machine-id | 密钥加密 |
| 测试 | Vitest + Playwright（含 @playwright/mcp） | 单测 / E2E |
| 发布 | electron-builder + electron-updater | 打包 / 自动更新 |

### 4.3 IPC 接口需求（节选）

| 域 | 通道 | 说明 |
| --- | --- | --- |
| 文件系统 | `fs:readFile` / `fs:writeFile` / `fs:listDir` / `fs:watch` / `fs:authorize` / `fs:rename` / `fs:delete` / `fs:openStream` / `fs:readChunk` / `fs:writeChunk` / `fs:closeStream` 等 25+ 通道 | 白名单校验 |
| 存储 | `store:getConfigGroups` / `saveConfigGroup` / `getSessions` / `saveSession` / `getPreferences` / `savePreferences` | SQLite 读写 |
| 用量 | `usage:record` / `usage:summary` / `usage:clear` | 统计 |
| 缓存 | `llmCache:get` / `llmCache:put` / `llmCache:clear` | 响应缓存 |
| 加密 | `crypto:setMasterKey` / `crypto:unlock` / `crypto:isLocked` | 主密码 |
| 终端 | `term:create` / `term:write` / `term:resize` / `term:data` / `term:exit` / `term:dispose` | pty |
| 搜索 | `search:inFiles` | 全文搜索 |
| Git | `git:exec` | Git 命令 |
| Shell | `shell:exec` | 命令执行 |
| 更新 | `update:check` / `update:download` / `update:install` / `update:status` / `update:progress` | 自动更新 |
| 窗口 | `window:minimize` / `maximize` / `close` / `openDevTools` | 窗口控制 |
| 对话框 | `dialog:openFile` / `openFolder` / `saveFile` / `message` | 原生对话框 |
| 通知 | `notification:show` | 系统通知 |

### 4.4 数据模型（核心实体）

| 实体 | 说明 | 关键字段 |
| --- | --- | --- |
| ApiConfigGroup | API 配置分组 | provider、baseUrl、apiKey、apiFormat、customHeaders、skipTlsVerify、color、sortOrder |
| ChatSession | 会话 | configGroupId、model、modelParams、agentMode、projectEditMode、targetMode、todos、planContent/planStatus、branches、projectPath |
| ChatBranch | 分支 | forkedFromMessageId、messages |
| ChatMessage | 消息 | role、content、thinking、toolCalls、toolResults、error、contextFiles、tokenCount、editedAt |
| AgentRun | Agent 运行记录 | task、status、plan、toolCallCount、fileChangeCount、tokensIn/Out |
| Checkpoint | 回滚快照 | label、files[{path, content, existed}] |
| Memory | 长期记忆 | content、scope（global/project）、projectPath |
| Workflow | 工作流模板 | name、description、prompt |
| UserPreferences | 偏好设置 | theme、fontSize、chatPosition、language、encryptChatData、chatHistoryEditMode、aiAutoMemory、llmResponseCache、anthropicPromptCache、crossSessionInbound、lspServers |
| UsageEvent | 用量事件 | category、name、sub、tokensIn/Out、durationMs、ok |

### 4.5 目录结构（已实现）

```
electron/            # 主进程（main.ts、preload.ts）+ 服务层
src/components/      # ChatPanel / Editor / Sidebar / Terminal / Git / SearchPanel / Settings / Plugin / Skills 等
src/services/        # llm 适配器、tools（19 个工具）、skills、subagents、plugin、targetMode、lsp、arena、vibeReplace
src/stores/          # Zustand 状态（chat、editor、config、plugins、shortcuts、usage 等 14 个）
src/i18n/            # zh-CN / en-US
shared/              # IPC 通道常量 + 类型契约
e2e/                 # Playwright E2E
tools/               # create-nebula-plugin 脚手架
mcp-servers/         # git-server 等 MCP 服务
examples/            # ui-self-test-demo 示例
docs/                # 架构与浏览器自测文档
```

---

## 5. 接口与集成需求

### 5.1 外部集成

| 集成对象 | 协议 | 用途 |
| --- | --- | --- |
| LLM 提供商 API（8 类） | HTTPS / REST（流式 SSE） | 对话、工具调用、补全 |
| Ollama | 本地 HTTP | 本地模型 |
| MCP 服务器 | stdio / HTTP streamable | 外部工具接入 |
| Playwright MCP | MCP | 浏览器 UI 自测 |
| GitHub Releases | HTTPS | 自动更新源 |
| LSP 服务器（pylsp 等） | stdio JSON-RPC | 诊断 |

### 5.2 关键接口约束

- 所有出站 API 请求经主进程代理（无 CORS 限制）。
- 写文件接口必须校验路径在白名单内。
- 流式通道（LLM、文件、终端、更新）采用增量推送，UI 层节流渲染。

---

## 6. 用户界面需求

### 6.1 布局（MainLayout）

```
┌──────┬──────────────────────────────────────────┬──────────┐
│ 活 动 │               编辑区                      │  聊 天   │
│ 动 栏 │   TabBar + 面包屑 + Monaco + DiffView     │  面 板   │
│ 栏 ───┼──────────────────────────────────────────┤（可右/下）│
│ (ICON)│   侧边栏：文件树 / 搜索 / Git / 插件       │  或隐藏  │
└──────┴──────────────────────────────────────────┴──────────┘
              状态栏：语言 / 编码 / 分支 / 用量 / 更新
```

### 6.2 关键界面清单

| 界面 | 功能 |
| --- | --- |
| ChatPanel | 流式对话、Thinking 块、工具调用块、错误卡片、输入区 |
| ChatSidebar | 会话列表、历史编辑、分支树、记忆、工作流 |
| ArenaModal | 多模型对比竞技场 |
| ToolApprovalDialog | 写操作审批 |
| BatchApprovalDialog | 批量审批 |
| QuestionDialog / QuestionConfirmBar | 澄清提问 |
| AgentRunPanel / AgentTimeline / AgentTasksPanel | Agent 运行轨迹与任务 |
| EditorContainer / TabBar / DiffView / BreadcrumbBar | 编辑体验 |
| ProblemsPanel | LSP 诊断 |
| TerminalPanel | 集成终端 |
| GitPanel | Git 操作 |
| SearchPanel | 全文搜索 / 替换 |
| CommandPalette | 命令面板 |
| SettingsModal | API 配置 / 偏好 / MCP / 记忆管理 |
| OnboardingModal | 首次引导 |
| PluginMarketplace | 插件安装管理 |
| SkillRegistryModal | 技能注册表 |
| UsagePanel | 用量仪表盘 |
| RestoreBackupsModal | 崩溃恢复 |

### 6.3 交互规范

- 只读操作立即执行并显示结果；写操作弹审批对话框，含工具名、参数与目标路径。
- 分支切换、模式切换有明确的状态标识与可逆操作。
- 长耗操作（流式响应、Agent 运行、文件加载）必须有进度 / 状态反馈。

---

## 7. 部署与发布需求

### 7.1 构建产物

| 平台 | 产物 | 文件名模式 |
| --- | --- | --- |
| Windows | NSIS 安装包 | `OurCode-Setup-{version}-{arch}.exe`（可选安装目录、创建桌面快捷方式） |
| Windows | Portable | `OurCode-Portable-{version}-{arch}.exe` |
| macOS | DMG + ZIP | `OurCode-{version}.dmg/.zip` |
| Linux | AppImage + deb | `OurCode-{version}.AppImage/.deb` |

### 7.2 版本与更新

- 语义化版本（当前 0.1.0）。
- 自动更新：检查 → 下载（进度）→ 提示安装 → 重启生效。
- 更新源：GitHub Releases（owner `16fengzhiyong` / repo `OurCode`）。

### 7.3 环境要求

- Node.js 20+ / npm。
- Windows 可直接使用 `dev.bat` / `run.bat` 快速启动。
- 原生模块 ABI 不匹配时执行 `npx electron-builder install-app-deps` 重建。

---

## 8. 测试需求

### 8.1 单元测试（Vitest）

覆盖范围（当前已有 28 个测试文件）：
- 核心 store（chatStore、shortcutStore、uiStore、commandRegistry）
- LLM 适配（llmHttp、responsesAdapter、endpoints、anthropicCacheControl、responseCache）
- 工具与子智能体（toolRegistry、skillManager、skillRegistry、subagentDefinitions、parallel）
- 主进程服务（file-system、crypto、backup、debug、lsp、mcp-manager、mcp-http、usage-store）
- 其他（i18n、breadcrumbs、targetModeService、sessionEventNotifier、lifeguard、slashCommands、contextEngine）

### 8.2 E2E 测试（Playwright）

- 关键用户旅程：Onboarding → 配置 API → 打开项目 → 对话 → 工具调用 → 审批 → 保存。
- 编辑器打开 / 编辑 / 保存 / 大文件加载。
- 终端创建与命令执行。
- Git 面板基础流程。

### 8.3 验收标准（DoD）

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm test` 全部通过
- [ ] `npm run test:e2e` 通过
- [ ] Windows 打包产物可安装、可启动、可完成一次完整对话

---

## 9. 里程碑规划（建议）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| M1 基础框架 | Electron + React 骨架、文件系统、编辑器、SQLite | ✅ 已完成 |
| M2 AI 对话 | 流式聊天、多提供商、API 配置、思考块 | ✅ 已完成 |
| M3 智能体 | 工具调用、审批、Agent 模式、子智能体、Checkpoint | ✅ 已完成 |
| M4 生产力 | 终端、Git、搜索替换、LSP、快捷键、主题、i18n | ✅ 已完成 |
| M5 生态扩展 | 插件系统、技能、MCP、Arena、工作流、记忆 | ✅ 已完成 |
| M6 打磨发布 | 用量统计、自动更新、崩溃恢复、E2E 完善、1.0 发布 | 🚧 进行中 |

---

## 10. 风险与开放问题

| # | 风险 / 问题 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 1 | 原生模块（better-sqlite3 / node-pty）跨平台编译 | 安装失败率高 | 提供 install-app-deps 重建、CI 预编译产物 |
| 2 | 多提供商协议差异（SSE 格式、工具调用格式） | 功能不一致 | apiFormat 覆盖层 + 适配器测试 |
| 3 | AI 写文件可能破坏用户代码 | 数据安全 | 强制审批 + Checkpoint 回滚 + 白名单 |
| 4 | 大上下文场景 token 成本高 | 成本 | 响应缓存 + Anthropic prompt-caching + 用量仪表盘 |
| 5 | 自签名 / 内网证书导致连接失败 | 可用性 | skipTlsVerify 开关（需二次确认风险提示） |
| 6 | 插件越权风险 | 安全 | Web Worker 沙箱 + 权限清单 + 审核机制 |

---

## 附录 A：参考文档

| 文档 | 路径 |
| --- | --- |
| 项目自述（中文） | `README.zh-CN.md` |
| 项目自述（英文） | `README.md` |
| 浏览器 UI 自测方案 | `docs/BROWSER_SELF_TEST.md` |
| 插件扩展架构 | `docs/EXTENSIONS_ARCHITECTURE.md` |
| MCP 配置示例 | `mcp_config.example.json` |
| 技能配置示例 | `skills.json.example` |

## 附录 B：当前实现基线（2026-08-10）

- 代码规模：`src/` 149 个文件；组件 60+；stores 14 个；服务 20+。
- 单测 28 个文件；E2E 使用 Playwright + Playwright MCP。
- 已实现 19 个 Agent 工具、3 类内置子智能体、4 种 Agent 模式、8 类 LLM 提供商、3 种 MCP 传输。
