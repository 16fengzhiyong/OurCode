# OurCode IDE - 需求符合性审查报告

## 审查概要

| 指标 | 数量 |
|------|------|
| 总需求数 | 100 |
| 已实现 (✅) | 53 |
| 部分实现 (⚠️) | 23 |
| 未实现 (❌) | 24 |
| 实现率 | 53% |

---

## 第1步：差距分析报告

### 一、文件与目录管理（12项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 1 | 文件树无限层级展开/折叠 + 图标 | ✅ 已实现 | `src/components/Sidebar/FileTree.tsx:76-91` `src/components/Sidebar/FileTreeNode.tsx:154-218` `src/utils/fileIcons.ts:77-93` | - |
| 2 | 右键菜单（新建/重命名/删除/复制路径） | ✅ 已实现 | `src/components/Sidebar/FileTreeNode.tsx:38-152` | 新建文件/文件夹、重命名、删除、复制路径、剪切/复制/粘贴均实现 |
| 3 | 拖拽移动文件和文件夹 | ❌ 未实现 | - | FileTreeNode定义了`dragSource`模块变量但未绑定任何拖拽事件处理器，无`onDragStart`/`onDragOver`/`onDrop` |
| 4 | 多标签页 + 标签拖拽重排 | ✅ 已实现 | `src/components/Editor/TabBar.tsx:25-40` `src/stores/editorStore.ts:117-124` | HTML5拖拽实现标签重排 |
| 5 | 编辑器分屏（左右/上下/多分屏） | ❌ 未实现 | - | `EditorContainer`为单一实例，无分屏逻辑，`MainLayout`中编辑区为单个`flex-1` |
| 6 | Monaco语法高亮（50+语言）+ 代码折叠 | ⚠️ 部分实现 | `src/stores/editorStore.ts:179-182` `shared/constants.ts:93-130` | Monaco内置折叠✅；但`LANGUAGE_MAP`仅覆盖~30种语言，未达50+ |
| 7 | 代码补全（本地词法 + AI远程） | ✅ 已实现 | `src/hooks/useInlineCompletion.ts:15-196` `src/components/Editor/EditorContainer.tsx:43-69` | Monaco内置本地补全 + AI远程内联补全（Tab接受/Esc拒绝） |
| 8 | 编辑器快捷键 | ✅ 已实现 | `src/components/Layout/MainLayout.tsx:46-96` | Ctrl+S保存、Ctrl+F查找、Ctrl+H替换、Ctrl+Z撤销(Monaco内置) |
| 9 | Git面板（变更列表/暂存/提交/推送/拉取） | ✅ 已实现 | `src/components/Git/GitPanel.tsx:18-492` | 完整实现：状态列表、暂存/取消暂存、提交、推送、拉取、日志 |
| 10 | Git差异对比（side-by-side） | ✅ 已实现 | `src/components/Git/GitPanel.tsx:159-194` `src/components/Editor/DiffView.tsx:11-64` | Monaco diff editor, renderSideBySide: true |
| 11 | 终端集成（xterm.js）多标签 | ⚠️ 部分实现 | `src/components/Terminal/TerminalPanel.tsx:19-257` | 多标签终端✅，拖拽调整大小✅，无分屏终端❌ |
| 12 | 全局搜索替换（正则/文件类型过滤/排除文件夹） | ⚠️ 部分实现 | `src/components/SearchPanel/SearchPanel.tsx:5-279` | 正则搜索✅、区分大小写✅、全词匹配✅、替换✅；无文件类型过滤❌、无排除文件夹❌ |

### 二、多API配置组系统（16项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 13 | 创建多个API配置组 | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:48-51` `src/stores/configStore.ts:84-105` | - |
| 14 | 独立设置名称/颜色/提供商 | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:124-133,219-223` | 8种提供商、8种颜色标签 |
| 15 | 独立设置API Endpoint | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:136-139` | - |
| 16 | API Key加密存储（AES-256-GCM） | ✅ 已实现 | `electron/services/crypto.ts:10-49` `electron/services/sqlite-store.ts:111-155` | AES-256-GCM + machineId派生密钥 |
| 17 | API Key环境变量读取 | ✅ 已实现 | `src/stores/configStore.ts:7-16` `src/components/Settings/SettingsModal.tsx:228` | $VAR格式 |
| 18 | 连接测试 + 结果显示 | ✅ 已实现 | `src/stores/configStore.ts:229-245` `src/components/Settings/SettingsModal.tsx:70-74,292` | 成功/失败及消息 |
| 19 | 状态栏快速切换配置组 | ✅ 已实现 | `src/components/Layout/StatusBar.tsx:196-234` | 下拉菜单切换 |
| 20 | 切换时System Prompt/模型/AI客户端同步 | ✅ 已实现 | `src/stores/configStore.ts:131-134` | 切换时清空models并重新fetch |
| 21 | 导出配置组（JSON，密钥加密） | ⚠️ 部分实现 | `src/stores/configStore.ts:247-253` | 导出时用`***`掩码代替密钥，而非加密导出 |
| 22 | 导入配置组 + 主密码解密 | ❌ 未实现 | `src/stores/configStore.ts:255-266` | 导入存在但无加密/解密机制，跳过`***`密钥的组 |
| 23 | 配置组排序 | ❌ 未实现 | - | 无拖拽排序、无上移/下移按钮 |
| 24 | 默认配置组 + 首次启动引导 | ❌ 未实现 | - | 无onboarding流程，无默认配置组自动创建 |
| 25 | 删除配置组 + 确认提示 | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:76-78` | confirm()确认 |
| 26 | 数据持久化（SQLite） | ✅ 已实现 | `electron/services/sqlite-store.ts:9-307` | better-sqlite3 |
| 27 | 自定义HTTP请求头 | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:224-227` `shared/types.ts:12` | customHeaders字段 |
| 28 | 切换时对话上下文保留 | ✅ 已实现 | `src/stores/configStore.ts:131-134` | 仅清空模型列表，不影响会话 |

### 三、对话历史编辑与管理（20项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 29 | 完整消息列表 + 自动滚动 | ✅ 已实现 | `src/components/ChatPanel/ChatMessages.tsx:44-46,160-184` | messagesEndRef滚动 |
| 30 | 用户消息双击编辑 + editedAt | ⚠️ 部分实现 | `src/components/ChatPanel/ChatMessage.tsx:16-29,214-231` | 使用编辑按钮而非双击；editedAt字段已实现 |
| 31 | AI回复支持编辑 | ✅ 已实现 | `src/components/ChatPanel/ChatMessage.tsx:136-146` | 用户和AI消息均可编辑 |
| 32 | 编辑后自动重新生成/提示 | ❌ 未实现 | - | 编辑后仅保存，无重新生成机制，无后续上下文更新提示 |
| 33 | 删除单条消息 + 撤销（5秒） | ✅ 已实现 | `src/stores/chatStore.ts:233-280` `src/components/ChatPanel/ChatMessages.tsx:213-233` | Undo栈 + 5秒toast |
| 34 | 多选消息批量删除 | ✅ 已实现 | `src/components/ChatPanel/ChatMessages.tsx:20-21,78-100,105-125` | 多选模式 + 批量删除 |
| 35 | 拖拽消息调整顺序 | ✅ 已实现 | `src/components/ChatPanel/ChatMessages.tsx:48-72,160-184` | HTML5 DnD + reorderMessages |
| 36 | "从此处重新生成" | ✅ 已实现 | `src/components/ChatPanel/ChatMessage.tsx:37-39,147-158` `src/stores/chatStore.ts:420-441` | regenerateFromMessage |
| 37 | 分支对话（对话树） | ❌ 未实现 | - | ChatSession为线性消息数组，无分支字段，无分支逻辑 |
| 38 | 对话树可视化 + 分支切换 | ❌ 未实现 | - | 同上 |
| 39 | 导出Markdown | ✅ 已实现 | `src/stores/chatStore.ts:447-468` `src/components/ChatPanel/ChatSidebar.tsx:58-67` | 含角色标识和代码块 |
| 40 | 导出JSON（含分支信息） | ⚠️ 部分实现 | `src/stores/chatStore.ts:451-453` | 导出JSON存在但无分支信息（因分支功能未实现） |
| 41 | 导入JSON + 还原分支 | ⚠️ 部分实现 | `src/stores/chatStore.ts:470-486` | 基础导入✅，分支还原❌ |
| 42 | 对话历史列表（搜索/预览/删除） | ✅ 已实现 | `src/components/ChatPanel/ChatSidebar.tsx:9-276` | 搜索标题和内容、预览摘要、删除 |
| 43 | 对话重命名 | ✅ 已实现 | `src/components/ChatPanel/ChatSidebar.tsx:51-56` `src/stores/chatStore.ts:172-179` | - |
| 44 | 对话置顶/归档 | ❌ 未实现 | - | ChatSession无pinned/archived字段 |
| 45 | 对话数据存储 + AES加密（可选） | ⚠️ 部分实现 | `electron/services/sqlite-store.ts:168-268` | SQLite存储✅，会话数据未加密❌ |
| 46 | 对话全文搜索 | ✅ 已实现 | `src/components/ChatPanel/ChatSidebar.tsx:24-37,110-124` | 搜索消息内容 + 摘要显示 |
| 47 | 输入框多行/Markdown快捷键/@引用 | ⚠️ 部分实现 | `src/components/ChatPanel/ChatInput.tsx:6-232` | 多行✅、@引用✅、无Markdown快捷键❌ |
| 48 | Token消耗量显示 | ✅ 已实现 | `src/components/ChatPanel/ChatMessages.tsx:24-33` `src/components/Layout/StatusBar.tsx:268-272` | 每条消息tokenCount + 上下文窗口警告 + 状态栏显示 |

### 四、模型筛选与自动拉取（10项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 49 | 自动获取模型列表（/models） | ✅ 已实现 | `src/stores/configStore.ts:141-184` `src/services/llm/LLMClient.ts:35-38` | 切换配置组时自动调用 |
| 50 | 模型获取失败错误提示 + 重试 | ⚠️ 部分实现 | `src/stores/configStore.ts:180-183` | 仅console.error，无UI错误提示和重试按钮 |
| 51 | 模型缓存（TTL 1小时）+ 手动刷新 | ✅ 已实现 | `src/stores/configStore.ts:147-159` | 1小时TTL + 刷新按钮 |
| 52 | 自动标记免费模型 | ✅ 已实现 | `src/stores/configStore.ts:153-155` `src/components/ChatPanel/ModelSelector.tsx:97,213-215` | 关键词匹配 + "免费"标签 |
| 53 | 模型筛选（免费/提供商/上下文窗口） | ⚠️ 部分实现 | `src/components/ChatPanel/ModelSelector.tsx:34-64` | 免费筛选✅、收藏筛选✅、搜索✅；无提供商筛选❌、无上下文窗口筛选❌ |
| 54 | 模型下拉显示关键信息 | ⚠️ 部分实现 | `src/components/ChatPanel/ModelSelector.tsx:95-99` | 仅显示名称和免费标记；无上下文窗口/视觉/函数调用信息 |
| 55 | 模型对比视图 | ✅ 已实现 | `src/components/ChatPanel/ModelCompareView.tsx:1-131` | 并排对比表（上下文窗口/定价/视觉/函数调用） |
| 56 | 收藏模型 + 置顶 | ✅ 已实现 | `src/components/ChatPanel/ModelSelector.tsx:56-63,197-206` | 收藏优先排序 |
| 57 | 收藏持久化 | ✅ 已实现 | `src/stores/configStore.ts:61,192-204` | localStorage |
| 58 | 手动添加自定义模型 | ❌ 未实现 | - | 无自定义模型添加UI |

### 五、System Prompt自定义（12项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 59 | 每个配置组独立System Prompt | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:148-156` | - |
| 60 | 切换配置组自动加载 | ✅ 已实现 | `src/stores/configStore.ts:131-134` | - |
| 61 | 预设模板选择器（≥5个） | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:8-17` | 8个模板 |
| 62 | 变量支持 {{language}}等 | ✅ 已实现 | `src/stores/chatStore.ts:28-58` | 6个变量 + {{date}} |
| 63 | 变量真实替换 | ✅ 已实现 | `src/stores/chatStore.ts:28-58,335-339` | 发送前解析 |
| 64 | 实时预览 | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:186-205` | Preview按钮 + 变量高亮 |
| 65 | 修改历史（≥20版本） | ✅ 已实现 | `src/stores/configStore.ts:206-216` | 最多20版 |
| 66 | 历史版本恢复 | ✅ 已实现 | `src/stores/configStore.ts:222-227` `src/components/Settings/SettingsModal.tsx:206-215` | - |
| 67 | 语法高亮编辑器 | ❌ 未实现 | `src/components/Settings/SettingsModal.tsx:156` | 使用普通textarea，无语法高亮 |
| 68 | 导入/导出System Prompt | ✅ 已实现 | `src/components/Settings/SettingsModal.tsx:164-185` | .txt导出/导入 |
| 69 | system角色消息正确拼接 | ✅ 已实现 | `src/stores/chatStore.ts:335-339` | messages.unshift |
| 70 | 实时生效 | ✅ 已实现 | - | 每次请求使用最新prompt |

### 六、插件/扩展系统（11项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 71 | Extension API接口定义 | ✅ 已实现 | `src/services/plugin/types.ts:78-127` | 完整TypeScript类型 |
| 72 | 插件加载器 | ⚠️ 部分实现 | `src/services/plugin/PluginManager.ts:11-298` | 使用localStorage存储插件代码，非从`plugins/`目录加载 |
| 73 | 独立Web Worker沙箱 | ✅ 已实现 | `src/services/plugin/PluginManager.ts:177-226` | createSandboxedWorker |
| 74 | 插件访问编辑器内容 | ❌ 未实现 | `src/services/plugin/PluginManager.ts:132-142` | API方法全部返回null或空实现 |
| 75 | 插件注册AI对话钩子 | ❌ 未实现 | `src/services/plugin/PluginManager.ts:150-152` | ai.sendMessage返回空字符串 |
| 76 | 插件注册自定义UI面板 | ❌ 未实现 | `src/services/plugin/PluginManager.ts:153-158` | ui.registerPanel为空函数 |
| 77 | 权限白名单 | ⚠️ 部分实现 | `src/services/plugin/types.ts:24-36` `src/services/plugin/PluginManager.ts:237-241` | 类型定义✅，但requestPermissions直接授予所有权限 |
| 78 | 插件市场界面 | ❌ 未实现 | - | 无浏览/搜索/安装/更新/卸载UI |
| 79 | CLI脚手架工具 | ❌ 未实现 | - | 无create-nebula-plugin命令 |
| 80 | 自定义快捷键 | ❌ 未实现 | `src/services/plugin/PluginManager.ts:164-166` | keybindings.registerKeybinding为空函数 |
| 81 | 安全限制 | ⚠️ 部分实现 | `src/services/plugin/PluginManager.ts:177-226` | Worker沙箱存在，但权限检查未实际执行 |

### 七、UI/UX与非功能性需求（19项）

| # | 需求描述 | 状态 | 证据 | 缺失说明 |
|---|---------|------|------|---------|
| 82 | 暗色/亮色主题切换 | ✅ 已实现 | `src/stores/uiStore.ts:131-139` `src/components/Settings/SettingsModal.tsx:326-330` | dark/light/system |
| 83 | 自定义主题色 | ❌ 未实现 | - | 无颜色选择器，主题色为硬编码CSS变量 |
| 84 | 面板拖拽调整大小 | ✅ 已实现 | `src/components/Layout/MainLayout.tsx:119-144` | 侧边栏+聊天面板拖拽调整 |
| 85 | 快捷键方案切换 | ✅ 已实现 | `src/stores/shortcutStore.ts:1-134` | VS Code/JetBrains/Custom |
| 86 | 核心操作快捷键 + 可自定义 | ✅ 已实现 | `src/stores/shortcutStore.ts:14-59` | 20个快捷键 + 自定义编辑 |
| 87 | 多窗口支持 | ❌ 未实现 | - | 单窗口架构 |
| 88 | 状态栏信息 | ✅ 已实现 | `src/components/Layout/StatusBar.tsx:6-276` | Git分支、编码、行列号、配置组、模型、Token |
| 89 | 响应式布局 | ✅ 已实现 | `src/components/Layout/MainLayout.tsx:42-43,116,150-174` | compact/narrow断点 |
| 90 | 启动画面 | ❌ 未实现 | - | 无splash screen |
| 91 | AI请求错误提示 + 重试 | ⚠️ 部分实现 | `src/stores/chatStore.ts:398-413` | 错误显示为消息，无重试按钮 |
| 92 | 网络请求超时 | ⚠️ 部分实现 | `electron/main.ts:12` | Git请求15s超时；LLM请求无显式超时 |
| 93 | 内存泄漏检查 | ⚠️ 无法验证 | - | useEffect清理基本到位，需运行时profiler验证 |
| 94 | 打包体积 | ⚠️ 无法验证 | - | 需实际构建验证 |
| 95 | 自动更新 | ❌ 未实现 | - | package.json无electron-updater依赖 |
| 96 | 首次运行引导 | ❌ 未实现 | - | 无onboarding流程 |
| 97 | 单元测试 | ❌ 未实现 | - | 无测试文件、无测试框架依赖 |
| 98 | E2E测试 | ❌ 未实现 | - | 无Playwright/Cypress |
| 99 | 敏感信息安全 | ✅ 已实现 | `electron/services/crypto.ts:10-49` `electron/services/sqlite-store.ts:96-109` | AES-256-GCM加密 + UI掩码 |
| 100 | 重置所有设置 | ❌ 未实现 | - | 无清除数据功能 |

---

## 第2步：依赖分析

### 底层依赖关系

```
shared/types.ts ← 被所有store和组件引用（修改需谨慎）
shared/constants.ts ← 被所有store引用
```

### 待完成功能的文件依赖关系

| 功能模块 | 依赖的底层服务 | 状态 |
|---------|--------------|------|
| 文件拖拽 (#3) | electronAPI.move() ✅ | 底层就绪，仅缺UI |
| 编辑器分屏 (#5) | Monaco Editor ✅ | 需改造EditorContainer架构 |
| 对话分支 (#37-38) | chatStore + ChatMessage | 需重构ChatSession类型 |
| 插件完整实现 (#74-76) | ExtensionAPI类型 ✅ | 需桥接编辑器/AI/UI到Worker |
| 配置组排序 (#23) | configStore | 需添加sortOrder字段 |
| 导入导出加密 (#21-22) | crypto.ts ✅ | 需定义主密码机制 |
| 测试 (#97-98) | 全项目 | 需安装测试框架 |

---

## 第3步：任务拆分

### 任务清单（按优先级排序，无冲突设计）

#### P0 - 核心功能补全

```json
[
  {
    "taskId": "T-01",
    "taskName": "类型系统扩展",
    "priority": "P0",
    "description": "扩展shared/types.ts和shared/constants.ts，为后续任务提供类型基础。添加：ChatSession.branchId/pinnedAt/archivedAt字段、ApiConfigGroup.sortOrder字段、ModelInfo.contextWindow/vision/functionCall字段、LANGUAGE_MAP扩充至50+语言。",
    "filesToModify": [
      "OurCode-ide/shared/types.ts",
      "OurCode-ide/shared/constants.ts"
    ],
    "acceptanceCriteria": [
      "ChatSession新增可选字段branchId, pinnedAt, archivedAt",
      "ModelInfo新增contextWindow, vision, functionCall字段",
      "LANGUAGE_MAP覆盖至少50种语言",
      "ApiConfigGroup新增可选sortOrder字段"
    ],
    "estimatedLines": 120,
    "dependencies": []
  },
  {
    "taskId": "T-02",
    "taskName": "对话分支系统",
    "priority": "P0",
    "description": "实现对话树分支功能：在任意消息处创建分支、分支数据存储、分支切换、分支可视化指示器。chatStore添加branchSession/switchBranch方法，ChatMessage添加分支按钮。",
    "filesToModify": [
      "OurCode-ide/src/stores/chatStore.ts",
      "OurCode-ide/src/components/ChatPanel/ChatMessage.tsx",
      "OurCode-ide/src/components/ChatPanel/ChatMessages.tsx",
      "OurCode-ide/electron/services/sqlite-store.ts"
    ],
    "acceptanceCriteria": [
      "在任意消息处可创建分支",
      "分支数据正确存储到SQLite",
      "可在分支间自由切换",
      "消息旁显示分支指示器",
      "导出JSON包含分支信息"
    ],
    "estimatedLines": 350,
    "dependencies": ["T-01"]
  },
  {
    "taskId": "T-03",
    "taskName": "编辑器分屏功能",
    "priority": "P0",
    "description": "实现编辑器左右/上下分屏功能。改造EditorContainer支持多个Monaco编辑器实例，TabBar对应分屏组，支持拖拽标签到不同分屏。",
    "filesToModify": [
      "OurCode-ide/src/components/Editor/EditorContainer.tsx",
      "OurCode-ide/src/components/Editor/TabBar.tsx",
      "OurCode-ide/src/stores/editorStore.ts",
      "OurCode-ide/src/components/Layout/MainLayout.tsx"
    ],
    "acceptanceCriteria": [
      "支持左右分屏和上下分屏",
      "每个分屏有独立的TabBar",
      "标签可拖拽到不同分屏",
      "分屏比例可拖拽调整",
      "最多支持4个分屏"
    ],
    "estimatedLines": 400,
    "dependencies": []
  },
  {
    "taskId": "T-04",
    "taskName": "文件树拖拽移动",
    "priority": "P0",
    "description": "为FileTree节点添加拖拽移动功能，支持同目录排序和跨目录移动。使用HTML5 Drag & Drop API，调用已有的electronAPI.move()。",
    "filesToModify": [
      "OurCode-ide/src/components/Sidebar/FileTreeNode.tsx",
      "OurCode-ide/src/components/Sidebar/FileTree.tsx"
    ],
    "acceptanceCriteria": [
      "文件/文件夹可拖拽到其他文件夹",
      "拖拽时显示放置目标高亮",
      "拖拽后文件系统实际移动",
      "拖拽结束自动刷新文件树"
    ],
    "estimatedLines": 150,
    "dependencies": []
  },
  {
    "taskId": "T-05",
    "taskName": "全局搜索增强",
    "priority": "P0",
    "description": "增强SearchPanel：添加文件类型过滤（如*.ts, *.json）、排除文件夹（如node_modules, .git）功能。修改IPC搜索接口支持新选项。",
    "filesToModify": [
      "OurCode-ide/src/components/SearchPanel/SearchPanel.tsx",
      "OurCode-ide/electron/main.ts",
      "OurCode-ide/electron/preload.ts",
      "OurCode-ide/src/types/index.ts"
    ],
    "acceptanceCriteria": [
      "搜索框下方添加文件类型过滤输入",
      "支持glob模式如*.ts, *.tsx",
      "可配置排除文件夹列表",
      "默认排除node_modules, .git, dist"
    ],
    "estimatedLines": 120,
    "dependencies": []
  },
  {
    "taskId": "T-06",
    "taskName": "模型信息增强 + 自定义模型",
    "priority": "P0",
    "description": "增强模型系统：下拉框显示上下文窗口/视觉/函数调用信息；添加模型上下文窗口筛选；支持在设置中手动添加自定义模型。",
    "filesToModify": [
      "OurCode-ide/src/components/ChatPanel/ModelSelector.tsx",
      "OurCode-ide/src/components/ChatPanel\ModelCompareView.tsx",
      "OurCode-ide/src/stores/configStore.ts",
      "OurCode-ide/src/components/Settings/SettingsModal.tsx"
    ],
    "acceptanceCriteria": [
      "模型下拉显示上下文窗口大小",
      "支持按上下文窗口大小筛选",
      "提供商筛选器可正常工作",
      "设置中可手动添加自定义模型",
      "自定义模型持久化存储"
    ],
    "estimatedLines": 200,
    "dependencies": ["T-01"]
  }
]
```

#### P1 - 重要功能完善

```json
[
  {
    "taskId": "T-07",
    "taskName": "消息编辑体验优化",
    "priority": "P1",
    "description": "改进消息编辑：双击进入编辑模式（替代按钮）；编辑保存后显示'重新生成'提示按钮；编辑AI消息后自动上下文更新提示。",
    "filesToModify": [
      "OurCode-ide/src/components/ChatPanel/ChatMessage.tsx"
    ],
    "acceptanceCriteria": [
      "双击消息气泡进入编辑模式",
      "编辑用户消息后显示'重新生成后续回复'按钮",
      "点击该按钮自动从编辑消息处重新生成",
      "editedAt标记正确显示"
    ],
    "estimatedLines": 100,
    "dependencies": []
  },
  {
    "taskId": "T-08",
    "taskName": "对话置顶与归档",
    "priority": "P1",
    "description": "为对话列表添加置顶和归档功能。ChatSession添加pinnedAt和archivedAt字段，ChatSidebar显示置顶对话在顶部，归档对话可折叠。",
    "filesToModify": [
      "OurCode-ide/src/components/ChatPanel/ChatSidebar.tsx",
      "OurCode-ide/src/stores/chatStore.ts"
    ],
    "acceptanceCriteria": [
      "对话右键菜单可置顶/取消置顶",
      "置顶对话显示在列表最上方",
      "对话可归档并从默认列表隐藏",
      "可切换显示归档对话",
      "数据持久化"
    ],
    "estimatedLines": 150,
    "dependencies": ["T-01"]
  },
  {
    "taskId": "T-09",
    "taskName": "配置组排序 + 导出导入加密",
    "priority": "P1",
    "description": "配置组排序（拖拽排序）；导出时API Key真正加密（而非掩码），导入时需输入主密码解密。",
    "filesToModify": [
      "OurCode-ide/src/stores/configStore.ts",
      "OurCode-ide/src/components/Settings/SettingsModal.tsx"
    ],
    "acceptanceCriteria": [
      "配置组列表支持拖拽排序",
      "排序结果持久化",
      "导出JSON中API Key使用AES加密",
      "导入时弹出主密码输入框",
      "密码正确才能解密并导入"
    ],
    "estimatedLines": 200,
    "dependencies": ["T-01"]
  },
  {
    "taskId": "T-10",
    "taskName": "终端分屏 + 搜索增强",
    "priority": "P1",
    "description": "终端面板支持左右分屏显示两个终端；SearchPanel添加文件类型过滤和排除文件夹。",
    "filesToModify": [
      "OurCode-ide/src/components/Terminal/TerminalPanel.tsx"
    ],
    "acceptanceCriteria": [
      "终端可左右分屏",
      "分屏终端各自独立",
      "拖拽中间分隔条调整比例"
    ],
    "estimatedLines": 200,
    "dependencies": []
  },
  {
    "taskId": "T-11",
    "taskName": "System Prompt编辑器增强",
    "priority": "P1",
    "description": "将System Prompt编辑器从textarea升级为带语法高亮的编辑器（使用Monaco或CodeMirror），支持Markdown预览。",
    "filesToModify": [
      "OurCode-ide/src/components/Settings/SettingsModal.tsx"
    ],
    "acceptanceCriteria": [
      "System Prompt编辑框支持语法高亮",
      "支持Markdown实时预览模式",
      "编辑器保持变量提示功能"
    ],
    "estimatedLines": 150,
    "dependencies": []
  },
  {
    "taskId": "T-12",
    "taskName": "模型获取错误处理 + 超时",
    "priority": "P1",
    "description": "模型列表获取失败时显示友好错误提示和重试按钮；所有LLM请求设置30秒超时并有超时提示。",
    "filesToModify": [
      "OurCode-ide/src/stores/configStore.ts",
      "OurCode-ide/src/components/ChatPanel/ModelSelector.tsx",
      "OurCode-ide/src/services/llm/LLMClient.ts",
      "OurCode-ide/src/services/llm/adapters/OpenAIAdapter.ts",
      "OurCode-ide/src/services/llm/adapters/AnthropicAdapter.ts"
    ],
    "acceptanceCriteria": [
      "模型获取失败时ModelSelector显示错误信息+重试按钮",
      "LLM请求30秒超时自动中断",
      "超时时显示友好提示而非原始错误"
    ],
    "estimatedLines": 120,
    "dependencies": []
  }
]
```

#### P2 - 功能扩展

```json
[
  {
    "taskId": "T-13",
    "taskName": "插件API桥接实现",
    "priority": "P2",
    "description": "将PluginManager中的ExtensionAPI stub方法替换为真实实现：桥接编辑器读写、AI消息发送、UI面板注册到主应用。",
    "filesToModify": [
      "OurCode-ide/src/services/plugin/PluginManager.ts",
      "OurCode-ide/src/services/plugin/index.ts",
      "OurCode-ide/src/components/Sidebar/Sidebar.tsx"
    ],
    "acceptanceCriteria": [
      "插件可通过API读取编辑器内容和选中文本",
      "插件可通过API发送AI消息",
      "插件可注册侧边栏面板并在UI中显示",
      "权限白名单实际生效"
    ],
    "estimatedLines": 300,
    "dependencies": []
  },
  {
    "taskId": "T-14",
    "taskName": "插件市场基础UI",
    "priority": "P2",
    "description": "创建插件市场界面：浏览已安装插件列表、搜索、安装（从本地文件）、卸载、启用/禁用、权限查看。",
    "filesToModify": [
      "OurCode-ide/src/components/Settings/SettingsModal.tsx",
      "OurCode-ide/src/stores/pluginStore.ts"
    ],
    "acceptanceCriteria": [
      "设置中新增Plugins标签页",
      "显示已安装插件列表和状态",
      "可从本地文件安装插件",
      "可卸载和启用/禁用插件",
      "显示插件所需权限"
    ],
    "estimatedLines": 250,
    "dependencies": ["T-13"]
  },
  {
    "taskId": "T-15",
    "taskName": "自定义主题色",
    "priority": "P2",
    "description": "在设置中添加自定义主题色选择器，修改CSS变量实现全局主题色切换。",
    "filesToModify": [
      "OurCode-ide/src/components/Settings/SettingsModal.tsx",
      "OurCode-ide/src/stores/uiStore.ts",
      "OurCode-ide/src/styles/global.css"
    ],
    "acceptanceCriteria": [
      "设置中显示主题色选择器",
      "选择颜色后所有面板实时响应",
      "主题色持久化",
      "至少支持8种预设色 + 自定义色值"
    ],
    "estimatedLines": 100,
    "dependencies": []
  },
  {
    "taskId": "T-16",
    "taskName": "首次运行引导 + 重置设置",
    "priority": "P2",
    "description": "实现Onboarding流程：首次启动引导创建第一个配置组；添加重置所有设置功能（清除SQLite数据、localStorage）。同时添加启动画面。",
    "filesToModify": [
      "OurCode-ide/src/App.tsx",
      "OurCode-ide/src/components/Layout/MainLayout.tsx",
      "OurCode-ide/src/components/Settings/SettingsModal.tsx",
      "OurCode-ide/electron/main.ts"
    ],
    "acceptanceCriteria": [
      "首次启动显示引导界面",
      "引导用户创建第一个API配置组",
      "引导介绍基本功能",
      "设置中有'重置所有数据'按钮",
      "重置前有确认对话框",
      "重置后应用回到初始状态"
    ],
    "estimatedLines": 250,
    "dependencies": []
  },
  {
    "taskId": "T-17",
    "taskName": "输入框Markdown快捷键 + 会话加密",
    "priority": "P2",
    "description": "ChatInput添加Markdown快捷键（Ctrl+B加粗、Ctrl+I斜体等）；会话数据可选AES加密存储。",
    "filesToModify": [
      "OurCode-ide/src/components/ChatPanel/ChatInput.tsx",
      "OurCode-ide/electron/services/sqlite-store.ts"
    ],
    "acceptanceCriteria": [
      "输入框中Ctrl+B包围选中文本为**粗体**",
      "Ctrl+I包围为*斜体*",
      "Ctrl+`包围为`代码`",
      "会话加密选项在设置中可切换",
      "开启加密后会话数据AES加密存储"
    ],
    "estimatedLines": 120,
    "dependencies": []
  },
  {
    "taskId": "T-18",
    "taskName": "AI请求错误重试 + 自动更新",
    "priority": "P2",
    "description": "AI消息错误时在消息底部显示重试按钮；集成electron-updater实现自动更新。",
    "filesToModify": [
      "OurCode-ide/src/stores/chatStore.ts",
      "OurCode-ide/src/components/ChatPanel/ChatMessage.tsx",
      "OurCode-ide/electron/main.ts",
      "OurCode-ide/package.json"
    ],
    "acceptanceCriteria": [
      "AI错误消息底部显示'重试'按钮",
      "点击重试重新发送请求",
      "electron-updater集成",
      "应用启动时检查更新"
    ],
    "estimatedLines": 150,
    "dependencies": []
  }
]
```

#### P3 - 质量保障

```json
[
  {
    "taskId": "T-19",
    "taskName": "单元测试",
    "priority": "P2",
    "description": "安装Vitest测试框架，为核心模块编写单元测试：加密服务、配置管理、对话树逻辑、消息编辑/删除/撤销。",
    "filesToModify": [
      "OurCode-ide/package.json",
      "OurCode-ide/vitest.config.ts (新建)",
      "OurCode-ide/tests/crypto.test.ts (新建)",
      "OurCode-ide/tests/chatStore.test.ts (新建)",
      "OurCode-ide/tests/configStore.test.ts (新建)"
    ],
    "acceptanceCriteria": [
      "安装vitest依赖",
      "CryptoService加解密循环测试通过",
      "chatStore分支/编辑/删除/撤销逻辑测试通过",
      "configStore CRUD测试通过",
      "测试覆盖率≥60%核心模块"
    ],
    "estimatedLines": 400,
    "dependencies": []
  },
  {
    "taskId": "T-20",
    "taskName": "CLI插件脚手架",
    "priority": "P3",
    "description": "创建npm包create-nebula-plugin，提供交互式命令行工具快速生成插件项目模板。",
    "filesToModify": [
      "OurCode-ide/packages/create-nebula-plugin/package.json (新建)",
      "OurCode-ide/packages/create-nebula-plugin/src/index.ts (新建)",
      "OurCode-ide/packages/create-nebula-plugin/templates/default/package.json (新建)",
      "OurCode-ide/packages/create-nebula-plugin/templates/default/src/index.ts (新建)"
    ],
    "acceptanceCriteria": [
      "npx create-nebula-plugin可执行",
      "交互式输入插件名称、描述",
      "生成包含PluginManifest的项目结构",
      "生成的项目可被PluginManager加载"
    ],
    "estimatedLines": 200,
    "dependencies": ["T-13"]
  }
]
```

---

## 第4步：冲突检查 - 文件修改矩阵

| 任务 | shared/types.ts | shared/constants.ts | chatStore.ts | ChatMessage.tsx | ChatMessages.tsx | sqlite-store.ts | EditorContainer.tsx | TabBar.tsx | editorStore.ts | MainLayout.tsx | FileTreeNode.tsx | FileTree.tsx | SearchPanel.tsx | main.ts(electron) | preload.ts | ModelSelector.tsx | ModelCompareView.tsx | configStore.ts | SettingsModal.tsx | ChatSidebar.tsx | TerminalPanel.tsx | LLMClient.ts | OpenAIAdapter.ts | AnthropicAdapter.ts | PluginManager.ts | plugin/index.ts | Sidebar.tsx | uiStore.ts | global.css | App.tsx | ChatInput.tsx | package.json | vitest.config.ts |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| T-01 类型扩展 | **X** | **X** | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |
| T-02 分支系统 | | | **X** | **X** | **X** | **X** | | | | | | | | | | | | | | | | | | | | | | | | | | | |
| T-03 分屏编辑 | | | | | | | **X** | **X** | **X** | **X** | | | | | | | | | | | | | | | | | | | | | | | |
| T-04 文件拖拽 | | | | | | | | | | | **X** | **X** | | | | | | | | | | | | | | | | | | | | | |
| T-05 搜索增强 | | | | | | | | | | | | | **X** | **X** | **X** | | | | | | | | | | | | | | | | | | |
| T-06 模型增强 | | | | | | | | | | | | | | | | **X** | **X** | **X** | **X** | | | | | | | | | | | | | | |
| T-07 消息编辑优化 | | | | **X** | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |
| T-08 置顶归档 | | | **X** | | | | | | | | | | | | | | | | | **X** | | | | | | | | | | | | | |
| T-09 排序+加密导入 | | | | | | | | | | | | | | | | | | **X** | **X** | | | | | | | | | | | | | | |
| T-10 终端分屏 | | | | | | | | | | | | | | | | | | | | | **X** | | | | | | | | | | | | |
| T-11 Prompt编辑器 | | | | | | | | | | | | | | | | | | | **X** | | | | | | | | | | | | | | |
| T-12 错误处理+超时 | | | | | | | | | | | | | | | | **X** | | **X** | | | | | **X** | **X** | **X** | | | | | | | | |
| T-13 插件桥接 | | | | | | | | | | | | | | | | | | | | | | | | | | **X** | **X** | **X** | | | | | |
| T-14 插件市场UI | | | | | | | | | | | | | | | | | | **X** | | | | | | | | | | | | | | | |
| T-15 自定义主题色 | | | | | | | | | | | | | | | | | | | | | | | | | | | | **X** | **X** | | | | |
| T-16 引导+重置 | | | | | | | | | | **X** | | | | **X** | | | | | **X** | | | | | | | | | | | **X** | | |
| T-17 MD快捷键+加密 | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | **X** | | |
| T-18 重试+更新 | | | **X** | **X** | | | | | | **X** | | | | | | | | | | | | | | | | | | | | | | **X** | |
| T-19 单元测试 | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | **X** | **X** |
| T-20 CLI脚手架 | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | | |

### 冲突标记

**发现冲突：**

1. **T-02 和 T-08** 共同修改 `chatStore.ts` → 需顺序执行或合并（T-02先完成分支，T-08再加置顶）
2. **T-06 和 T-12** 共同修改 `configStore.ts` 和 `ModelSelector.tsx` → 需合并或顺序执行
3. **T-09 和 T-14** 共同修改 `configStore.ts` 和 `SettingsModal.tsx` → 需合并或顺序执行
4. **T-03 和 T-16** 共同修改 `MainLayout.tsx` → 需顺序执行（T-03先改布局，T-16再加引导）
5. **T-11 和 T-14** 共同修改 `SettingsModal.tsx` → 需合并或顺序执行
6. **T-02 和 T-18** 共同修改 `ChatMessage.tsx` → 需合并或顺序执行

### 修正后的合并任务包

为解决冲突，将部分任务合并：

**合并后最终任务清单：**

| 任务ID | 合并任务 | 修改文件 | 优先级 |
|--------|---------|---------|--------|
| T-01 | 类型系统扩展 | shared/types.ts, shared/constants.ts | P0 |
| T-02 | 对话分支 + 置顶归档 | chatStore.ts, ChatMessage.tsx, ChatMessages.tsx, sqlite-store.ts, ChatSidebar.tsx | P0 |
| T-03 | 编辑器分屏 | EditorContainer.tsx, TabBar.tsx, editorStore.ts, MainLayout.tsx | P0 |
| T-04 | 文件树拖拽 | FileTreeNode.tsx, FileTree.tsx | P0 |
| T-05 | 搜索增强 | SearchPanel.tsx, electron/main.ts, preload.ts | P0 |
| T-06 | 模型增强 + 错误处理 + 超时 | ModelSelector.tsx, ModelCompareView.tsx, configStore.ts, LLMClient.ts, OpenAIAdapter.ts, AnthropicAdapter.ts | P0 |
| T-07 | 消息编辑优化 + 错误重试 | ChatMessage.tsx, chatStore.ts (read only) | P1 |
| T-08 | 配置组排序 + 导出加密 + Prompt编辑器 + 插件市场 | SettingsModal.tsx, configStore.ts | P1 |
| T-09 | 终端分屏 | TerminalPanel.tsx | P1 |
| T-10 | 插件API桥接 | PluginManager.ts, plugin/index.ts, Sidebar.tsx | P2 |
| T-11 | 自定义主题色 | uiStore.ts, global.css, SettingsModal.tsx (read) | P2 |
| T-12 | Onboarding + 重置 + 启动画面 | App.tsx, MainLayout.tsx, electron/main.ts | P2 |
| T-13 | 输入框MD快捷键 + 会话加密 | ChatInput.tsx, sqlite-store.ts | P2 |
| T-14 | 自动更新 | electron/main.ts, package.json | P2 |
| T-15 | 单元测试 | package.json, vitest.config.ts (new), tests/* (new) | P2 |
| T-16 | CLI插件脚手架 | packages/create-nebula-plugin/* (new) | P3 |

---

## 第5步：依赖关系图

```
T-01 (类型扩展) ─────────┬──→ T-02 (分支+置顶) ──→ T-07 (消息编辑优化)
                          ├──→ T-06 (模型增强)
                          ├──→ T-08 (配置组排序+加密+Prompt+市场)
                          └──→ 其他任务可直接使用扩展类型

T-10 (插件桥接) ──→ T-16 (CLI脚手架)

T-03 (分屏) ──→ T-12 (Onboarding)  [共享MainLayout.tsx修改]

所有其他任务相互独立，可并行执行。
```

## 并行执行策略

### 第一批（可同时执行，互不冲突）：
- **Agent 1**: T-01 (类型扩展)
- **Agent 2**: T-03 (编辑器分屏)
- **Agent 3**: T-04 (文件树拖拽)
- **Agent 4**: T-05 (搜索增强)
- **Agent 5**: T-09 (终端分屏)
- **Agent 6**: T-15 (单元测试)

### 第二批（T-01完成后）：
- **Agent 1**: T-02 (对话分支+置顶归档)
- **Agent 2**: T-06 (模型增强+错误处理)
- **Agent 3**: T-08 (配置组排序+加密+Prompt)
- **Agent 4**: T-10 (插件桥接)
- **Agent 5**: T-11 (自定义主题色)
- **Agent 6**: T-13 (输入框MD+加密)

### 第三批（依赖前序任务）：
- **Agent 1**: T-07 (消息编辑优化+重试) - 需T-02
- **Agent 2**: T-12 (Onboarding+重置) - 需T-03
- **Agent 3**: T-14 (自动更新)
- **Agent 4**: T-16 (CLI脚手架) - 需T-10

---

## 已正确实现的功能清单（53项）

#1 #2 #4 #7 #8 #9 #10 #13 #14 #15 #16 #17 #18 #19 #20 #25 #26 #27 #28 #29 #31 #33 #34 #35 #36 #39 #42 #43 #46 #48 #49 #51 #52 #55 #56 #57 #59 #60 #61 #62 #63 #64 #65 #66 #68 #69 #70 #71 #73 #82 #84 #85 #86 #88 #89 #99

## 部分实现的功能清单（23项）

#6 #11 #12 #21 #30 #40 #41 #45 #47 #50 #53 #54 #72 #77 #81 #91 #92 #93 #94

## 未实现的功能清单（24项）

#3 #5 #22 #23 #24 #32 #37 #38 #44 #58 #67 #74 #75 #76 #78 #79 #80 #83 #87 #90 #95 #96 #97 #98 #100
