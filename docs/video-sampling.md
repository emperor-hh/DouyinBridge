# DouyinLuma v0.5.0 — 真实视频分时采样

## 功能定位

本功能按需从**已授权会话中的已核实分享卡片**打开抖音公开作品，在独立临时标签页中静音播放约 3 秒，收集 3 张有时间线信息的 JPEG 实际视频画面，并通过 OneBot v11 image 段发送给 AstrBot 的视觉模型。

它不是视频下载器，不提供音轨、字幕或完整视频理解。不使用 DouyinLuma 自建 LLM；视频理解、文字生成由 AstrBot 负责。用户必须明确提出分析请求，不能仅发送视频卡片。

## 启用方式

1. 更新到 v0.5.0：`git pull`，`npm install`；请先备份 data/allowlist.sqlite。
2. 编辑 `.env`（选填）：`VIDEO_SAMPLE_SECONDS=3`，范围 1–5 秒。
3. 启动：`node --env-file=.env src/index.mjs`。
4. 打开 `http://127.0.0.1:3219/`，输入管理 token。
5. 先启用目标私聊或群聊的普通白名单，再打开 **按需视频分时采样**。权限变化无需重启。

## 私聊触发

好友先发送一个抖音视频分享卡片，再说“帮我分析这个视频”。
同一条消息同时包含可信视频卡片与明确分析请求也可识别。

## 群聊触发

某群成员先发送视频分享卡片，然后**同一成员** @机器人 并说“分析这个视频”。需能核实群成员 ID 和 @的是机器人本人。其他成员的卡片或没有 @机器人的请求不会触发视频播放。

## 风险防护

- 仅允许 `https://www.douyin.com/video/<数字 ID>`，来源须为已核实卡片；必要时才调用上游 `openSharedVideo` 来核对作品链接。
- 采样页和聊天页独立；普通网页自动暂停视频，仅通过作品身份和唯一播放器检查的采样页能够静音播放。
- 3 帧（JPEG），单帧不超过 220 KB；优先从 video canvas 采样，跨域导致画布不可用时回退到 CDP 仅截图可见的播放器区域。
- 先后核验视频页面 URL、播放器身份、视频流来源、播放进度及解码帧。核验不通过不输出采样帧。
- 采样结束（包括异常）都会尽力暂停并关闭临时视频标签页。需要避免多人共用单一浏览器 profile。
- 每会话 90 秒冷却、24 小时 5 次，全局 24 小时 30 次；SQLite 记录请求 ID，重复请求不重复播放。
- 取消授权时会请求终止正在采样的任务；取消授权前已发送给 AstrBot 的画面无法撤回。
- 出错时向 AstrBot 明确声明**未取得视频画面**，禁止仅根据标题或链接推断视频内容。
- 不会把采样帧发给 Douyin 用户，`ENABLE_SENDING=false` 时依然不会发送文字回复；AstrBot 的最终回复仍受到原发送门禁约束。

## 限制

本实现借鉴 dsh-douyin-agent `core.mjs` 中 `observeChatSharedWork`、`captureSharedFrames` 的验证原则，但因为原项目使用专用 Edge/CDP 而 DouyinLuma 使用持久 Chromium，实际采样使用独立的 Playwright 页面实现，不直接加载上游的 AI/自主视频观看 worker。

**尚无真实抖音登录环境的完整端到端验证**；无头环境可能出现登录、视频打不开、跨域或播放器缺失等问题；群 @ 和 OneBot base64 图片能否被特定 AstrBot 配置接收，也需要当地环境测试。日志和图片可能包含私密信息，请保护本机 data 目录及控制台 token。

## 许可

参考 [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent)（MIT）；遵守其 LICENSE 和 THIRD_PARTY_NOTICES。
