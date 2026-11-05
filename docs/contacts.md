# 查询抖音会话 ID（只读）

先正常退出 DouyinBridge，不要同时启动两个实例占用同一个 Chromium profile。

在 Windows PowerShell 中：

```powershell
cd C:\work\code\DouyinBridge
git pull
npm install
node --env-file=.env src/index.mjs --list-contacts --visible
```

- `--visible` 是调试模式，便于观察扫码或验证页面。若登录态已恢复，可去掉。
- 命令**不连接 AstrBot、不调用 AI、不发消息、不修改白名单**。
- 会尝试打开抖音消息面板，读取当前网页会话列表，自动滚动收集能够识别的会话。
- 列表可能只包含当前已加载的消息会话，不保证包含所有抖音好友和所有群聊。
- 只有状态为“已核验”的 `conv:<64位哈希>` 能用作白名单 ID。
- 身份未核验或没有会话 ID 时不要自行计算、猜测或以昵称代替。
- 通过浏览器扫码登录后，请先关闭登录进程，再启动此命令，以免锁定 profile。

输出示例（虚构 ID）：

```text
[群聊] 开发测试群
  状态：已核验
  ID：conv:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

把你需要的 ID 填入 `.env`，多个以英文逗号分隔：

```ini
ALLOWED_CONVERSATIONS=conv:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ENABLE_SENDING=false
```

修改后重启主程序：

```powershell
node --env-file=.env src/index.mjs
```

`ENABLE_SENDING=false` 阻止程序执行发送动作；白名单只允许特定会话进入消息处理流程。当前版本尚未完成真实抖音私聊、群聊端到端联调，也未提供可靠的重启后消息水位持久化，不适合无人值守。
