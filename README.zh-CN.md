# OurCode IDE

> 一款 AI 驱动的代码编辑器，支持多模型提供商、智能体工具调用与可编辑的对话历史。

[English Documentation](./README.md)

OurCode IDE 是一个基于 Electron 构建的桌面代码编辑器，将 AI 助手直接融入你的编码工作流。你可以与助手对话，让它读取和编辑工作区文件、在集成终端中执行命令，并通过人工确认机制（human-in-the-loop）全程掌控工具调用。

## ✨ 功能特性

- **🤖 AI 聊天面板** — 流式对话响应，支持思考过程（Thinking）展示、Markdown 渲染与历史记录编辑。
- **🌐 多提供商 LLM 支持** — OpenAI、Anthropic、Google Gemini、DeepSeek、Groq、Azure OpenAI、Ollama（本地）以及任意 OpenAI 兼容接口。可配置多个 API 分组，支持颜色标签与自定义请求头。
- **🔧 智能体工具调用** — 助手可读取文件、搜索工作区、创建/编辑文件、执行命令——每次工具调用都需要你显式批准。
- **📝 可编辑对话历史** — 可重新编辑历史对话、创建分支，并排对比不同模型的回答。
- **💻 Monaco 代码编辑器** — 多标签编辑、Diff 视图与行内补全。
- **🖥️ 集成终端** — 基于 xterm.js 与 node-pty 的完整终端体验。
- **📂 文件浏览器** — 文件树、快速打开、工作区内全文搜索。
- **🧩 插件系统** — 沙箱化插件，带权限模型，可贡献命令、快捷键、主题与语言。内置插件市场。
- **🔒 安全优先** — 文件系统访问受显式白名单限制；API Key 加密存储；可选主密码对聊天数据加密。
- **💾 SQLite 持久化** — 配置分组、会话与偏好设置本地存储。
- **🔄 自动更新** — 基于 electron-updater 的内置更新机制。

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
2. 打开 **设置** → **API 配置**，创建一个 API 分组：选择提供商、填入 API Key（可选填写 Base URL 与自定义请求头）、设置默认模型。
3. 在 **偏好设置** 中调整行为，在 **快捷键** 中查看键位绑定。
4. 打开一个文件夹，然后开始对话——助手可以使用智能体工具，但每次工具调用都会先征求你的批准。

## 📁 项目结构

```
OurCode-ide/
├── electron/            # 主进程（main.ts、preload.ts）与服务
│   └── services/        # file-system、sqlite-store、crypto
├── src/                 # 渲染进程（React）
│   ├── components/      # ChatPanel、Editor、Sidebar、Terminal、Git、Settings 等
│   ├── services/        # LLM 客户端/适配器、工具注册/执行、插件管理
│   ├── stores/          # Zustand 状态（chat、editor、config、plugins、shortcuts 等）
│   ├── hooks/           # 自定义 Hook（如行内补全）
│   └── utils/           # 工具函数（文件图标等）
├── shared/              # 主进程与渲染进程共享的类型与常量
├── e2e/                 # Playwright 端到端测试
└── tools/               # CLI 工具（create-nebula-plugin）
```

## 🔌 插件开发

插件在沙箱中运行，通过清单文件（manifest）声明能力与显式权限：

```jsonc
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": ["editor.read", "file.write"],
  "contributes": {
    "commands": [{ "id": "my.command", "title": "My Command" }],
    "themes": [{ "id": "my-theme", "label": "My Theme", "path": "theme.json" }]
  }
}
```

可用权限：`editor.read`、`editor.write`、`file.read`、`file.write`、`ai.chat`、`ai.completion`、`ui.panel`、`ui.statusbar`、`terminal.read`、`terminal.write`、`network`。

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
