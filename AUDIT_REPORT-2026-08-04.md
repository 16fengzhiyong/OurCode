# OurCode IDE — 功能完成度与可用性审查报告（2026-08-04）

> 本次审查基于对全部源码的静态审计 + 实测验证（typecheck / build / unit test / e2e）。
> 与 2026-05-28 的 `AUDIT_REPORT.md`（53% 完成度）相比，项目已有大幅迭代，
> 本报告反映**当前代码实际状态**，并附实测证据。

---

## 一、总体结论

| 维度 | 结论 |
|------|------|
| 可构建 | ✅ `npm run build` 成功（15.5s） |
| 可运行 | ✅ e2e 实测应用可正常启动、开关侧边栏/终端/设置 |
| 类型检查 | ✅ `tsc --noEmit` 通过 |
| 单元测试 | ✅ 26/26 通过（crypto 14 + toolRegistry 12） |
| E2E 测试 | ⚠️ 4/5 通过，1 个失败（过期的 "Nova Studio" 品牌断言） |
| Lint | ❌ 无法运行 — `eslint` 未在 package.json 声明（脚本引用了未声明的依赖） |

**核心判断：**
- 项目骨架完整，**聊天 + 工具执行（Agent 循环）是真正可用的亮点**：SSE 流式、6 家 LLM 适配器、
  10 个真实文件系统/命令工具、工具审批对话框均已接通。
- 但存在**多项"表面完成、实际不可用"的功能**：编辑器分屏（无入口）、AI 内联补全（死代码）、
  插件系统（无法激活）、模型获取失败提示（无 UI）、快捷键自定义（不生效）等。
- 存在 **1 个高危安全漏洞**（Markdown XSS 可直达任意文件读写/任意命令执行）和
  **1 个必现崩溃**（多轮工具对话第二次提问必抛 TypeError）。

---

## 二、构建与质量实测

| 检查项 | 结果 | 证据/说明 |
|--------|------|-----------|
| `npm run typecheck` | ✅ 通过 | 无类型错误 |
| `npm run build` | ✅ 通过 | 15.5s；渲染主 chunk `index-*.js` **8.9MB**（Monaco 全量打入，无按需分包） |
| `npm run lint` | ❌ 无法运行 | `package.json:16` 引用 `eslint`，但 eslint 不在 dependencies/devDependencies 中；`node_modules` 与 `package-lock.json` 中均不存在 |
| `npm test` | ✅ 26/26 | `electron/__tests__/crypto.test.ts`（14）、`src/__tests__/toolRegistry.test.ts`（12） |
| `npm run test:e2e` | ⚠️ 4/5 | 失败项为 `e2e/chat-flow.spec.ts:20` "Nova Studio" 文案断言：splash 加载后即被移除，页面无该文案 |
| 应用启动 | ✅ | e2e 已实测 `electron.launch` 成功（主进程、node-pty、better-sqlite3 均正常加载） |
| 依赖完整性 | ⚠️ | `package-lock.json` 过期：eslint / vitest / @playwright/test 未锁入；执行 `npm install` 后 vitest/playwright 补装成功，eslint 因未声明而仍缺失 |

> 注：本次审查执行了 `npm install`（仅补装已声明的 devDependencies，未改动 package.json）。

---

## 三、功能完成度矩阵

图例：✅ 完整可用 ｜ ⚠️ 部分实现/有缺陷 ｜ ❌ 未实现/不可用（附文件:行号证据）

### 1. 文件与目录管理

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 1 | 文件树无限层级展开/折叠 + 图标 | ⚠️ | 实现于 `FileTree.tsx:76-91` / `FileTreeNode.tsx:265-280`；**Bug：watcher 触发刷新后 `FileTree.tsx:41` 用扁平 `listDir` 结果替换整树，已展开目录瞬间丢失子节点** |
| 2 | 右键菜单（新建/重命名/删除/复制路径/剪切粘贴） | ✅ | `FileTreeNode.tsx:39-153` |
| 3 | 拖拽移动文件/文件夹 | ✅ | `FileTreeNode.tsx:155-206`（仅目录可作放置目标） |
| 4 | 多标签页 + 标签拖拽重排 | ✅ | `TabBar.tsx:39-93`、`editorStore.ts:323-365` |
| 5 | 编辑器分屏 | ❌ 不可用 | `editorStore.ts:120-141` 的 `splitPanel/closePanel/cyclePanelFocus` **全项目零调用**，无任何 UI 入口；`splitDirection` 为单一全局值，无法混合布局 |
| 6 | Monaco 语法高亮 + 折叠 | ⚠️ | `LANGUAGE_MAP`（`shared/constants.ts:157-270`）84 个扩展名 → **45 种语言**（未达"50+"宣称）；折叠✅；**Monaco 未配置 worker（无 MonacoEnvironment），打包后语言服务可能降级** |
| 7 | 代码补全（本地 + AI） | ⚠️ | Monaco 本地补全✅；**AI 内联补全 `useInlineCompletion.ts` 全项目无任何调用，属死代码** |
| 8 | 编辑器快捷键 | ✅ | `MainLayout.tsx:57-189`（Ctrl+S/F/H/Z/N/W/B/J/P…） |
| 9 | Git 面板（暂存/提交/推送/拉取/日志） | ✅ | `GitPanel.tsx`；**Bug：点击文件名打开的是仓库相对路径（`GitPanel.tsx:345`），`readFile` 按主进程 cwd 解析，非仓库根目录时 ENOENT** |
| 10 | Git 差异对比（side-by-side） | ✅ | `DiffView.tsx:21`（`renderSideBySide: true`；新增/删除文件回退为文本 diff） |
| 11 | 终端集成（xterm.js + node-pty） | ✅ | 多标签、拖拽高度、横向分屏（`TerminalPanel.tsx`）；node-pty win32 预编译二进制存在，e2e 实测可开关 |
| 12 | 全局搜索替换 | ⚠️ | 正则/大小写/全词/文件类型/排除文件夹均实现（`SearchPanel.tsx` + `main.ts:307-386`）；**Bug：替换全部在 CRLF 文件上按行偏移 +1 逐行累积漂移（`SearchPanel.tsx:116-119`），且不刷新已打开编辑器里的旧内容**；`src/components/Sidebar/SearchPanel.tsx` 为废弃重复文件 |

### 2. 多 API 配置组系统

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 13-15 | 多配置组 / 名称颜色提供商 / Endpoint | ✅ | `SettingsModal.tsx`、`configStore.ts:92-137` |
| 16 | API Key 加密存储（AES-256-GCM） | ✅ | `crypto.ts:4,15-18,22`（scrypt 派生密钥） |
| 17 | API Key 环境变量（$VAR） | ✅ | `configStore.ts` / `SettingsModal.tsx:277` |
| 18 | 连接测试 + 结果 | ✅ | `configStore.ts:278-294` |
| 19 | 状态栏快速切换配置组 | ❌ 回归 | 旧版状态栏有下拉切换；**新版 `StatusBar.tsx`（264 行）仅 import `setActiveConfigGroup`，无任何切换 UI**，切换只能进设置点 "Use" |
| 20 | 切换时 prompt/模型/客户端同步 | ✅ | `configStore.ts:139-142` |
| 21 | 导出（密钥加密） | ⚠️ | 可选密码加密；无密码时导出为 `***` 掩码 |
| 22 | 导入（主密码解密） | ⚠️ | `configStore.ts:306-332`；**掩码 `***` 或无法解析的组被静默跳过，无提示** |
| 23 | 配置组排序 | ❌ 数据不持久 | `configStore.ts:334-346` 写 `sortOrder`，但 `api_config_groups` 表**无 sort_order 列**，`getConfigGroups` 按 `created_at DESC`，拖拽排序重启即丢失 |
| 24 | 默认配置组 + 首次引导 | ⚠️ | Onboarding 已实现（见 #96）；但无持久化"默认组"，仅内存选中第一组 |
| 25 | 删除 + 确认 | ✅ | 确认对话框 |
| 26 | SQLite 持久化 | ✅ | `sqlite-store.ts:80-128` |
| 27 | 自定义 HTTP 头 | ✅ | `shared/types.ts:12` |
| 28 | 切换时保留对话 | ✅ | 仅清空模型列表 |

### 3. 对话历史编辑与管理

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 29 | 消息列表 + 自动滚动 | ✅ | `ChatMessages.tsx:44-46,241`（无"吸底"逻辑，向上翻看时会被流式输出拉回，体验缺陷） |
| 30 | 用户消息编辑 + editedAt | ⚠️ | 编辑按钮（非双击）；`editedAt` 已实现（`chatStore.ts:299`） |
| 31 | AI 回复编辑 | ✅ | 保存即改（`chatStore.ts:291-308`） |
| 32 | 编辑后重新生成提示 | ❌ | 编辑仅保存，无重新生成联动 |
| 33 | 删除单条 + 撤销（5s） | ⚠️ | `deleteMessage` 是**级联删除（删到会话末尾）**（`chatStore.ts:310-337`）；撤销栈**永不过期**，5s 只是 toast 显示时长 |
| 34 | 多选批量删除 | ❌ 损坏 | 级联删除语义下，选中 2、4 条删除会把 2 之后全部删光（`ChatMessages.tsx:78-91`）；批量撤销仅恢复最后一次删除 |
| 35 | 拖拽调整消息顺序 | ✅ | `chatStore.ts:358-373` |
| 36 | 从此处重新生成 | ❌ 损坏 | `regenerateFromMessage`（`chatStore.ts:607-628`）会**重复插入一条相同的用户消息**（内部再调 `sendMessage` 重新 addMessage）；HistoryEditor 的"重新运行"对用户消息取 `slice(0,msgIndex)` 导致**重跑的是上一条用户消息** |
| 37 | 分支对话 | ⚠️ | store 有 `createBranchFromMessage/switchBranch`（`chatStore.ts:635-730`），UI 为消息上的分支按钮 + 扁平 `<select>`；**无对话树可视化**；分支以 JSON 快照存进 `chat_sessions.branches`，`branch_id` 列（`sqlite-store.ts:59-63`）从未使用 |
| 38 | 对话树可视化 | ❌ | 仅下拉切换 |
| 39-41 | 导出 MD / JSON / 导入 | ⚠️ | MD✅；JSON 无分支信息；导入失败仅 console.error，无用户提示 |
| 42-43 | 历史列表（搜索/预览/删除/重命名） | ✅ | `ChatSidebar.tsx` |
| 44 | 置顶/归档 | ✅ | 右键菜单（`ChatSidebar.tsx:98-119`），持久化 |
| 45 | 会话存储 | ⚠️ | SQLite✅；**`chat_messages` 表无 toolCalls/toolResults 列（`sqlite-store.ts:107-118`），重启后所有工具调用块与结果全部丢失** |
| 46 | 会话全文搜索 | ✅ | `ChatSidebar.tsx:38-46` |
| 47 | 输入框多行 / @引用 / MD 快捷键 | ⚠️ | 多行✅、Ctrl+B/I/` ✅；**@引用调的是 `searchInFiles`（内容搜索）而非文件名搜索（`ChatInput.tsx:55`）**；"插入代码块/@引用文件/模型设置"三个工具栏按钮无 onClick（`ChatInput.tsx:230-253`） |
| 48 | Token 消耗显示 | ⚠️ | 仅启发式估算（`estimateTokens`，英文双计）；适配器返回的真实 `usage` 被丢弃（`chatStore.ts:462-480`） |

### 4. 模型筛选与拉取

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 49 | 自动获取模型列表 | ✅ | 切换配置组自动 fetch（`configStore.ts:139-142`） |
| 50 | 获取失败提示 + 重试 | ❌ | `modelsError` state 存在（`configStore.ts:204`）但**无任何组件渲染**，无重试按钮 |
| 51 | 模型缓存（TTL 1h）+ 手动刷新 | ✅ | `configStore.ts:147-181` |
| 52 | 免费模型标记 | ✅ | 关键词启发式 |
| 53 | 模型筛选 | ✅ | 免费/提供商/上下文/收藏/搜索（`ModelSelector.tsx`） |
| 54 | 下拉关键信息 | ✅ | 上下文窗口/视觉/函数调用徽标 |
| 55 | 模型对比视图 | ✅ | `ModelCompareView.tsx`（硬编码元数据表，~13 个已知模型） |
| 56-57 | 收藏 + 持久化 | ✅ | localStorage |
| 58 | 自定义模型 | ❌ | `addCustomModel/removeCustomModel`（`configStore.ts:229-253`）**无任何 UI 调用** |

### 5. System Prompt 自定义

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 59-66 | 独立 prompt / 模板(8) / 变量 / 实时预览 / 历史(20) / 恢复 | ✅ | `SettingsModal.tsx`、`configStore.ts:255-276` |
| 67 | 语法高亮编辑器 | ⚠️ | 已升级为 Monaco；**Bug：模板插入/导入/恢复历史后 `editingGroup.systemPrompt` 更新但 Monaco 实例不 `setValue`（`SettingsModal.tsx:86` 依赖未变），可视内容与保存值不一致** |
| 68 | prompt 导入/导出 | ✅ | .txt |
| 69-70 | system 角色拼接 + 实时生效 | ✅ | `chatStore.ts:416-424` |

### 6. 插件 / 扩展系统

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 71 | Extension API 类型定义 | ✅ | `plugin/types.ts` |
| 72 | 插件加载器 | ⚠️ | localStorage 存储，非目录加载 |
| 73 | Worker 沙箱 | ❌ 不可用 | `PluginManager.ts:476` 向 Worker `postMessage({api})`，**api 含函数，结构化克隆直接抛 `DataCloneError` → 任何插件都无法激活** |
| 74-76 | 编辑器/AI/UI 桥接 | ❌ | store 懒加载 getter（`PluginManager.ts:8-30`）**全项目零调用**，`_editorStore/_chatStore/_uiStore` 恒为 null → `editor.getActiveFile()` 恒 null、`ai.sendMessage` 抛 "Chat store not available" |
| 77 | 权限白名单 | ⚠️ | `confirm()` 询问 + 只读兜底；**`network` 权限从不强制，Worker 内 fetch/XHR 不受限** |
| 78 | 插件市场界面 | ⚠️ | `PluginMarketplace.tsx`：安装=粘贴 manifest+代码 或 导入 JSON 文件，非真正市场（无在线目录/更新）；插件面板/状态栏项/命令**注册后无任何 UI 读取** |
| 79 | CLI 脚手架 | ⚠️ | `tools/create-nebula-plugin` 存在（3 模板）；但 `bin` 指向裸 `.ts`（`package.json:7`）**无编译步骤无法直接运行**，未发布 npm，且品牌仍为 "Nova Studio" |
| 80 | 插件自定义快捷键 | ❌ | 空 stub |
| 81 | 安全限制 | ❌ | `sandboxCode` 模板插值注入风险（`PluginManager.ts:395-457`，插件代码含反引号/`${` 即可逃逸）；`call` 消息分支为空实现 |

### 7. UI / UX / 非功能性

| # | 功能 | 状态 | 关键证据 |
|---|------|------|----------|
| 82 | 暗/亮主题切换 | ⚠️ | 运行时切换✅；**启动不恢复：`uiStore.initTheme` 用硬编码默认 `dark`，忽略已持久化的 `preferences.theme`（App.tsx:27-28）**；system 主题无 matchMedia 监听 |
| 83 | 自定义主题色 | ❌ | `uiStore.setThemeColor` 存在但无 UI |
| 84 | 面板拖拽调整大小 | ✅ | 侧边栏/聊天/终端均支持 |
| 85 | 快捷键方案切换 | ❌ 不生效 | `shortcutStore` 仅被设置页消费，**实际按键处理硬编码在 `MainLayout.tsx:57-189`，改方案/改键零效果** |
| 86 | 核心快捷键 | ✅ | 硬编码实现 |
| 87 | 多窗口 | ⚠️ | `openNewWindow` IPC 真实存在；但所有窗口控制/终端/事件只作用于首个窗口（`main.ts:233-304`），多窗口不可用 |
| 88 | 状态栏 | ⚠️ | Git 分支/行列/编码显示✅；**编码选择器无效（`StatusBar.tsx:238-244` 只关菜单）**；配置组切换器缺失；token 数未渲染（`StatusBar.tsx:155` 计算未用）；更新 UI 全为死代码；错误/警告数硬编码 0 |
| 89 | 响应式布局 | ⚠️ | JS 断点 1024/768，无 CSS media query |
| 90 | 启动画面 | ✅ | `index.html:16-67` splash + `App.tsx:37-42` 移除 |
| 91 | AI 错误提示 + 重试 | ⚠️ | 错误作为消息显示（`chatStore.ts:595-598`），**无重试按钮** |
| 92 | 网络请求超时 | ⚠️ | `LLMClient.ts:34-47` 30s 总超时；**仅 OpenAI 系把 signal 传给 fetch，DeepSeek/Gemini/Groq/Ollama 适配器忽略 signal，超时对其无效**；且 30s 为总时长，长流式生成会被中途掐断 |
| 93 | 内存泄漏 | ⚠️ | 静态审查未见明显泄漏（effect 清理基本齐全），需运行时验证 |
| 94 | 打包体积 | ⚠️ | 主 chunk 8.9MB；未验证 electron-builder 产物 |
| 95 | 自动更新 | ⚠️ | `electron-updater` 已引入，`main.ts:431-507` 有 check/download/install IPC，**但 UI 完全不渲染更新状态/按钮** |
| 96 | 首次运行引导 | ✅ | `OnboardingModal.tsx`（欢迎 + 创建首个配置组两步） |
| 97 | 单元测试 | ✅ | 26 个用例全过 |
| 98 | E2E 测试 | ⚠️ | 4/5 过；1 个品牌断言过时 |
| 99 | 敏感信息安全 | ⚠️ | 静态存储加密✅；**但明文 API Key 发给渲染进程（`sqlite-store.ts:138`）+ 无净化 Markdown 渲染 → 见"安全风险"** |
| 100 | 重置所有设置 | ✅ | `store:resetAll` + 设置页按钮（`SettingsModal.tsx:455`） |

---

## 四、关键问题清单（按严重度）

### 🔴 P0 — 必须优先修复

1. **Markdown XSS → 任意文件读写/任意命令执行链**
   `MarkdownRenderer.tsx:41` 用 `dangerouslySetInnerHTML` 直接注入 `marked.parse()` 输出且**无任何净化**（无 DOMPurify）。AI 回复/工具结果含 `<img onerror=...>` 即可在渲染进程执行 JS，而 preload 暴露了全部文件读写、`shell:exec`（`main.ts:404-420`）、`git:exec`、`app:resolveEnvVar`。API Key 明文也在渲染进程内存中（`sqlite-store.ts:138`）。**这是完整的 RCE 链路。**

2. **多轮工具对话必现崩溃**
   `chatStore.ts:493-497` 以解析形式 `{id,name,arguments}` 存储 toolCalls，第二轮用户消息重建历史时原样传出（`chatStore.ts:418-423`），而 `OpenAIAdapter.ts:19-28` / `AnthropicAdapter.ts:53-58` 读取 `tc.function.name` → `TypeError: Cannot read properties of undefined`，以"错误"消息形式返回给用户。**任何使用工具的第二轮对话都会失败。**

3. **插件系统完全不可用**
   `PluginManager.ts:476` 向 Worker postMessage 含函数的 API 对象 → `DataCloneError`，所有插件激活失败置为 error；且即便修好克隆，底层 store getter 从不初始化，API 全是返回 null/抛错的 stub。插件市场 UI 因此只是摆设。

4. **工具调用数据不持久化**
   `chat_messages` 表无 toolCalls/toolResults 列（`sqlite-store.ts:107-118`、`244-254` 无映射），**重启后历史中的工具调用块与结果全部消失**。

5. **渲染进程权限过大 + 无路径校验**
   所有 `fs:*` handler 直接信任渲染进程传入路径（`main.ts:107-163`），无根目录白名单/路径穿越校验；`shell:exec`/`git:exec` 可执行任意命令。配合 #1 即全盘沦陷。

### 🟠 P1 — 高优修复

6. 「从此处重新生成」与 HistoryEditor「重新运行」逻辑错误（重复用户消息/重跑上一条）— `chatStore.ts:607-628`
7. 多选批量删除级联过头、批量撤销只恢复最后一次 — `ChatMessages.tsx:78-91`
8. 删除消息后 `sortOrder` 不重排，下一次 `addMessage` 产生重复序号 → 重启后消息顺序错乱 — `chatStore.ts:273,326-335`
9. AI 内联补全未接入编辑器（死代码）— `useInlineCompletion.ts`
10. 编辑器分屏无 UI 入口（store 方法零调用）
11. 配置组排序不持久化（表无 sort_order 列）
12. @引用搜索错用内容搜索（`ChatInput.tsx:55`）
13. Ctrl+N 新建文件不生成标签页、未命名文件无法保存（无 Save As）— `MainLayout.tsx:139-142`、`editorStore.ts:372`
14. Git 面板点击文件路径为仓库相对路径导致打不开 — `GitPanel.tsx:345`
15. 主题启动不恢复持久化设置（`uiStore.ts:176-180`）
16. 快捷键自定义/方案切换不生效（`shortcutStore` 无消费者）
17. 状态栏配置组切换器在重构中丢失（旧版有）
18. 模型获取失败无 UI 提示与重试（`modelsError` 未被渲染）
19. 文件树 watcher 刷新展平已展开目录 — `FileTree.tsx:41`
20. 搜索"全部替换"在 CRLF 文件上偏移漂移、已打开文件内容不刷新 — `SearchPanel.tsx:116-119`
21. 状态栏编码选择器无效；更新 UI/版本号/token 数为死代码
22. 系统 Prompt 编辑器与 state 不同步（模板/导入/恢复历史后界面不刷新）— `SettingsModal.tsx:86`

### 🟡 P2 — 体验/完善

- 30s 总超时对 5/7 家适配器无效（signal 未透传）
- 真实 token usage 被丢弃，仅启发式估算
- 流式滚动无"吸底"逻辑
- 品牌名不一致：`index.html` 标题 "Nova Studio IDE"、splash "Nova Studio"，产品名为 "OurCode IDE"（`package.json:4`），CLI 工具也仍写 Nova Studio
- 语言映射 45 种（宣称 50+）
- Monaco worker 未配置，打包环境语言服务可能降级
- 撤销栈永不过期（5s 仅为 toast）
- 工具审批 promise 无超时（不点就一直挂起）
- Agent 循环 20 次耗尽时静默退出无提示

---

## 五、安全风险汇总

| 风险 | 位置 | 等级 |
|------|------|------|
| 无净化 Markdown 渲染（XSS） | `MarkdownRenderer.tsx:41` | 高 |
| 任意路径文件读写/删除/移动（无白名单） | `main.ts:107-163` | 高 |
| `shell:exec` / `git:exec` 任意命令执行 | `main.ts:394-420` | 高 |
| `app:resolveEnvVar` 暴露任意环境变量 | `main.ts:389-391` | 中 |
| API Key 明文下发渲染进程 | `sqlite-store.ts:138` | 中 |
| 插件模板字符串注入 + network 权限不强制 | `PluginManager.ts:395-457` | 中 |
| 用户正则 ReDoS（搜索、未设上限的递归目录树） | `main.ts:335-347`、`helpers.ts:40-56` | 低-中 |
| `sandbox: false` + 宽 IPC 面 | `main.ts:44` | 中 |

---

## 六、建议优先级

**第一批（安全 + 崩溃，1-2 天）**
1. Markdown 渲染接入 DOMPurify 净化（并移除内联 onclick，改事件委托）
2. 修复多轮工具对话 toolCalls 格式不匹配（统一 raw/parsed 两种形态，或重建历史时转回 raw）
3. `chat_messages` 表增加 toolCalls/toolResults 列（含迁移），持久化工具数据
4. 为 `fs:*`/`shell:exec`/`git:exec` 增加根目录白名单与命令校验

**第二批（核心功能修复，2-3 天）**
5. 修复 regenerateFromMessage / 批量删除 / sortOrder 逻辑
6. 修复内联补全接入、Ctrl+N 新建文件、Save As、Git 面板路径
7. 配置组排序持久化（加列 + 迁移）、模型错误 UI、主题启动恢复、状态栏配置切换器

**第三批（补齐宣称能力）**
8. 分屏 UI 入口、插件系统重建（修复 DataCloneError + store 初始化）、快捷键真正绑定
9. lint 依赖声明修复（package.json 补 eslint 并跑通）；清理死代码（`Sidebar/SearchPanel.tsx`、`useInlineCompletion` 或接入）
10. 品牌统一（OurCode vs Nova Studio）

---

---

## 附：2026-08-04 修复记录

本轮已修复（P0 + P1 高价值），改动文件清单：

| 类别 | 修复内容 | 涉及文件 |
|------|----------|----------|
| P0 安全 | Markdown 渲染接入 DOMPurify 净化；代码复制按钮改事件委托（移除 CSP 拦截的内联 onclick） | `src/components/Common/MarkdownRenderer.tsx`、`package.json`（+dompurify） |
| P0 崩溃 | 多轮工具对话 toolCalls 格式不匹配（parsed↔raw），新增 `toRawToolCalls()` 历史重建时转换 | `src/stores/chatStore.ts` |
| P0 数据 | `chat_messages` 表新增 `tool_calls`/`tool_results` 列（含迁移），工具数据重启不再丢失 | `electron/services/sqlite-store.ts` |
| P0 安全 | IPC 路径白名单（仅允许用户打开的目录/文件）+ `shell:exec`/`git:exec` cwd 校验 + 环境变量名格式校验 | `electron/main.ts` |
| P1 | 删除改为单条删除 + sortOrder 重排；批量删除一次完成（单条撤销记录）；撤销 5s 时效；「重新生成/重跑」修复重复插入与重跑上一条 | `src/stores/chatStore.ts`、`ChatMessage.tsx`、`ChatMessages.tsx` |
| P1 | @引用改为文件名搜索（新增 `search:files` IPC） | `electron/main.ts`、`electron/preload.ts`、`src/types/index.ts`、`ChatInput.tsx` |
| P1 | 主题启动时恢复持久化设置 | `src/stores/uiStore.ts`、`src/App.tsx` |
| P1 | 模型获取失败显示错误 + 重试按钮 | `src/components/ChatPanel/ModelSelector.tsx` |
| P1 | 配置组排序持久化（`sort_order` 列 + 查询排序） | `electron/services/sqlite-store.ts`、`src/stores/configStore.ts` |
| P1 | 状态栏新增配置组切换器 | `src/components/Layout/StatusBar.tsx` |
| P1 | 「全部替换」后刷新已打开的编辑器 | `src/components/SearchPanel/SearchPanel.tsx` |
| P1 | System Prompt 编辑器与 state 同步（模板/导入/历史恢复） | `src/components/Settings/SettingsModal.tsx` |
| P1 | Git 面板文件路径解析为绝对路径 | `src/components/Git/GitPanel.tsx` |
| 工具链 | 补齐 eslint 及插件声明，`npm run lint` 从"无法运行"变为 0 error（66 个既有 warning 保留） | `package.json` |

**验证结果（修复后）**：typecheck ✅ ｜ build ✅（14.1s）｜ 单测 26/26 ✅ ｜ lint 0 error ✅ ｜ e2e 4/5（仅剩 1 条品牌文案断言失败，属范围外遗留）。

**仍遗留（不在本轮范围）**：插件系统重建、多窗口、快捷键真实绑定、e2e 品牌断言更新。

---

## 附：2026-08-05 第二轮修复记录（收尾轮）

| 类别 | 修复内容 | 涉及文件 |
|------|----------|----------|
| 功能 | **Ctrl+N 新建文件**真正创建标签页（此前直接 setState 绕过 panels，标签不显示）；**未命名文件支持另存为**（Ctrl+S 弹保存对话框，标签迁移到真实路径） | `src/stores/editorStore.ts`、`MainLayout.tsx`、`CommandPalette.tsx` |
| 功能 | **AI 内联补全接入编辑器**（此前为死代码）：EditorContainer 用 state 持有 editor 触发 hook，右键菜单新增"AI: 内联补全"手动触发 | `src/components/Editor/EditorContainer.tsx` |
| 功能 | **编辑器分屏 UI 入口**：TabBar 新增左右/上下分屏 + 关闭分屏按钮；Ctrl+\\ 分屏、Ctrl+Shift+\\ 切换焦点；命令面板新增 4 条分屏命令（此前 store 已实现但零调用） | `TabBar.tsx`、`MainLayout.tsx`、`CommandPalette.tsx` |
| 修复 | **文件树 watcher 刷新不再展平**：刷新时递归重载已展开目录的 children | `src/components/Sidebar/FileTree.tsx` |
| 修复 | **状态栏编码切换生效**：选择编码后按新编码重新保存（`setFileEncoding`） | `StatusBar.tsx`、`editorStore.ts` |
| 健壮性 | 工具审批 60s 自动拒绝（不再永久挂起）；Agent 循环 20 轮耗尽时追加提示消息 | `chatStore.ts` |
| 健壮性 | 30s 超时透传 DeepSeek/Gemini/Groq/Ollama 适配器（此前只有 OpenAI 系生效） | `src/services/llm/adapters/*.ts` |
| 品牌 | **统一为 OurCode**：窗口标题、splash、聊天助手名、CLI 脚手架文案；**e2e 品牌断言改为主进程取窗口标题**（绕过 DevTools 窗口竞态） | `index.html`、`ChatMessages.tsx`、`e2e/chat-flow.spec.ts`、`tools/create-nebula-plugin/*` |

**验证结果（第二轮后）**：typecheck ✅ ｜ build ✅（15.1s）｜ 单测 26/26 ✅ ｜ lint 0 error ✅ ｜ **e2e 5/5 全绿**（此前 4/5）。

**仍遗留（大项）**：插件系统重建、多窗口、快捷键真实绑定（shortcutStore 仅设置 UI 不生效）。

---

## 附：2026-08-05 第三轮修复记录（多窗口 + 快捷键真实绑定）

| 类别 | 修复内容 | 涉及文件 |
|------|----------|----------|
| 多窗口 | **所有 IPC 由 `mainWindow` 写死改为 `event.sender` 定位对应窗口**：窗口控制（最小化/最大化/关闭/DevTools/最大化状态）、对话框父窗口、终端（每个终端归属创建它的窗口，数据/退出事件发回该窗口，窗口关闭时清理其终端）、`fs:fileChanged` 与更新事件改为向所有窗口广播 | `electron/main.ts` |
| 多窗口 | 最大化事件改为每窗口独立推送；**TitleBar 最大化按钮图标实时反映本窗口状态**（isMaximized + onMaximized）；顺带修复菜单"新建文件"（此前误用 `openFile` 读伪路径必失败） | `TitleBar.tsx` |
| 快捷键 | 新增 `matchesShortcut()`（精确匹配 Ctrl/Shift/Alt，Ctrl 兼容 Cmd；**Shift 精确匹配避免 Ctrl+N 误触 Ctrl+Shift+N**）；**MainLayout 按键处理改为从 shortcutStore 实时读取绑定**——设置里改预设/自定义立即生效，并新增 openFolder/newChatSession 快捷键绑定 | `src/stores/shortcutStore.ts`、`MainLayout.tsx` |
| 快捷键 | 应用启动时加载持久化快捷键（此前仅在打开设置时加载，重启后自定义绑定丢失） | `src/App.tsx` |
| 修复 | TitleBar"新窗口"菜单移除与 `newChatSession`(Ctrl+Shift+N) 冲突的错误快捷键提示 | `TitleBar.tsx` |
| 测试 | 新增 `shortcutStore.test.ts`（10 例，覆盖 Shift 精确匹配/Alt/功能键/标点/Cmd 兼容） | `src/__tests__/shortcutStore.test.ts` |

**过程中修复的回归**：多窗口改造在窗口 `closed` 事件里访问已销毁的 `win.webContents` 抛 "Object has been destroyed"（主进程崩溃）——改为在 `attachWindowLifecycle` 时提前捕获 `webContents.id`。

**验证结果（第三轮后）**：typecheck ✅ ｜ build ✅（13s）｜ 单测 **36/36** ✅（含新增 10 例）｜ lint 0 error ✅ ｜ **e2e 5/5** ✅（10.9s）。

**仍遗留（唯一大项）**：插件系统重建（DataCloneError + ExtensionAPI 桥接 + 权限强制）。




| 旧版（05-28） | 现状 |
|---------------|------|
| 无测试（#97/#98 ❌） | 单元测试 26/26 ✅、e2e 4/5 ⚠️ |
| 首次引导 ❌ | OnboardingModal ✅ |
| 插件市场 ❌ | 本地插件管理器 ⚠️（系统仍不可用） |
| CLI 脚手架 ❌ | tools/create-nebula-plugin ⚠️（裸 TS 不可直接运行） |
| 编辑器分屏 ❌ | store 已实现但**无入口**（仍不可用） |
| AI 内联补全 ✅（旧版称已实现） | **实际为死代码，未接入**（本次审查修正） |
| 状态栏配置切换 ✅ | 重构后**丢失**（回归） |
| System Prompt 语法高亮 ❌ | 已升级 Monaco（但有同步 Bug） |
| 重置设置 ❌ | ✅（`store:resetAll`） |
| 自动更新 ❌ | 主进程已接线，UI 未接（仍不可用） |
