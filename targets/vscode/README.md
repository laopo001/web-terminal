# Web Terminal for VS Code

安装打包生成的 `.vsix` 后，点击活动栏的终端图标打开侧边窗口，或运行 **Web Terminal: Show Sidebar**。**Web Terminal: Open** 仍可在编辑器标签页打开。服务需先独立启动；两个入口都只在 Webview 中加载同一页面。

侧栏标题栏提供在编辑器打开、重载和服务器地址设置按钮。隐藏侧栏保留页面状态；修改地址会同步两个入口。

默认地址是 `http://localhost:3840`。用 **Web Terminal: Set Server URL** 或机器级设置 `webTerminal.serverUrl` 修改服务器根地址；修改后可用 **Web Terminal: Reload** 刷新。首次打开时，在 Web 页面输入 token 登录，token 由该页面自行保存在 localStorage。
