# 前后端接口

HTTP 请求使用 `Authorization: Bearer <token>`。GET /api/auth 验证 token 返回 `{ok:true}`，无效 401。验证成功才将 token 写入 localStorage (`web-terminal.token`)。除静态页面外所有 API 均鉴权。错误统一 `{error:string}`。

- GET /api/info → ServerInfo
- GET /api/sessions → SessionInfo[]
- POST /api/sessions，JSON `{name?:string,cwd?:string}` → SessionInfo (201)，默认目录由 info 提供，不自动执行 Codex。
- DELETE /api/sessions/:id → `{ok:true}`，会结束 shell，前端需用户明确点结束并确认。
- GET /api/sessions/:id/files/meta?path=... → FileInfo。相对路径按该会话当前 cwd 解析；可传 base=已知的绝对 cwd 固定解析基准。
- GET /api/sessions/:id/files/content?path=...&thumbnail=1 → 图片缩略图。省略 thumbnail 获取原图或原始文件，可加 download=1 下载。使用鉴权 fetch 转 blob URL，不将 token 放 URL。
- POST /api/sessions/:id/uploads，multipart 字段 file → FileInfo (201)，上传后只插入 path，不自动回车。支持图像 PNG/JPEG/WebP/GIF，最大 20MiB。

WebSocket 同源 /ws，不使用 query token。连接后 5 秒内发送 ClientMessage auth；服务端先发送 replay 全部缓存，再发送 ready，后续实时为 output。replay 写入 xterm 期间必须暂停 onData 回传，直至 write callback，避免历史设备查询的自动应答注入 Shell。未认证 close code 4401，前端清除 token 回到登录。建立后输入 input、尺寸 resize。每次重新连接创建全新 xterm 或 reset 后接收回放，避免重复内容。断网自动指数退避重连；用户选择别的会话时停止旧连接。token 只在发送 auth 帧使用。

服务端保留会话，浏览器断开不结束进程。Web 服务重启会结束普通 Shell。字体、路径 hover、图片粘贴、固定右侧预览、上传进度、手机按钮由前端实现。路径 provider 要考虑软换行、中文、引号和路径中的空格；尽可能用单一解析 helper 并加测试。只自动预览图片，其他文件可下载。不要将服务端文字插入 innerHTML。
