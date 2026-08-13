# ripgrep 内置二进制

随应用分发的 ripgrep，供 `search:inFiles` / `search:files` 的二级后端使用（打包后位于
`resources/tools/ripgrep/rg`（mac/linux）或 `rg.exe`（win），见 `electron/main.ts` 的
`resolveRgBinary`）。

## 目录结构（electron-builder `${os}/${arch}` 宏）

```
tools/ripgrep/
├── win/    x64/    rg.exe   ← x86_64-pc-windows-msvc
│           arm64/  rg.exe   ← aarch64-pc-windows-msvc
├── mac/    x64/    rg       ← x86_64-apple-darwin
│           arm64/  rg       ← aarch64-apple-darwin
└── linux/  x64/    rg       ← x86_64-unknown-linux-musl（静态链接，兼容性最好）
            arm64/  rg       ← aarch64-unknown-linux-musl
```

`package.json` 的 `build.extraResources` 通过 `tools/ripgrep/${os}/${arch}` 只把当前
目标平台/架构的二进制拷进 `resources/tools/ripgrep/`。

## 更新步骤

1. 从 <https://github.com/BurntSushi/ripgrep/releases> 下载对应 6 个产物：
   `{x86_64,aarch64}-pc-windows-msvc.zip`、`{x86_64,aarch64}-apple-darwin.tar.gz`、
   `{x86_64,aarch64}-unknown-linux-musl.tar.gz`（linux 选 musl 静态版）。
2. 解压后取 `rg` / `rg.exe` 覆盖到对应目录。
3. mac/linux 的 `rg` 需保持可执行位（git 已记录 100755）；改动后执行：
   `git update-index --chmod=+x tools/ripgrep/mac/*/rg tools/ripgrep/linux/*/rg`。
4. 更新本文件中的版本号说明。
