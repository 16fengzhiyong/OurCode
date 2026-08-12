# OurCode IDE

> 一款 AI 驱动的代码编辑器，支持多模型提供商、智能体工作流与可编辑的对话历史。

[English Documentation](./README.md)

OurCode IDE 是一个基于 Electron 构建的桌面代码编辑器，将 AI 助手直接融入你的编码工作流。你可以与助手对话，让它读取和编辑工作区文件、在集成终端中执行命令，通过人工确认机制（human-in-the-loop）全程掌控工具调用——也可以把独立子任务交给专门的子智能体自主完成。

## ✨ 功能亮点

### 🤖 AI 助手与对话

- **流式聊天 + 实时思考过程** — 回复逐字流式输出，思考块（Thinking）实时渲染；Markdown 内容经 DOMPurify 消毒后再展示。
- **可编辑对话历史** — 可修改、删除任意历史消息，从任意一条重新生成；支持拖拽排序与批量删除。
- **分支与对比** — 从任意消息分叉出对话分支，树形视图切换；或在竞技场（Arena）中让多个模型并行回答同一提示词，一键采纳最佳结果。
- **长期记忆** — 助手可保存并检索项目记忆（可开关）。
- **可复用工作流** — 将常用提示词保存为工作流模板，一键发起重复性任务。

### 🌐 多提供商 LLM 支持

- **8 类提供商** — OpenAI、Anthropic、Google Gemini、DeepSeek、Groq、Azure OpenAI、Ollama（本地）以及任意 OpenAI 兼容接口。
- **多 API 分组** — 每组独立配置颜色标签、自定义请求头与传输格式覆盖（`openai` / `responses` / `anthropic` / `azure` / `ollama`）。
- **开箱即用** — 引导式 Onboarding、分步连接测试、自动拉取模型列表，以及（可选加密的）配置导入/导出。

### 🛠️ 智能体工具与自主工作流

- **智能体工具调用** — 助手可读取文件、搜索工作区、创建/编辑文件、执行命令。**写操作始终需要你显式批准**，只读操作立即执行；支持一键批量审批。
- **四种 Agent 模式** — `confirm_before_change`（变更前确认）、`auto_edit`（自动编辑）、`plan`（计划）、`full_access`（完全放权），从严格确认到完全放手自由调节。
- **计划模式与任务清单** — 助手可先提出实施计划、维护任务清单（todos），并在任务中途向你提出澄清问题。
- **子智能体（Subagents）** — 内置 `code-reviewer`（代码审查）、`test-generator`（测试生成）、`researcher`（检索）三类智能体（可通过 `.ourcode/agents/*.md` 自定义），以权限单调递减、迭代/Token 预算与 checkpoint 回滚的方式执行委派子任务。
- **技能系统（Skills）** — 类 Claude Code 的 `SKILL.md` 发现机制：工作区或用户目录中的技能会作为只读工具按需加载，也可从技能注册表一键安装。
- **MCP 支持** — 通过 stdio 或 HTTP（streamable）连接 MCP 服务器，为助手接入外部工具、资源与提示词，支持断线自动重连。
- **内置 Git MCP（免装 Node）** — 内置的 git-server MCP 用 IDE 自带的 Node 运行时启动（配置里 command 填 `bundled-node`、args 用 `bundled:` 前缀，设置界面有一键添加），**无 Node 环境**的用户也能让 AI 查看仓库状态、生成提交信息、提交与推送；仅需系统装有 git 命令行。
- **浏览器 UI 自测** — 接入 Playwright MCP 后，助手可打开真实浏览器，对客户 Web 项目自动点击/输入并逐项验证功能（`ui-self-test` 技能）。详见 [`docs/BROWSER_SELF_TEST.md`](docs/BROWSER_SELF_TEST.md)，可运行示例见 [`examples/ui-self-test-demo`](examples/ui-self-test-demo)。

### 📝 代码编辑器与工作区

- **基于 Monaco 的编辑器** — 多标签编辑、Diff 视图、面包屑、Snippet、minimap。
- **大文件友好** — 大文件分块流式加载，自动编码检测，写入保留原编码与 BOM。
- **快速导航** — 文件浏览器、快速打开（`Ctrl+P`）、类 VS Code 命令面板（`Ctrl+Shift+P`）。
- **搜索与替换** — 工作区全文搜索（大小写/全字/正则、包含/排除模式），支持批量替换。
- **LSP 诊断** — 按语言启用 LSP 服务器（如 Python 的 `pylsp`），诊断信息实时汇入 Problems 面板。
- **崩溃恢复** — hot-exit 备份机制，意外退出后自动恢复未保存的缓冲区。

### 🖥️ 终端与 Git

- **集成终端** — 基于 xterm.js + node-pty 的完整终端，支持多标签、重命名、左右分屏与深浅色 ANSI 配色。
- **Git 面板** — 状态、Diff、暂存/取消暂存、提交、Push/Pull、日志；支持 **AI 生成提交信息**，以及 **Lifeguard 提交前预检**——由 AI 在提交前审查改动并分级（error/warning/info）提示潜在问题。

### 🧩 扩展与定制

- **沙箱化插件** — Web Worker 沙箱 + 权限模型，可贡献命令、快捷键、自定义面板与状态栏项，内置插件安装/管理界面。
- **快捷键预设** — VS Code、JetBrains 或完全自定义键位。
- **主题** — 深色 / 浅色 / 跟随系统，支持自定义强调色。
- **双语界面** — 中文（zh-CN）与英文（en-US）。

### 🔒 安全与隐私

- 文件系统访问受显式白名单限制（仅限你打开过的文件夹）。
- 渲染进程使用严格的 Content-Security-Policy。
- API Key 使用 AES-256-GCM 加密，密钥与机器绑定。
- 可选主密码加密聊天数据的静态安全。
- 聊天中的 Markdown 内容经 DOMPurify 消毒后再渲染。
- 本地优先存储（SQLite）——你的数据保存在本机，除你主动配置的 API 调用外不外传。

### ⚙️ 更多

- **用量统计** — 按模型、技能、子智能体、MCP 工具分级的用量仪表盘。
- **自动更新** — 基于 electron-updater 的无感应用内更新。

## 🌐 支持的提供商

| 提供商 | 说明 |
| --- | --- |
| OpenAI | 官方 API |
| Anthropic | Claude 系列模型 |
| Google Gemini | Gemini 系列模型 |
| DeepSeek | DeepSeek API |
| Groq | Groq 云端推理 |
| Azure OpenAI | Azure 托管的 OpenAI |
| Ollama | 通过 Ollama 运行本地模型 |
| Custom | 任意 OpenAI 兼容接口 |

## 🧰 技术栈

- **Electron + electron-vite** — 桌面壳与构建工具
- **React + TypeScript** — 渲染进程 UI
- **Tailwind CSS** — 样式
- **Monaco Editor** — 代码编辑
- **xterm.js + node-pty** — 集成终端
- **better-sqlite3** — 本地存储
- **Zustand** — 状态管理
- **Vitest / Playwright** — 单元测试与端到端测试

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org) 20+ 与 npm
- （Windows 快速启动）也可以直接使用 `dev.bat` / `run.bat` 代替下面的手动步骤

### 安装依赖

```bash
npm install
```

> `better-sqlite3` 和 `node-pty` 是原生模块。若在 Electron 下运行出现 ABI 不匹配错误，请重新构建：
>
> ```bash
> npx electron-builder install-app-deps
> ```

### 开发模式运行

```bash
npm run dev
```

### 质量检查

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm test            # Vitest 单元测试
npm run test:e2e    # Playwright 端到端测试（需先执行 npx playwright install）
```

### 构建与打包

```bash
npm run build            # 构建（开发预览用）
npm run dist:win         # Windows（nsis + portable）
npm run dist:mac         # macOS（dmg + zip）
npm run dist:linux       # Linux（AppImage + deb）
```

## ⚙️ 使用说明

1. 启动应用并完成引导（Onboarding）。
2. 打开 **设置** → **API 配置**，创建一个 API 分组：选择提供商、填入 API Key（可选填写 Base URL 与自定义请求头）、设置默认模型。Base URL 支持 `http://` 与 `https://`（内网地址可直接用 http）；若网关使用内网自签名 / 私有 CA 证书，勾选「跳过证书校验」即可连接。所有 API 与 MCP 请求都由主进程代理发出，不存在浏览器跨域（CORS）限制。
3. 在 **偏好设置** 中调整行为，在 **快捷键** 中查看键位绑定。
4. 打开一个文件夹，然后开始对话——助手可以使用智能体工具；写操作会先征求你的批准，只读操作自动执行。

## 📁 项目结构

```
OurCode-ide/
├── electron/            # 主进程（main.ts、preload.ts）与服务
│   └── services/        # file-system、sqlite-store、crypto、backup、mcp-manager
├── src/                 # 渲染进程（React）
│   ├── components/      # ChatPanel、Editor、Sidebar、Terminal、Git、SearchPanel、
│   │                    # CommandPalette、Skills、Plugin、Settings 等
│   ├── services/        # LLM 客户端/适配器、工具、技能、子智能体、插件、命令
│   ├── stores/          # Zustand 状态（chat、editor、config、plugins、shortcuts 等）
│   ├── hooks/           # 自定义 Hook（如行内补全）
│   └── utils/           # 工具函数（文件图标等）
├── shared/              # 主进程与渲染进程共享的类型与常量
├── e2e/                 # Playwright 端到端测试
└── tools/               # CLI 工具（create-nebula-plugin）
```

## 🔌 插件开发

插件在 Web Worker 沙箱中运行，通过清单文件（manifest）声明能力与显式权限：

```jsonc
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": ["editor.read", "file.write"],
  "contributes": {
    "commands": [{ "id": "my.command", "title": "My Command" }],
    "statusBar": [{ "id": "my.status", "label": "My Status" }]
  }
}
```

可用权限：`editor.read`、`editor.write`、`file.read`、`file.write`、`ai.chat`、`ai.completion`、`ui.panel`、`ui.statusbar`、`terminal.read`、`terminal.write`、`network`。

扩展点：命令（并入统一命令注册表）、快捷键、自定义面板与状态栏项。

## 🔐 安全说明

- 所有 `fs:*` IPC 处理都会根据显式白名单校验路径（仅限你打开过的文件夹）。
- 渲染进程使用严格的 Content-Security-Policy。
- API Key 使用 AES-256-GCM 加密，密钥与机器绑定。
- 可选的主密码加密保护聊天数据的静态安全。
- 聊天中的 Markdown 内容经 DOMPurify 消毒后再渲染。

## 📄 许可证

[PolyForm Noncommercial License 1.0.0](./LICENSE) —— 任何**非商业目的**均可自由使用、修改和分发本软件，包括个人研究、学习、教育、业余项目，以及慈善机构、教育机构、公共研究机构、政府机构等非商业组织的使用。

**禁止商业使用。** 如需将 OurCode IDE 用于商业用途，请联系作者获取单独授权。

完整条款见 [LICENSE](./LICENSE)。
