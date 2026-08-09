# UI 自测 Demo（AI 浏览器操作）

一个演示「AI 替客户项目做界面自测」的最小示例：一个纯原生 JS 的任务管理工作台 +
Playwright MCP 浏览器操作配置 + 期望行为清单。

## 目录结构

```
ui-self-test-demo/
├── mcp_config.json   # 为本工作区启用 @playwright/mcp（浏览器操作工具）
├── EXPECTED.md       # 期望行为清单，AI 逐条点击/输入/验证的验收依据
└── app/              # 客户项目：任务管理工作台（HTML/CSS/JS，无构建步骤）
```

## 演练步骤

### 1. 打开工作区
在 OurCode IDE 中用「打开文件夹」打开本目录（`examples/ui-self-test-demo`）。
打开后 IDE 会自动加载 `mcp_config.json` 里的 Playwright MCP 服务器，
AI 即可获得 `browser_navigate` / `browser_click` / `browser_type` /
`browser_snapshot` / `browser_take_screenshot` 等浏览器操作工具。

> 若 MCP 未自动加载，在设置 → MCP 里手动重载，或检查 IDE 日志中
> 「MCP 服务器 "playwright"」是否 ready。

### 2. 启动静态服务
```bash
# 方式 A：Node 环境
npx serve app
# 方式 B：Python 环境
python -m http.server 8080 -d app
```
> 注意：`@playwright/mcp` 默认屏蔽 `file://` 协议，必须通过 http 服务访问页面。

### 3. 让 AI 执行自测
在聊天框输入（或调用 `/ui-self-test` 技能）：

> 对 `app/` 目录的任务管理工作台做一次完整的 UI 自测：
> 按 `EXPECTED.md` 逐条用浏览器工具点击、输入并验证功能，
> 最后输出通过/失败报告。

AI 会依次：打开页面 → 读取页面快照 → 点击页签/按钮 → 输入文字 →
再次读取快照断言结果 → 输出逐项报告。

### 4. 验收报告
自测完成后 AI 会给出：
- 每项验证的 通过 / 失败 / 跳过（原因）
- 失败项的截图与根因分析
- 通过项汇总

### 5. 快速自检（不启动 IDE 也能验证链路）
仓库根目录提供了一个端到端自检脚本：以 MCP stdio 协议直接驱动
`@playwright/mcp`，对 demo 执行一轮「打开 → 点击 → 输入 → 验证 → 关闭」，
所有断言通过即代表浏览器操作能力正常。

```bash
# 1. 启动静态服务
python -m http.server 8123 -d examples/ui-self-test-demo/app
# 2. 另开终端运行自检（默认访问 http://127.0.0.1:8123/index.html）
node tools/verify-browser-mcp.mjs
```

## 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| MCP 服务器启动失败 | `node` 不在 PATH，或路径失效 | 确认 `mcp_config.json` 的 `args` 指向 `@playwright/mcp/cli.js` 实际位置 |
| 浏览器打开报「浏览器未安装」 | Playwright 浏览器未下载 | 执行 `node node_modules/@playwright/mcp/node_modules/playwright/cli.js install chromium` |
| 想隐藏浏览器窗口 | 默认有头模式 | 在 MCP 配置 args 中加 `--headless` |
| 客户项目不在此目录 | 相对路径失效 | 参考 `docs/BROWSER_SELF_TEST.md` 的「客户项目接入」 |

## 注意

`mcp_config.json` 里的 `../../node_modules/@playwright/mcp/cli.js` 是相对本 demo
在 IDE 仓库内的位置（`OurCode-ide/examples/...` → `OurCode-ide/node_modules/...`）。
若把 demo 复制到别处，需改为对应实际路径。
