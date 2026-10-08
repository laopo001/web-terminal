# 前后端接口

HTTP 请求使用 `Authorization: Bearer <token>`。GET /api/auth 验证 token 返回 `{ok:true}`，无效 401。验证成功才将 token 写入 localStorage (`web-terminal.token`)。`/api/*` 均鉴权。`GET /health` 无需 token，仅返回服务标识 `@dadigua/web-terminal`、版本、管理协议版本、实例 ID、PID 和是否由 CLI 管理；不返回 token、路径或配置。客户端检查该身份后才连接或启动服务。错误统一 `{error:string}`。

- GET /api/info → ServerInfo
- GET /api/sessions → SessionInfo[]
- POST /api/sessions，JSON `{name?:string,cwd?:string}` → SessionInfo (201)，默认目录由 info 提供，不自动执行 Codex。
- DELETE /api/sessions/:id → `{ok:true}`，会结束 shell，前端需用户明确点结束并确认。
- GET /api/sessions/:id/files/meta?path=... → FileInfo。相对路径按该会话当前 cwd 解析；可传 base=已知的绝对 cwd 固定解析基准。
- GET /api/sessions/:id/files/content?path=...&thumbnail=1 → 图片缩略图。省略 thumbnail 获取原图或原始文件，可加 download=1 下载。使用鉴权 fetch 转 blob URL，不将 token 放 URL。
- POST /api/sessions/:id/uploads，multipart 字段 file → FileInfo (201)，上传后保留在附件区，点击发送时与文字一起提交。支持图像 PNG/JPEG/WebP/GIF，最大 20MiB。

WebSocket 同源 /ws，不使用 query token。连接后 5 秒内发送 `auth`（`protocol: 2`）；服务端先发送 `snapshot`（画面、行列数、尺寸控制权），再发送 `ready`，后续增量为 `output`。快照与增量必须顺序写入 xterm。终端查询由服务端统一响应，浏览器拦截自动响应，避免多端重复回传。

第一个连接控制尺寸。`resize` 更新该窗口期望尺寸，只有控制窗口会改变 PTY；`claim` 在用户操作时转交控制权。所有窗口按服务端行列数显示，窄窗口可滚动，尺寸变化发送新快照。键盘使用 `input`；文字、图片路径使用 `paste`（`text`、`submit`），由服务端按当前粘贴模式编码，提交回车在粘贴结束标记之外。

未认证关闭码为 4401，协议版本不匹配为 4406（刷新页面），会话结束为 4404。断网自动指数退避重连；已访问会话切换时保留连接。

服务端保留会话，浏览器断开不结束进程。Web 服务重启会结束普通 Shell。字体、路径 hover、图片粘贴、文件预览对话框、上传进度、手机按钮由前端实现。路径 provider 要考虑软换行、中文、引号和路径中的空格；尽可能用单一解析 helper 并加测试。支持图片与文本预览，其他文件可下载；VS Code 内通过插件打开对应文件。不要将服务端文字插入 innerHTML。
