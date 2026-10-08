# Web Terminal for VS Code

安装 `.vsix` 后，点击活动栏终端图标或运行 **Web Terminal: Show Sidebar** 打开侧栏；**Web Terminal: Open** 在编辑器标签页打开。两个入口加载同一 Web 页面。

打开时先检测端口和服务身份。正确的服务直接连接；本机端口未启动时查找全局 CLI 并自动启动；端口冲突、协议不兼容或启动失败会显示具体错误。没有安装时提供 npm 安装命令及复制按钮。包名为 `@dadigua/web-terminal`，命令名为 `web-terminal`；本地开发用项目根目录的 `pnpm build && npm link` 本地测试。

侧栏和编辑器标题栏提供“重启后台服务”按钮，通过 CLI 重启并等待服务就绪后重新加载页面，后台挂起时仍可操作。普通 Shell 会话会结束，token 保留。外部启动的服务不会被接管，须用原管理器重启。

默认地址 `http://localhost:3840`，用 **Web Terminal: Set Server URL** 或 `webTerminal.serverUrl` 修改。远程地址只连接，不在本机安装或启动。Remote WSL/SSH 使用扩展宿主所在机器；本机 Windows 的 `webTerminal.runtime` 默认 `auto`，优先本机 CLI，其次默认 WSL，也可显式选择 `native` 或 `wsl`。`webTerminal.cliPath` 可指定本机 CLI 绝对路径。未受信任的工作区不会自动启动服务。

CLI 默认配置为 `~/.web-terminal/config.yaml`，token、日志及状态位于 `~/.web-terminal/servers/<端口>/`。首次在 Web 页面输入 `data/token` 的内容，页面自行保存在 localStorage；插件不读取 token。

选中代码后，右键选择“发送选中文本到 Web Terminal”加入当前会话附件区；文本带有路径、语言和行号。点击终端输出中的文件路径会使用 VS Code 打开文件。
