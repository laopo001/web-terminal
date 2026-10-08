# Web Terminal 桌面客户端

客户端加载独立的 Web Terminal Node.js 服务。打开时先检查端口、服务身份和协议；本机服务未启动时调用全局 `web-terminal` CLI 启动。缺少安装、端口冲突或启动失败会显示具体错误。客户端不打包服务端或 Web 前端副本。

开发时在根目录执行 `pnpm build && npm link`，再运行 `pnpm electron`。发布后的服务包安装命令为 `npm install -g @dadigua/web-terminal`，CLI 命令名仍为 `web-terminal`。

默认连接 `http://localhost:3840`，用 `WEB_TERMINAL_URL` 临时覆盖，或通过“连接 → 打开连接配置”修改 `client.yaml`，再选择“重新加载服务器”。配置包括 `serverUrl`、`runtime: auto` 和可选的 `cliPath`。Windows 的 auto 优先本机 CLI，其次默认 WSL；可选择 native 或 wsl。自定义远程地址只连接。

“连接 → 重启后台服务”调用 CLI 重启，确认就绪后加载页面；普通 Shell 会话会结束，token 保留。外部管理的服务须通过原管理器重启。CLI 的配置、token、日志及状态默认位于 `~/.web-terminal/`。

token 在 Web 登录页输入，保存在 Electron 的持久 localStorage 中；客户端配置不保存凭据。

Windows ZIP：`pnpm package:electron:win`。Linux 目录包：`pnpm package:electron:linux`。
