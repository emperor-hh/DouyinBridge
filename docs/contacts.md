# 查询抖音会话 ID（只读）

**推荐在 Web 管理后台管理会话白名单**：正常启动 DouyinBridge，打开 `http://127.0.0.1:3219/`，输入控制台打印的管理员令牌，点击“重新扫描抖音会话”，再对已核验的私聊或群聊开启 **允许 AstrBot 处理**。

如果需要排查扫描结果，可先正常退出网关，再在 Windows PowerShell 中执行：

```powershell
cd C:\work\code\DouyinBridge
git pull
npm ci
node --env-file=.env src/index.mjs --list-contacts --visible
```

- `--visible` 用于查看网页，扫码或安全验证必须由本人完成；若已有登录态，可去掉。
- 该只读命令**不连接 AstrBot、不发送消息，也不修改白名单**。
- 列表可能只包含当前已加载的会话，不保证完整覆盖所有抖音好友和群聊。
- 只有身份核验通过的 `conv:<64位十六进制哈希>` 可用于区分稳定会话；不要用昵称猜测或自行生成 ID。
- 不要同时启动两个 Chromium 实例访问同一个浏览器 Profile。

示例（完全虚构）：

```text
[群聊] 开发测试群
  状态：已核验
  ID：conv:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

## 旧版环境变量说明

`ALLOWED_CONVERSATIONS` 是早期版本升级时使用的**一次性导入项**。启动时仅在首次迁移阶段将旧 ID 迁入 SQLite，并不会在之后每次启动时覆盖 Web 管理后台权限。正常使用请不要反复修改此配置来授权联系人；以 `data/allowlist.sqlite` 和管理后台显示为准。

`ENABLE_SENDING=false` 可以全局禁止发送，默认保持关闭；其他媒体与自动分享功能还需要其对应的独立权限。**本项目尚未完成真实账号私聊 / 群聊端到端验证，不适合对消息完整性要求严格的无人值守生产环境。**
