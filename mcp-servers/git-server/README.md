# Git MCP Server（示例服务器）

一个**零依赖**的 stdio MCP 服务器实现，用于演示 OurCode IDE 的 MCP 集成。
它包装 `git` CLI，提供工具、资源和提示词三类 MCP 能力。运行环境：Node.js 18+（仅用内置模块，无需 `npm install`）。

## 启用的方法

| 能力 | 方法 | 说明 |
| --- | --- | --- |
| Tools | `tools/list` / `tools/call` | `git_status` / `git_log` / `git_diff` / `git_branch` / `git_commit` / `git_push` |
| Resources | `resources/list` / `resources/read` | `git://branch`（当前分支）、`git://status`（工作区状态） |
| Prompts | `prompts/list` / `prompts/get` | `commit-message`（生成规范提交信息） |

协议细节：JSON-RPC 2.0，newline-delimited JSON 帧（`electron/services/mcp-manager.ts` 同时兼容 LSP `Content-Length` 帧）。
服务器在**启动它的工作区**（cwd）上操作，即 IDE 打开工作区时传入的 `rootPath`。

## 使用

在 IDE 中打开工作区后，将仓库根目录下的 `mcp_config.example.json` 复制为 `mcp_config.json`，
重新加载工作区（或调用 `mcpReload`）即可自动拉起本服务器。之后模型会看到 `mcp__git__git_status` 等动态工具。

手动冒烟测试：

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node server.js
```

## 配置示例

```json
{
  "mcpServers": {
    "git": {
      "command": "node",
      "args": ["mcp-servers/git-server/server.js"],
      "env": { "GIT_PAGER": "cat" },
      "disabledTools": ["git_push"]
    }
  }
}
```

字段说明（与 `McpServerConfig` 对应）：

- `command` / `args` — 以数组方式 spawn（不经过 shell），`cwd` 为工作区根目录。
- `env` — 追加到服务器进程的环境变量。
- `disabledTools` — 禁用列表；该服务器暴露的工具会被 IDE 过滤掉（对 `git_push` 这类高风险操作尤其有用）。
- `disabled` — 设为 `true` 可临时停用某个服务器。
- `serverUrl` / `url` — 远程 SSE 传输，当前版本未支持（会发出错误提示）。

## 注意

- 服务器崩溃/退出时，IDE 会自动以指数退避（1s→2s→4s…，最多 5 次）重启它并重新握手。
- `git_commit` / `git_push` 会写入 git 历史或对外发布，属于高风险操作；
  建议在 `disabledTools` 中禁用，或由上层技能（如 `deploy`）显式管控。
