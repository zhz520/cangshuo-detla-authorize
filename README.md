# 沧烁授权运营中心

运营仓库：`zhz520/cangshuo-detla-authorize`；电竞客户端仓库：`zhz520/cangshuo-detla`。本中心也支持登记其他 Web、H5、小程序与自定义软件及其 GitHub 仓库。

## 管理结构

客户 → 项目 → 实例。每个项目选择软件和仓库，独立管理维护期、状态、暂停策略、默认支付接入与通知邮箱。实例独立绑定 UUID、域名和模块授权，并从所属项目继承支付通道与默认支付方式。现有实例自动迁移为独立项目，保留原编号和业务配置。

客户管理支持新增、搜索、编辑名称与备注、启用或停用以及删除。停用客户后不能继续为其新增实例；仍有关联项目或实例的客户禁止物理删除，避免误删授权关系。

## 多租户运行时导出

实例可登记全局唯一的小写 `runtimeTenantId`（1 至 48 位小写字母、数字或短横线），例如 `jax`、`742`、`747`。它不同于授权实例 UUID；UUID 继续作为 `platformInstanceId`，缺失运行时租户编号的实例不会被导出。授权管理员登录后可读取 `GET /api/runtime/tenants`，导出 `formatVersion`、`generatedAt` 和按运行时租户编号排序的 `tenants`，每个租户包含客户、项目、软件、平台实例、规范化后的普通域名、通配域名、维护期和启用状态。该接口只读，不返回数据库密码、支付密钥、私钥、令牌或其他业务数据；项目或客户停用时 `active=false`。

## 共享服务组与签名发布

授权管理员可在“服务组发布”页面登记服务组、添加已配置 `runtimeTenantId` 的实例，并创建共享服务组发布计划。服务组成员必须属于同一软件，实例只能属于一个服务组；计划会绑定当前启用的租户集合、维护窗口、正式版本和三个 backend/admin/h5 制品的 URL、大小与 SHA-256。计划使用授权中心 Ed25519 私钥离线端签发，浏览器只接收签名信封，不接触私钥。

共享服务组计划只供受控的 `shared_worker` 使用。授权中心不执行服务器命令，不接收任意路径、容器名或数据库迁移；生产执行器必须先验签、备份数据库和文件、按后端/后台/H5 顺序启动并完成健康检查，失败回退。运营后台的服务组页面不会直接替换客户线上文件。

私有 GitHub 仓库的制品不由浏览器下载，也不把访问令牌放入前端或更新计划。发布执行器通过服务器 root-only 配置中的 `github_token_path` 读取只读令牌，并用 GitHub Release API 定位制品；跳转到资产域名时不携带令牌。令牌不得写入签名计划、日志、普通文档或聊天。

详细发布记录见[共享服务组发布说明](docs/0.7.0-多租户服务组发布.md)。

功能与定价支持新增、查询、编辑和删除模块。已有订单或授权记录的模块禁止删除，可改为草稿停止销售。`official_wechat_notifications` 默认以 100 元上架，客户获得签名授权后在客户后台功能商城启用。

授权管理员可在项目设置中记录项目定金、尾款和收款备注。金额按元录入、按分保存，项目列表显示定金、尾款及合计。该记录用于商务核对，不会创建订单、触发扣款或改变维护期/授权状态。

维护期就是授权到期时间。续期后重新生成与维护期一致的功能授权，客户端每 5 分钟同步；签名维护凭据用于本地到期判断，续期同步后恢复。项目可选择到期后暂停全部请求，或停止新业务并允许已存在的业务完成。其他技术栈项目须按协议接入验签、域名和暂停逻辑，登记项目本身不会自动修改外部网站。

## 版本与更新

软件页可配置各自 GitHub 仓库；不使用 GitHub 的软件可留空仓库和令牌，仍能正常登记项目、维护期、授权和商务金额，只是不启用自动版本检查。版本页检查正式 Releases，忽略草稿和预览版，使用语义版本比较；客户端列出比当前版本新的每个版本。更新项可标记为必须更新、配置依赖和付费模块。客户端可逐项勾选或取消非必要内容，必须更新、所选内容的依赖和付费授权由中心复核；这些条件不满足时不会生成安装计划。

客户端的“查看发布说明”和版本页使用授权运营中心的公开说明页 `/public/release-notes/<软件编号>/<版本号>`，不会向客户暴露私有 GitHub 地址；客户端版本目录也不再返回仓库名和 GitHub 资产地址。反代需保留 `Host`、`X-Forwarded-Host` 与 `X-Forwarded-Proto`，也可配置 `AUTHORITY_PUBLIC_URL=https://授权域名` 固定对外链接。

更新计划由中心签名，绑定客户、实例、版本、校验值和短期有效期。客户端宿主执行器验证后备份、安装并健康检查，失败回退。缺少 GitHub SHA-256 digest 或正式组件包时不能安装。数据库结构变更目前不自动执行，执行器仅接受 schemaVersion=1，详见客户端 `deploy/updater/README.md`。

## 系统设置、邮箱与支付

邮箱页配置 SMTP 服务器、SSL/TLS 或 STARTTLS、账号、发信授权码和发件人，支持测试邮件。维护期到期前 30、7、1 天和当天、续期、状态变更、正式发布、更新成功和失败产生通知；发信记录支持自动重试与人工重试。没有启用有效 SMTP 配置时不会发信。

运营菜单按工作台、客户与项目、授权与发布、系统设置分组。微信支付已从插件页移到系统设置中的支付设置。商户号、API v3 密钥、回调地址在系统级统一维护，密码字段保存后不回显。商户私钥和微信支付公钥可在对应字段旁直接上传，服务会校验 PEM 内容，并以受保护权限保存到 `DATA_DIR/payment-keys/wechat/` 后自动回填路径。支付与退款回调只填写客户系统自己的公网 HTTPS 地址，固定路径分别为 `/api/pay/wx/notify` 和 `/api/pay/wx/refund-notify`，详见[微信支付配置说明](docs/wechat-payment-configuration.md)。

系统启用微信支付并可选择 H5、JSAPI（小程序）、OFFICIAL（公众号）、Native 或 App 后，项目设置页才可选择该通道作为默认接入，并选择项目允许在授权中心收款页使用的支付方式。公众号支付需要单独配置公众号 AppID、AppSecret 与 HTTPS 站点 Origin。客户在客户端功能商城点击购买或续费后，客户端只提交签名实例和功能编号；授权中心按系统定价创建订单并生成一次性收款链接。商户号、API v3 密钥、证书和公众号材料仅保存在授权中心，不会同步给客户端。微信支付回调由授权中心验签、核对金额并自动签发功能授权，客户端随后同步授权结果。

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

Docker Compose 默认仅监听本机 17441，不增加客户服务端口。反代应保留 Host、X-Forwarded-Host 和 X-Forwarded-Proto；配置 AUTHORITY_ALLOWED_ORIGINS 与 COOKIE_SECURE=true。私有仓库在“软件与仓库”编辑页填写 Fine-grained 令牌，只选择当前仓库并授予 Contents: Read-only。令牌按软件隔离，保存后不回显。也兼容 GITHUB_TOKEN 环境变量。

## 客户端协议

运营人员可导出实例接入凭据（cangshuo-instance-v1），也兼容现有 delta-license-v1。POST /api/client/report 提交 {license, version, updateResult?}，返回签名项目维护凭据、当前功能授权及正式更新目录。过期的签名身份仍可查询续期；只有有效维护期能获得更新计划或业务访问权。调用方必须验证签名、客户与实例绑定、维护时间和域名。

POST /api/client/update-plan 提交 {license, version, componentVersions?, selection}，selection 使用 version:itemId。返回 cangshuo-update-v1 签名计划，不包含服务器命令、私钥或部署密码。

## 验证

npm test 验证授权、订单快照、CSRF、登录限流、项目隔离、续期同步、系统支付与项目默认接入、项目定金尾款、GitHub 正式版本、SMTP 重试和更新依赖。npm run build 构建运营界面。
