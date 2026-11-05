# DouyinBridge v0.6.0：表情包收发（私聊 / 群聊）

## 两种表情：Unicode 与图片表情包

- **Unicode 表情**，例如 😊、😂：作为普通 OneBot 文本直接发送，无需图片权限。
- **图片表情包**，包括 PNG、JPEG、GIF、WebP：由 AstrBot 生成标准 OneBot `image` 消息段，DouyinBridge 调用上游 `ChatBrowser.sendImageMessage` 上传到指定好友或群聊。GIF 仍以文件上传，是否在接收端动起来取决于抖音客户端。
- **抖音平台原生表情面板中的表情 ID**：尚未支持通过面板点选发送，不能冒充为已实现。

## 开启发送

首先升级代码、备份 `data/allowlist.sqlite`。在 `.env` 配置：

```ini
ENABLE_SENDING=true
ENABLE_IMAGE_SENDING=true
RECEIVE_STICKERS=true
```

以上发送开关默认关闭；开启意味着允许机器人向所授权的会话实际发消息。请**先用测试账号与测试联系人确认身份及发送回执**，正式环境保持谨慎。更改 `.env` 后需重启程序。

在管理后台 `http://127.0.0.1:3219/` 给具体好友/群聊打开：
1. 普通会话白名单
2. **发送表情图片**

每个会话的图片发送开关默认关闭，可在运行时修改，无需重启。禁用后，发送前和最终点击前均会核验权限；平台已接受的点击无法撤回。

## AstrBot / OneBot 输入格式

```json
{
  "action": "send_private_msg",
  "params": {
    "user_id": 123456,
    "message": [
      {
        "type": "image",
        "data": {
          "file": "base64://<真实图片的标准Base64>"
        }
      }
    ]
  },
  "echo": "test-sticker"
}
```

群聊使用 `send_group_msg` 和 `group_id`。支持单张图片段或纯 CQ 字符串 `[CQ:image,file=base64://...] `（实际字符串末尾不应有空格）。

不读取不受信任的 `file:///...`、本地路径或 `https://...`，避免远程抓取与文件读取风险。若 AstrBot 适配器输出 URL 或本地路径，需要在 AstrBot 端先转换为 Base64。

当前一次 OneBot 发送只支持**一张图片**，不支持混合文字加图片或一次发送多图。拒绝时不会自动转换为纯文字，也不会重试不确定的图片发送。

## 接收表情包

当抖音的已授权会话收到表情卡片，DouyinBridge 会将其输出为 `[抖音表情包]` 文本消息，并尝试附加从该条消息截图得到的 OneBot image 段；如截图失败仍发送表情卡片占位说明。图片数据经格式和大小验证，并有每会话至少 10 秒的截图间隔。

`RECEIVE_STICKERS=false` 会关闭截图，但仍转发表情包的文本说明。来源截图为单条表情消息的页面画面，可能不是原始透明 PNG 或原始动图，也不能证明动图全部内容。AstrBot 若需识图应启用支持图片的模型，并验证 OneBot base64 图片段被正确处理。

## 上游实现方式

参考 `dsh-douyin-agent` 的 `ChatBrowser.sendImageMessage`：检查图片 magic bytes 和 SHA-256，预览确认、稳定会话身份、聊天水位、最终授权和发送后新消息回读。仅在平台回读确认后返回成功，否则不盲目重试。

## 限制

- GitHub 单元测试模拟浏览器及上游接入，不代表完成真实抖音账号私聊/群聊的发送实测。
- 上游上传组件/浏览器运行配置改变时，可能无法发送；默认拒绝，不降低身份/回执验证。
- `ENABLE_SENDING=false` 时只接收，不发送。
- 浏览器 profile、表情截图、OneBot 图片和管理后台令牌均是敏感资源，注意本机访问控制及日志脱敏。
