# OurCode IDE

> An AI-powered code editor with multi-provider LLM support, agentic tool calling, and editable chat history.

[中文文档](./README.zh-CN.md)

OurCode IDE is a desktop code editor built with Electron that brings an AI assistant directly into your editing workflow. Chat with the assistant, let it read and edit files in your workspace, run commands in the integrated terminal, and keep full control with human-in-the-loop tool approvals.

## ✨ Features

- **🤖 AI Chat Panel** — Streamed chat responses with thinking blocks, markdown rendering, and editable history.
- **🌐 Multi-Provider LLM Support** — OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Azure OpenAI, Ollama (local), and any OpenAI-compatible endpoint. Configure multiple API groups with color labels and custom headers.
- **🔧 Agentic Tool Calling** — The assistant can read files, search your workspace, create/edit files, and run commands — every tool call requires your explicit approval.
- **📝 Editable Chat History** — Re-edit past conversations, branch and compare different model responses side by side.
- **💻 Monaco Code Editor** — Multi-tab editing, diff views, and inline completion.
- **🖥️ Integrated Terminal** — Full-featured terminal via xterm.js and node-pty.
- **📂 File Explorer** — File tree, quick open, and in-workspace search across files.
- **🧩 Plugin System** — Sandboxed plugins with a permission model, contributing commands, keybindings, themes, and languages. Browse the built-in marketplace.
- **🔒 Security First** — Filesystem access is restricted to an explicit allowlist, API keys are encrypted at rest, and optional master-password encryption for chat data.
- **💾 SQLite Persistence** — Config groups, sessions, and preferences stored locally.
- **🔄 Auto-Update** — Built-in updates via electron-updater.

## 🌐 Supported Providers

| Provider | Notes |
| --- | --- |
| OpenAI | Official API |
| Anthropic | Claude models |
| Google Gemini | Gemini models |
| DeepSeek | DeepSeek API |
| Groq | Groq cloud inference |
| Azure OpenAI | Azure-hosted OpenAI |
| Ollama | Local models via Ollama |
| Custom | Any OpenAI-compatible endpoint |

## 🧰 Tech Stack

- **Electron + electron-vite** — desktop shell and build tooling
- **React + TypeScript** — renderer UI
- **Tailwind CSS** — styling
- **Monaco Editor** — code editing
- **xterm.js + node-pty** — integrated terminal
- **better-sqlite3** — local storage
- **Zustand** — state management
- **Vitest / Playwright** — unit and e2e tests

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 20+ and npm
- (Windows quick start) you can use `dev.bat` / `run.bat` instead of the manual steps below

### Install

```bash
npm install
```

> `better-sqlite3` and `node-pty` are native modules. If you hit ABI mismatch errors when running under Electron, rebuild them with:
>
> ```bash
> npx electron-builder install-app-deps
> ```

### Run in development

```bash
npm run dev
```

### Quality checks

```bash
npm run typecheck   # TypeScript type check
npm run lint        # ESLint
npm test            # Vitest unit tests
npm run test:e2e    # Playwright e2e tests (npx playwright install first)
```

### Build & package

```bash
npm run build            # build for development preview
npm run dist:win         # Windows (nsis + portable)
npm run dist:mac         # macOS (dmg + zip)
npm run dist:linux       # Linux (AppImage + deb)
```

## ⚙️ Usage

1. Launch the app and complete the onboarding.
2. Open **Settings** → **API Config** and create an API group: pick a provider, paste your API key (optionally a base URL and custom headers), and set a default model.
3. Use **Preferences** to tweak behavior and **Shortcuts** to review keybindings.
4. Open a folder, then start a chat — the assistant can use agentic tools, but every tool call asks for your approval first.

## 📁 Project Structure

```
OurCode-ide/
├── electron/            # Main process (main.ts, preload.ts) & services
│   └── services/        # file-system, sqlite-store, crypto
├── src/                 # Renderer (React)
│   ├── components/      # ChatPanel, Editor, Sidebar, Terminal, Git, Settings...
│   ├── services/        # LLM clients/adapters, tool registry/executor, plugin manager
│   ├── stores/          # Zustand stores (chat, editor, config, plugins, shortcuts...)
│   ├── hooks/           # Custom hooks (e.g. inline completion)
│   └── utils/           # Helpers (file icons, etc.)
├── shared/              # Types & constants shared between main and renderer
├── e2e/                 # Playwright end-to-end tests
└── tools/               # CLI helpers (create-nebula-plugin)
```

## 🔌 Plugin Development

Plugins are sandboxed and declare their capabilities via a manifest with explicit permissions:

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

Available permissions: `editor.read`, `editor.write`, `file.read`, `file.write`, `ai.chat`, `ai.completion`, `ui.panel`, `ui.statusbar`, `terminal.read`, `terminal.write`, `network`.

## 🔐 Security

- All `fs:*` IPC handlers validate paths against an explicit allowlist (only folders you opened).
- Strict Content-Security-Policy in the renderer.
- API keys are encrypted with AES-256-GCM using a machine-bound key.
- Optional master-password encryption protects chat data at rest.
- Markdown rendered in chat is sanitized with DOMPurify.

## 📄 License

[PolyForm Noncommercial License 1.0.0](./LICENSE) — free to use, modify, and distribute for any **noncommercial purpose**, including personal research, study, education, hobby projects, and use by noncommercial organizations (charities, educational institutions, public research organizations, and government institutions).

**Commercial use is not permitted.** If you'd like to use OurCode IDE for commercial purposes, please contact the author for a separate license.

See [LICENSE](./LICENSE) for the full terms.
