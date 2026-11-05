# 第三方组件、版权与许可声明

> 本文件用于说明 **DouyinBridge 自有代码与第三方作品的授权边界**。请与根目录 [LICENSE](LICENSE)（Apache License 2.0）和 [NOTICE](NOTICE) 一起阅读。

## 1. 授权范围

- 本仓库中的 **DouyinBridge 原创实现与原创文档**，在相关作者拥有授予许可所需权利的范围内，采用 **Apache License 2.0**。
- 根目录的 Apache-2.0 许可证 **不会覆盖、修改、取代或重新授权** 任何第三方作品。引用其接口、安装其依赖或提供补丁也不代表获得它们的全部版权。
- 使用者在重新分发包含第三方文件的构建产物时，必须核对**实际包含的文件**并保留其原有许可证、版权与必要通知。
- 本仓库目前不在 Git 中直接收录完整的上游浏览器代理源码；运行时上游代码由安装脚本单独获取，仍受上游自身的许可约束。

## 2. 上游浏览器与聊天能力

| 项目 | 来源 | 许可 / 用途 |
| --- | --- | --- |
| dsh-douyin-agent | [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent) | **MIT**，Copyright (c) 2026 LockyBee and contributors。用于聊天解析、浏览器适配、图片上传、原生视频分享等能力 |
| 固定上游提交 | `912873e2556d16a088d81dcbc6f7c0060614dd58` | `scripts/install-upstream.ps1` 拉取的版本 |
| 上游完整许可 | [LICENSE](https://github.com/LockyBee/dsh-douyin-agent/blob/912873e2556d16a088d81dcbc6f7c0060614dd58/LICENSE) | 以原始 MIT 许可文本为准 |
| 上游第三方声明 | [THIRD_PARTY_NOTICES.md](https://github.com/LockyBee/dsh-douyin-agent/blob/912873e2556d16a088d81dcbc6f7c0060614dd58/THIRD_PARTY_NOTICES.md) | 上游另行依赖的第三方模块及许可证信息 |

上游通过 `upstream/dsh-douyin-agent/` 单独安装并保留其自带 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。若重新分发包含上游源码或可执行组件的镜像/压缩包，应保留这些原始文件及依法要求的署名。**MIT 允许在遵守保留版权及许可声明等条件下使用和修改其代码，但不意味着可将原作者版权据为己有。**

## 3. 其他运行依赖

| 项目 | 来源 | 说明 |
| --- | --- | --- |
| ws | [websockets/ws](https://github.com/websockets/ws) | MIT；项目 npm 依赖，随 `npm install` 单独安装 |
| Playwright / Playwright Core | [microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0；浏览器自动化运行依赖，经上游或相应运行组件安装 |
| Node.js / Chromium | [nodejs/node](https://github.com/nodejs/node)、[Chromium](https://www.chromium.org/) | 各自包含不同许可证及第三方声明，按实际分发组件保留相应许可 |
| AstrBot | [AstrBotDevs/AstrBot](https://github.com/AstrBotDevs/AstrBot) | 通过 OneBot 协议连接的**独立项目**，不作为 DouyinBridge 源码直接收录 |

上述说明不是锁定依赖清单。实际版本以 `package-lock.json`、上游锁文件和运行环境为准；制作离线安装包或 Docker 镜像时，应额外审计镜像中**真实打包**的依赖及许可文本。

## 4. 第三方插件兼容补丁

`docs/patches/private-companion-douyin-media.patch` 是针对 [menglimi/astrbot_plugin_private_companion](https://github.com/menglimi/astrbot_plugin_private_companion) 的**独立兼容补丁**。它包含目标项目的代码上下文和补丁差异，并非 DouyinBridge 网关的自有源文件。

该项目当前检视的根目录未发现可用于本补丁的独立 `LICENSE` 文件；**不能据此推定其源代码按 Apache-2.0、MIT 或其他开源协议授权**。本仓库的 Apache-2.0 声明不适用于该补丁中的第三方代码上下文。计划将此补丁或包含它的衍生作品再分发时，请先核对目标项目的实际许可条件并取得必要授权。

## 5. 商标、平台和服务

- 抖音、AstrBot、DeepSeek 等名称、商标、账号和服务均属于各自权利人；在此仅用于指示适配对象。
- DouyinBridge **不是抖音官方项目**，也不代表平台授权、背书或提供长期接口兼容保证。
- 开源代码许可证不等同于取得第三方平台、账号、网站或云服务的使用许可；相关使用应遵守适用的服务条款与法律。

如发现许可证、版权归属或来源记录有误，请在项目 Issue 中附带具体文件和原始来源，以便核对修正。
