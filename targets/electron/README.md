# Web Terminal 桌面客户端

此客户端只加载已有的 Web Terminal 服务。服务器需单独运行；客户端不包含 Web 前端副本、node-pty、ComfyUI 或 Codex。

开发启动：根目录执行 `pnpm electron`。默认连接 `http://localhost:3840`，可用 `WEB_TERMINAL_URL` 临时覆盖。正式客户端通过“连接 → 打开连接配置”修改 `client.yaml` 的 `serverUrl`，保存后选择“重新加载服务器”。

token 在 Web 登录页输入，保存在 Electron 的持久 localStorage 中。客户端配置仅保存服务器地址。浏览器、Electron 和 VS Code 各自首次登录，彼此不复制凭据。

Windows 免安装 ZIP：`pnpm package:electron:win`。解压后运行 `Web Terminal.exe`。Linux 目录包：`pnpm package:electron:linux`。
