# Web Terminal

为远程 Codex 等 CLI 提供浏览器终端、图片粘贴上传和路径图片预览。首次输入 token，验证成功后保存在当前浏览器、当前站点的 `localStorage`；刷新或再次打开时自动验证。点击退出登录会清除本机保存的 token。

## 启动

需要 Node.js 22+、pnpm 11，推荐 Linux/WSL。安装 node-pty 时可能需要 Python 3、make 和 C++ 编译工具。

```bash
pnpm install
pnpm build
pnpm start
```

打开 http://localhost:3840 。首次启动自动生成 token，另开终端读取后粘贴到登录页：

```bash
cat .data/token
```

也可以在启动时通过 `WEB_TERMINAL_TOKEN` 指定非空 token。token 不放入页面 URL、图片链接或 WebSocket URL。

开发模式使用 `pnpm dev`，前后端共用 3840 端口。`pnpm test` 验证文件访问、认证、真实 PTY 和断线重连；`pnpm check` 做类型检查。

## 全局 CLI 与本地 link

服务包名为 `@dadigua/web-terminal`，命令名为 `web-terminal`。npm 上的无 scope 同名包是其他项目，不要安装它。本项目尚未发布；本地开发先执行：

```bash
pnpm build
npm link
web-terminal start
web-terminal status
web-terminal restart
web-terminal stop
```

link 指向当前项目；服务端或前端源码修改后执行 `pnpm build`，再重启服务。发布后的安装命令为 `npm install -g @dadigua/web-terminal`。

CLI 默认使用 `~/.web-terminal/config.yaml`，相对路径以配置文件所在目录为准；每个端口的 token、状态和日志分别位于 `~/.web-terminal/servers/<端口>/data/token`、`server.yaml` 和 `server.log`。首次登录读取对应 token 文件。可用 `--url http://localhost:3841` 选择端口、`--config /path/config.yaml` 指定配置，`--home /path/state` 指定管理目录。CLI 启动为后台进程，关闭客户端不会结束服务；重启保留 token，但结束普通 Shell 会话。

CLI 只停止自己登记且启动标识匹配的进程，不接管 `pnpm start` 或 systemd 启动的外部服务。外部服务可以连接，重启时会提示使用原管理器。

## 使用

1. 首次打开时选择已有会话，或点击“新建 Shell”进入普通命令行；不会自动接入第一条历史会话。通过“＋”选择工作目录；VS Code 中可快捷选择工作区目录。
2. 在终端里运行 `codex`，照常操作 CLI。 底部输入框点击“发送”或按 Enter 会写入文字并提交一次；中文输入法选词时不会提交。
3. 粘贴截图、拖入图片，或点击手机工具条的“上传”。图片保存到服务器的 `.data/uploads/<会话ID>/`，上传成功后插入绝对路径，**不会自动按 Enter**。继续写要求，然后自行提交。
4. 悬停图片路径查看缩略图；点击路径打开右侧预览，复制路径或下载原文件。
5. VS Code、Electron 和浏览器连接同一服务器并选择同一会话，就会共用一个终端；两端输入会进入同一个 Shell，当前操作的窗口控制尺寸，其他窗口按相同行列数显示。关闭浏览器不会结束会话。默认直接运行 Shell，重启 Web 服务会结束普通 Shell；点击会话的结束按钮才会终止 Shell 并删除该会话上传的图片。

会话首次选中时加载终端和连接，之后切换只隐藏或显示，不重新连接；各会话独立保留草稿、滚动位置、上传和文件预览。隐藏会话继续接收输出，不抢焦点或上报尺寸；关闭会话或退出登录时释放资源。

底部草稿区默认一行，随内容向上浮动展开，最多约 10 行，超出后内部滚动；输入区和上传提示不挤占终端高度。Enter 发送、Shift+Enter 换行；发送成功清空后缩回一行，断线时保留草稿。工具栏提供图片上传、Esc 和 Ctrl+C，触屏设备另提供 Tab 和方向键。

图片支持 PNG、JPEG、WebP、GIF，每张最多 20 MiB；解码限制为 6400 万像素。上传路径插入与 Codex 识别成附件是两个阶段；遇到 CLI 未自动附加的情况，可以在提示中明确要求读取该绝对路径。服务不读取或同步系统剪贴板，上传由浏览器的粘贴/拖拽动作触发。

当前一台服务对应一台机器，远程使用应将服务部署在 Codex 所在机器。终端内再 SSH 到其他机器后，其路径不会自动映射回当前文件服务。绝对路径最可靠；没有输出时工作目录信息的历史相对路径无法保证还原当时含义。

## 远程访问和配置

服务默认仅监听 `127.0.0.1`。可通过 SSH 转发访问：

```bash
ssh -N -L 3840:127.0.0.1:3840 user@server
```

然后在本机打开 http://localhost:3840 。也可放到已有 HTTPS 反向代理后，代理需支持 WebSocket 并保留 Host。直接用远程 HTTP 地址时，浏览器的部分剪贴板能力可能不可用。

复制 `config.example.yaml` 为 `config.yaml`，按需配置监听地址、端口、默认目录及文件访问范围。环境变量支持 `HOST`、`PORT`、`WEB_TERMINAL_CONFIG`、`WEB_TERMINAL_DATA_DIR`、`WEB_TERMINAL_TOKEN`。相对配置路径以启动目录为基准。

`roots` 控制文件接口的可读目录与会话初始目录，不是 Shell 沙箱。登录者拥有服务运行用户的终端权限。`.data/` 保存 token、会话元数据和上传图片，不应提交到 Git。

需要时在终端里手动运行 `tmux`，再运行其他命令；Web 服务重启后可新建终端并执行 `tmux attach`。

## 当前验证

已通过类型检查、生产构建和集成测试（含客户端）。共享 Windows Chrome 中验证了 token 保存与刷新恢复、原生文件上传、图片剪贴板粘贴、中文及空格路径的 hover/侧栏预览。Codex CLI 0.159.2 的实际输入框已识别上传图片为 `[Image #1]`，并保留原有文字；测试未提交模型请求。

## VS Code 与 Electron

两个客户端加载独立的 Node.js 服务，共用端口检测、身份检查和 CLI 启动逻辑；不打包前端副本或终端运行时。本机端口未启动时自动调用全局 CLI，冲突或缺少安装会明确报错；远程地址只连接。

### VS Code

```bash
pnpm package:vscode
```

在 VS Code 的扩展菜单选择“从 VSIX 安装”，打开 `release/web-terminal.vsix`。点击活动栏终端图标或运行 `Web Terminal: Show Sidebar` 打开侧边窗口；`Web Terminal: Open` 在编辑器标签页打开。两处均加载现有 Web 页面。默认地址为 `http://localhost:3840`；通过 `Web Terminal: Set Server URL` 或设置 `webTerminal.serverUrl` 修改，`Web Terminal: Reload` 重载；侧栏及编辑器标题栏的重启按钮重启后台并等待就绪。Remote WSL/SSH 在扩展宿主所在机器检测和启动，再使用 VS Code 的端口转发能力。Windows 本机默认先查本机全局 CLI，再查默认 WSL；可通过 `webTerminal.runtime` 和 `webTerminal.cliPath` 调整。

### Electron

```bash
pnpm electron
pnpm package:electron:win
```

开发命令打开桌面客户端；Windows 命令生成 `release/Web-Terminal-0.1.0-win-x64.zip`，解压后运行 `Web Terminal.exe`。菜单“连接 → 打开连接配置”打开 `client.yaml`，只需修改 `serverUrl`，再选择“重新加载服务器”；“重启后台服务”通过全局 CLI 重启。`client.yaml` 的 `runtime` 可选 auto、native、wsl，`cliPath` 可指定本机 CLI 路径。也可用 `WEB_TERMINAL_URL` 临时覆盖地址。Linux 目录包通过 `pnpm package:electron:linux` 生成。

浏览器、VS Code、Electron 各自首次在同一 Web 登录页输入 token，验证后保存在各自 Webview 的持久 localStorage 中。客户端配置不保存 token。Electron 远程页面开启 sandbox/contextIsolation、关闭 Node 集成；VS Code 通过专用 `/?embed=vscode` 入口加载，普通入口仍禁止 iframe 嵌入。

客户端验证：Windows VS Code 开发宿主中已实际显示 Web 登录页；Electron 在 WSL 的真实渲染器中恢复 token 并连接已有终端。Windows ZIP 已完成打包及内容检查，应用归档仅有 `main.cjs` 和 `package.json`，未包含后端依赖。
