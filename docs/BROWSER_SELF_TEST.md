# 浏览器操作与 UI 自测能力（Playwright MCP）

让 AI 助手获得「真实浏览器操作」能力：对客户写的 Web 项目自动打开页面、
**点击、输入、提交，然后读取页面快照逐项验证功能**，输出通过/失败测试报告。
全程不需要客户预写任何测试代码。

## 能力原理

AI 的工具列表 = 内置工具（read_file / run_command / web_search …）
**+ 工作区 MCP 服务器提供的动态工具**（`mcp__<server>__<tool>`，
见 `src/services/tools/ToolExecutor.ts`）。接入 [@playwright/mcp](https://www.npmjs.com/package/@playwright/mcp)
后，AI 即可调用这些浏览器操作工具：

| 工具 | 作用 |
|---|---|
| `browser_navigate` | 打开 URL（http/https；`file://` 默认被屏蔽，需用 http 服务） |
| `browser_snapshot` | 读取页面可访问性快照（当前可见的文本/按钮/输入框） |
| `browser_click` | 点击元素（按文本 / role / aria-label 定位） |
| `browser_type` / `browser_fill` | 在输入框键入文字 |
| `browser_select` | 选择下拉项 |
| `browser_take_screenshot` | 截图取证 |
| `browser_console_messages` | 读取控制台日志（验证无报错） |
| `browser_close` | 关闭浏览器 |

## 安装（一次性）

在 **工作区**（客户项目或本 demo 目录）中：

```bash
# 1. 安装 @playwright/mcp（作为该项目的 devDependency）
npm i -D @playwright/mcp

# 2. 下载浏览器（默认走 Google CDN，国内网络通常失败，需指定镜像）
#    可选镜像：https://npmmirror.com/mirrors/playwright
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright \
  node node_modules/@playwright/mcp/node_modules/playwright/cli.js install chromium
```

> 本项目根目录已安装 `@playwright/mcp@0.0.79`（见 package.json devDependencies），
> demo 直接复用，无需重复安装。

## 配置（工作区级）

在工作区根目录创建 `mcp_config.json`（与 `.mcp.json` 二选一，IDE 启动时自动加载）：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["node_modules/@playwright/mcp/cli.js"],
      "env": {}
    }
  }
}
```

**为什么用 `node` 而不是 `npx`**：IDE 的 MCP stdio 传输用 `spawn(command, args)`
且**不带 shell**（安全设计，见 `electron/services/mcp-manager.ts`），而 Windows 上
`spawn('npx')` 无法解析 `npx.cmd`（ENOENT）。用 `node + 相对路径` 跨平台稳定。
路径是相对**工作区根目录**的（MCP 服务器以工作区为 cwd 启动），与自带 git-server 的
`node mcp-servers/git-server/server.js` 同一模式。

> demo 位于 IDE 仓库内时，可简写为 `../../node_modules/@playwright/mcp/cli.js`
> 直接复用 IDE 的安装（见 `examples/ui-self-test-demo/mcp_config.json`）。

## 使用流程

1. **打开工作区**：在 IDE 中打开客户项目文件夹，MCP 自动加载；
   聊天面板应能看到 `mcp__playwright__browser_*` 工具可用。
2. **启动服务**：`@playwright/mcp` 默认屏蔽 `file://`，页面必须通过 http 访问：
   `run_command` 执行 `npx serve dist` / `python -m http.server 8080 -d app` 等。
3. **发起自测**：让 AI 调用 `ui-self-test` 技能
   （技能文件 `skills/ui-self-test/SKILL.md`），或直接描述：
   > 对工作区里的 Web 应用做 UI 自测：打开页面、逐项点击/输入并验证，输出报告。
4. **验收报告**：AI 输出每项 通过/失败/跳过，失败项附截图与根因分析。

## 快速演练

完整可跑通的示例在 `examples/ui-self-test-demo/`：

```
examples/ui-self-test-demo/
├── mcp_config.json   # 已配置好的 Playwright MCP（指向 IDE 内安装）
├── EXPECTED.md       # 期望行为清单（AI 的验收依据）
└── app/              # 任务管理工作台（纯原生 JS 客户项目）
```

演练步骤见该目录的 `README.md`。

## 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| MCP 启动失败「启动失败」 | `node` 不在 PATH / 路径错误 | 用 `node -e "require('node_modules/@playwright/mcp/package.json')"` 验证路径 |
| 浏览器打开报未安装 | playwright 的浏览器下载被拦 | 用 `PLAYWRIGHT_DOWNLOAD_HOST` 镜像重装（见上文安装） |
| Windows 上配 `npx` 报 ENOENT | stdio 传输不走 shell | 改用 `node` + 相对路径 |
| 想隐藏浏览器窗口 | 默认有头模式 | MCP args 追加 `--headless` |
| 浏览器被公司代理拦 | 网络策略 | 配置 http(s)_proxy 环境变量后重试下载 |

## 范围与限制

- 适用于**网页应用**（HTML / 前端框架 / 本地 dev server）。
- 后端 API / 命令行工具没有 UI 可点，请改用 `generate-tests` 技能生成单元测试。
- 被测应用依赖外部登录 / 内网资源时，可能无法完整自测，按「跳过（环境限制）」处理。
