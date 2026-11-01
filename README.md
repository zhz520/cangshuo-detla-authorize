# 沧烁授权运营中心

运营仓库：`zhz520/cangshuo-detla-authorize`；电竞客户端仓库：`zhz520/cangshuo-detla`。本中心也支持登记其他 Web、H5、小程序与自定义软件及其 GitHub 仓库。

## 管理结构

客户 → 项目 → 实例。每个项目选择软件和仓库，独立管理维护期、状态、暂停策略与通知邮箱。实例独立绑定 UUID、域名、模块授权与微信支付配置。现有实例自动迁移为独立项目，保留原编号和业务配置。

维护期就是授权到期时间。续期后重新生成与维护期一致的功能授权，客户端每 5 分钟同步；签名维护凭据用于本地到期判断，续期同步后恢复。现有项目的在途订单规则仍为 PENDING，确认策略前不自动启用业务暂停。其他技术栈项目须按协议接入验签和暂停逻辑，登记项目本身不会自动修改外部网站。

## 版本与更新

软件页配置各自 GitHub 仓库，版本页检查正式 Releases。忽略草稿和预览版，使用语义版本比较；客户端列出比当前版本新的每个版本。更新项可标记为必须更新、配置依赖和付费模块。属于同一程序包的内容一起更新。

更新计划由中心签名，绑定客户、实例、版本、校验值和短期有效期。客户端宿主执行器验证后备份、安装并健康检查，失败回退。缺少 GitHub SHA-256 digest 或正式组件包时不能安装。数据库结构变更目前不自动执行，执行器仅接受 schemaVersion=1，详见客户端 `deploy/updater/README.md`。

## 邮箱与插件

邮箱页配置 SMTP 服务器、SSL/TLS 或 STARTTLS、账号、发信授权码和发件人，支持测试邮件。维护期到期前 30、7、1 天和当天、续期、状态变更、正式发布、更新成功和失败产生通知；发信记录支持自动重试与人工重试。没有启用有效 SMTP 配置时不会发信。

插件页仅保留微信支付，按实例隔离参数，支持配置 H5、JSAPI、Native 和 App 支付方式。已移除阿里云短信和微信小程序插件入口，旧数据保留但停用。支付配置目前集中管理，实际客户支付方式启用及参数同步仍需完成接入，不能将参数保存视为支付渠道已经开通。

## 运行

推荐 Node.js 24，最低 22.13。本地可控文件与缓存放 D 盘：

```powershell
$env:TEMP='D:\CodexData\temp\detla-authorize'
$env:TMP=$env:TEMP
$env:TMPDIR=$env:TEMP
$env:npm_config_cache='D:\CodexData\temp\detla-authorize\npm-cache'
npm ci
npm run init
npm run build
npm start
```

初始化生成本地管理员配置和 Ed25519 密钥，不覆盖已有密钥。数据库位于 DATA_DIR/authority.sqlite，密钥、数据库和 operator.env 需在停服务后一起备份，并保留访问权限。不得提交私钥、登录密码、支付密钥或业务数据库。客户端只持有验证公钥。

Docker Compose 默认仅监听本机 17441，不增加客户服务端口。反代应保留 Host、X-Forwarded-Host 和 X-Forwarded-Proto；配置 AUTHORITY_ALLOWED_ORIGINS 与 COOKIE_SECURE=true。可通过 GITHUB_TOKEN 环境变量访问私有仓库，令牌不在界面回传。

## 客户端协议

运营人员可导出实例接入凭据（cangshuo-instance-v1），也兼容现有 delta-license-v1。POST /api/client/report 提交 {license, version, updateResult?}，返回签名项目维护凭据、当前功能授权及正式更新目录。过期的签名身份仍可查询续期；只有有效维护期能获得更新计划或业务访问权。调用方必须验证签名、客户与实例绑定、维护时间和域名。

POST /api/client/update-plan 提交 {license, version, componentVersions?, selection}，selection 使用 version:itemId。返回 cangshuo-update-v1 签名计划，不包含服务器命令、私钥或部署密码。

## 验证

npm test 验证授权、订单快照、CSRF、登录限流、项目隔离、续期同步、GitHub 正式版本、SMTP 重试和更新依赖。npm run build 构建运营界面。
