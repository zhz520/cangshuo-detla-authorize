# 统一系统第一阶段：版本与付费授权试点

仓库：`https://github.com/zhz520/cangshuo-detla-authorize`。当前基于 742 保留完整业务系统，新增能力作为可选扩展。版本 `1.1.0-preview.1` 是本地验证预览版，不能视为已经发布到客户生产环境的正式版。

## 已实现

- 管理员后台新增「功能与更新」：功能商城、系统更新、收益对比分析。
- 保留基础业务与原有收益日报；不会将既有功能重新锁定收费。
- 功能目录随构建版本发布，记录模块编号、最低版本、依赖、入口与能力说明。
- 付费模块采用人工报价与人工签名开通，没有在线付款按钮或自动扣款。
- Ed25519 授权绑定客户编号和实例 UUID，校验签名、生效时间、到期时间与功能白名单。
- 获得授权与启用模块是两个步骤；接口每次访问仍验证授权，不能靠修改菜单或本地开关获得权限。
- 授权及启用状态保存在实例独立状态文件，以临时文件和原子替换持久化；无效导入不覆盖已有授权。
- 收益对比分析读取本实例已结算且状态为 CONFIRMED/REVIEWED 的订单，比较相邻等长周期，补齐无订单日期，支持每日汇总 CSV 导出。最多查询 366 天；上期为零不计算变化率。
- 已到期、尚未生效、错误客户或错误实例的授权不能访问付费接口；基础业务保持可用。

## 人工开通流程

1. 在签发端创建一次密钥。私钥只保留在你管理的签发设备上，不能提交 Git、放入客户镜像或客户服务器。该操作不会覆盖已有文件。

```powershell
node scripts/license-authority.mjs keygen --private-key D:/CodexData/outputs/platform-authority/license-private.pem --public-key D:/CodexData/outputs/platform-authority/license-public.pem
```

2. 客户实例配置 `PLATFORM_CUSTOMER_ID`、`PLATFORM_STATE_PATH`、`PLATFORM_PUBLIC_KEY_PATH`。只有公钥部署到客户实例。生产 Compose 已挂载 `runtime/platform` 到 `/app/platform`，可将公钥放入 `runtime/platform/license-public.pem`，再配置容器公钥路径 `/app/platform/license-public.pem`。开发环境默认状态位置为项目 `.local/platform/state.json`。
3. 客户从功能商城复制实例编号。迁移实例时保留状态文件及公钥；不要直接删除状态文件来重建 UUID。
4. 确认价格、期限和开通模块后签发。下面的实例编号为格式示例，必须替换为实际实例编号；到期时间必须明确指定带时区的 ISO 时间，永久授权使用 `--expires never`。

```powershell
node scripts/license-authority.mjs issue --private-key D:/CodexData/outputs/platform-authority/license-private.pem --customer 742 --instance 00000000-0000-0000-0000-000000000742 --features advanced_income_reports --expires 2027-11-01T00:00:00+08:00 --out D:/CodexData/outputs/platform-authority/client742.license.json
```

5. 客户将完整授权 JSON 粘贴到「导入授权」，校验成功后启用模块。新增或续期授权文件表示该客户的完整付费模块集合，签发时必须包含仍需保留的模块。新授权签发时间不能早于已导入授权。

## 权限与存储

新增接口统一位于 `/admin/platform/**`，同时通过管理员角色和方法权限检查；收益接口另校验模块授权。签发工具和测试不包含生产私钥。授权导入不进入会记录整个请求体的通用操作日志。

备份与迁移必须包含该实例的 `runtime/platform`（开发环境为 `.local/platform`），并保留访问权限。当前文件存储适用于单实例；多副本部署应改为事务数据库或独立授权服务。

本阶段使用离线签名授权，没有联网撤销、时钟防回拨、订阅支付或硬件防克隆。客户拥有 root 或源码时不能保证绝对防篡改。后续接中心服务时再增加在线租约、撤销、合理宽限期和签发审计。

## 尚未开放

- 中央客户、订单、价格与授权运营后台。
- 在线支付、自动开通、退款与订阅续期。
- GitHub 正式版本目录、签名发布包与自动下载。
- 更新代理、数据库版本迁移、备份恢复、自助安装及回退。

因此系统更新页明确显示未连接版本源，不将本地版本错误标为「已是最新」，也不提供无效的安装按钮。正式升级前须验证完整备份、数据库向后兼容和维护窗口，不能通过恢复旧库覆盖升级后的新订单。

## 验证

```powershell
npm run test:licensing
npm run verify:isolation
npm run build:admin
Push-Location delta-game
mvn -pl delta-admin -am test
Pop-Location
```

新增测试覆盖伪造签名、跨客户/跨实例授权、过期与未来生效、重启持久化、非法状态、旧授权覆盖、角色隔离，以及未授权时在读取业务数据前拒绝访问。

源码基线报告由 `npm run audit:platform` 生成；会排除 `.local-feature`、`.local-ui` 等历史备份目录，仅比较有效源码，不读取业务数据或密钥。
