# OurCode IDE

> An AI-powered code editor with multi-provider LLM support, agentic workflows, and editable chat history.

[中文文档](./README.zh-CN.md)

OurCode IDE is a desktop code editor built with Electron that brings an AI assistant directly into your coding workflow. Chat with the assistant, let it read and edit files in your workspace, run commands in the integrated terminal, and keep full control with human-in-the-loop approvals — or delegate autonomous subtasks to specialized subagents.

## ✨ Feature Highlights

### 🤖 AI Assistant & Chat

- **Streaming chat with live thinking** — Responses stream token by token with thinking blocks rendered in real time; Markdown output is sanitized with DOMPurify before display.
- **Editable chat history** — Edit, delete, or regenerate from any past message; drag to reorder, or batch-delete.
- **Branch & compare** — Fork a conversation from any message and switch branches in a tree view, or run the same prompt across several models in an Arena and adopt the best answer with one click.
- **Long-term memory** — The assistant can save and retrieve project memories (toggleable).
- **Reusable workflows** — Save prompts as workflow templates to kick off recurring tasks in a single click.

### 🌐 Multi-Provider LLM Support

- **8 provider families** — OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Azure OpenAI, Ollama (local), and any OpenAI-compatible endpoint.
- **Multiple API groups** — Per-group color labels, custom headers, and wire-format override (`openai` / `responses` / `anthropic` / `azure` / `ollama`).
- **Painless setup** — Guided onboarding, step-by-step connection tests, model-list fetching, and (optionally encrypted) import/export of your configuration.

### 🛠️ Agentic Tools & Autonomous Workflows

- **Agentic tool calling** — The assistant reads files, searches your workspace, creates/edits files, and runs commands. **Write operations always require your explicit approval**; read-only operations run immediately. Batch-approve with one click.
- **Four agent modes** — `confirm_before_change`, `auto_edit`, `plan`, and `full_access` let you dial autonomy from strict confirmation to hands-free.
- **Plan mode & todos** — The assistant can propose a plan, maintain a task checklist, and ask you clarifying questions mid-task.
- **Subagents** — Built-in `code-reviewer`, `test-generator`, and `researcher` agents (customizable via `.ourcode/agents/*.md`) run delegated subtasks with monotonically-decreasing permissions, iteration/token budgets, and checkpoint rollback.
- **Skills** — Claude-Code-style `SKILL.md` discovery: skills in your workspace or user directory are exposed as read-only tools, and more can be installed from a skill registry.
- **MCP support** — Connect MCP servers over stdio or HTTP (streamable) to extend the assistant with external tools, resources, and prompts, with automatic reconnection.

### 📝 Code Editor & Workspace

- **Monaco-based editor** — Multi-tab editing, diff views, breadcrumbs, snippets, minimap, and AI inline completion (ghost text, `Tab` to accept).
- **Large-file friendly** — Chunked streaming for big files, automatic encoding detection, and encoding/BOM-preserving writes.
- **Fast navigation** — File explorer, Quick Open (`Ctrl+P`), and a VS Code-style command palette (`Ctrl+Shift+P`).
- **Search & replace** — Whole-workspace search with case/whole-word/regex options, include/exclude patterns, and batch replace.
- **LSP diagnostics** — Per-language LSP servers (e.g. `pylsp` for Python) stream diagnostics into the Problems panel.
- **Crash recovery** — Hot-exit backups and automatic restore of unsaved buffers after an unexpected quit.

### 🖥️ Terminal & Git

- **Integrated terminal** — Full-featured xterm.js + node-pty terminal with multiple tabs, renaming, side-by-side split panes, and light/dark ANSI palettes.
- **Git panel** — Status, diff, stage/unstage, commit, push/pull, and log — plus **AI-generated commit messages** and a **Lifeguard** pre-commit review that flags potential bugs with error/warning/info severity.

### 🧩 Extensibility & Customization

- **Sandboxed plugins** — Web-Worker plugins with a permission model; contribute commands, keybindings, custom panels, and status-bar items, with an in-app install/management UI.
- **Shortcut presets** — VS Code, JetBrains, or fully custom keybindings.
- **Theming** — Dark / light / system themes with a custom accent color.
- **Bilingual UI** — Chinese (zh-CN) and English (en-US).

### 🔒 Security & Privacy

- Filesystem access is restricted to an explicit allowlist (only folders you opened).
- Strict Content-Security-Policy in the renderer.
- API keys encrypted with AES-256-GCM using a machine-bound key.
- Optional master-password encryption for chat data at rest.
- Markdown rendered in chat is sanitized with DOMPurify.
- Local-first storage (SQLite) — your data stays on your machine, except for the API calls you configure.

### ⚙️ More

- **Usage analytics** — Per-model usage dashboard with stats for models, skills, subagents, and MCP tools.
- **Auto-update** — Seamless in-app updates via electron-updater.

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
4. Open a folder, then start a chat — the assistant can use agentic tools; write operations ask for your approval first, read-only operations run automatically.

## 📁 Project Structure

```
OurCode-ide/
├── electron/            # Main process (main.ts, preload.ts) & services
│   └── services/        # file-system, sqlite-store, crypto, backup, mcp-manager
├── src/                 # Renderer (React)
│   ├── components/      # ChatPanel, Editor, Sidebar, Terminal, Git, SearchPanel,
│   │                    # CommandPalette, Skills, Plugin, Settings...
│   ├── services/        # LLM clients/adapters, tools, skills, subagents, plugin, commands
│   ├── stores/          # Zustand stores (chat, editor, config, plugins, shortcuts...)
│   ├── hooks/           # Custom hooks (e.g. inline completion)
│   └── utils/           # Helpers (file icons, etc.)
├── shared/              # Types & constants shared between main and renderer
├── e2e/                 # Playwright end-to-end tests
└── tools/               # CLI helpers (create-nebula-plugin)
```

## 🔌 Plugin Development

Plugins are sandboxed in Web Workers and declare their capabilities via a manifest with explicit permissions:

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

Available permissions: `editor.read`, `editor.write`, `file.read`, `file.write`, `ai.chat`, `ai.completion`, `ui.panel`, `ui.statusbar`, `terminal.read`, `terminal.write`, `network`.

Contribution points: commands (merged into the unified command registry), keybindings, custom panels, and status-bar items.

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
