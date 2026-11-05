# DouyinBridge 公开发布前检查清单

本文件区分“已经由维护代码完成的修复”与“必须由仓库所有者人工确认”的事项。**当前项目应先保持 Private，直到剩余 P0 项目得到确认。**

## 已执行的非破坏性修复

- [x] 当前主分支移除第三方插件的兼容补丁及其安装说明，避免在最新源码包中继续分发未核实授权的代码上下文。
- [x] 文档将当前功能与历史版本区分，修正 GitHub 新仓库地址、一次性白名单迁移说明。
- [x] 扩展 `.gitignore` 对 .env 变体、浏览器 Profile、数据库、备份文件和常见私钥的覆盖。
- [x] 检测未替换的 OneBot 示例令牌，阻止以默认占位值运行。
- [x] `package-lock.json` 锁定的 `ws` tarball 地址切换为 npm 官方 Registry，并保留 integrity 校验。
- [x] 加固 GitHub Actions：最小权限、`npm ci`、Windows/Ubuntu 单测、npm 生产依赖审计。
- [x] 增加 `SECURITY.md`、`CONTRIBUTING.md`、Dependabot 和发布前检查文档。

## P0：正式公开前需人工处理

- [ ] **第三方补丁仍留在旧 Git 提交中。** 修改当前分支不会删除历史文件。公开已有历史前，请先核对目标插件源码及补丁上下文是否可依法再分发。若无授权，可另外创建不含旧历史的干净公开仓库，或在备份、团队协调之后审慎使用 `git-filter-repo` 净化历史。**不要简单把当前已有 17 个提交的私有仓库直接切成 Public，就认为已删除补丁。**
- [ ] **确认提交作者信息可以公开。** 提交历史中存在带个人姓名、非 GitHub `noreply` 地址的元数据。Git 公开后可被他人读取。需由有权决定者确认公开与否；如果要改写历史，先备份并评估 PR、签名、旧克隆带来的影响。
- [ ] **确认测试作品 ID、文档、提交差异没有私人内容。** 本次基于常见密钥格式与历史文件路径的检查未发现明显凭据，但这不是法证级审计。如曾经上传真实凭据，首先撤销与轮换；删除或改写 Git 历史不等于凭据失效。
- [ ] **决定公开方式和历史保留策略。** 保留完整旧提交更方便追溯，但会公开所有旧文件、作者及补丁；另建干净仓库更利于明确版权边界。涉及历史重写前需要明确确认。

## P1：发布后建议在 GitHub 网页手动启用

- [ ] 在 Settings → General 将仓库 Visibility 改为 Public（仅在全部 P0 完成后）。
- [ ] 在 Settings → Security / Advanced Security 开启 Secret Scanning、Push Protection、Dependabot Alerts，以及适用的 CodeQL 扫描。
- [ ] 在 Settings → Security → Advisories 开启 Private Vulnerability Reporting（如有权限和入口）。
- [ ] 在 Settings → Actions → General 限制 GITHUB_TOKEN 默认权限为只读，运行本仓库的受信任工作流。
- [ ] 保护主分支并要求 PR 通过 CI；设置 Description、Topics、Issue 模板、首个 Preview 版本说明。
- [ ] 使用知情同意的测试账号验证 Windows Chromium 扫码登录、AstrBot 对接、私聊/群聊以及视频卡片分享。未完成真实验收前不要称为生产稳定版。

## 历史清理的注意事项

GitHub [官方文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) 说明：重写历史会改变提交哈希，并可能影响旧克隆、Pull Request、签名、分支保护和缓存。即使强制推送，已被复制的数据也未必能被完全抹除。处理前请先备份、确认权利和期望，并避免混用旧历史。

**目前的维护目标**：保留私有仓库工作成果，不擅自执行 destructive force-push；先将可直接修正的公开分发风险降低，再由仓库所有者决定是否以新的干净历史公开。
