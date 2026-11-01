# 742 独立客户项目

从 `D:\codeStudy\code\detla` 当前源码复制到 `D:\codeStudy\code\742`，保留原主题、页面布局、配色和业务功能。未继承原客户的 Git 历史。

统一系统与付费授权试点见 [第一阶段说明](docs/platform-foundation.md)。新增的 `1.1.0-preview.1` 属于开发预览，下面的线上入口不代表该预览版已发布。

## 已上线

| 入口 | 地址 |
| --- | --- |
| 管理后台（域名） | https://jgsapi.kk520yy.com/ |
| H5（域名） | https://jgs.kk520yy.com/ |
| 管理后台 | http://103.38.82.146:7420/ |
| H5 | http://103.38.82.146:7421/ |

线上品牌名称为“斜阳电竞”，已使用客户提供的山形 Logo。服务器部署目录为 `/opt/apps/742`，Compose 项目名为 `jiangaoshan-742`；MySQL、Redis 和后端只在项目私有网络通信。管理员默认账号为 `admin`，密码保存在本地 `.env.local` 的 `BOOTSTRAP_ADMIN_PASSWORD`。

## 已保留

- `delta-admin-ui/`：Vue 3 管理后台。
- `delta-mp/`：UniApp 用户端、接单员端、客服端，支持 H5 与微信小程序。
- `delta-game/`：Spring Boot 十个业务模块，包括订单、支付、聊天、打赏、结算和提现。
- 原有依赖锁文件、源代码与通用静态资源。

## 独立数据与配置

未复制原客户的商品、分类、热门推荐、轮播、公告、账号、接单员等级、订单、聊天、钱包、交易、提现、评价、上传文件、日志、支付凭据、短信模板 ID、生产域名或部署记录。数据库仅包含完整表结构与 19 项新的基础配置；费率、押金等默认规则应在上线前按新客户要求配置。

管理端登录缓存、移动端本地存储、MySQL 数据库、Redis 实例和服务端口均已隔离。Java 包名和模块名保留 `com.delta` / `delta-*`，便于沿用原维护方式。

| 服务 | 本地地址 / 名称 |
| --- | --- |
| 管理后台 | http://127.0.0.1:17420 |
| H5 | http://127.0.0.1:17421 |
| 后端 | http://127.0.0.1:17422 |
| MySQL | `127.0.0.1:17423`，数据库 `client742_game`，用户 `client742` |
| Redis | `127.0.0.1:17424`，逻辑库 `7`，独立实例 |

## 首次配置

在项目根目录的 PowerShell 中执行：

```powershell
.\scripts\Initialize-Environment.ps1
```

随机数据库密码、Redis 密码、AES / JWT 密钥及全新管理员密码生成到本项目 `.env.local`，该文件已被 Git 忽略；重复执行不会覆盖。初始化管理员默认名为 `admin`，密码请在本机查看该文件的 `BOOTSTRAP_ADMIN_PASSWORD`。仅在显式启用且管理员表为空时创建新管理员，不重置已有账号；首次创建后可将 `BOOTSTRAP_ADMIN_ENABLED` 改为 `false`。

## 构建和启动

需要 Node.js 20.19+ 或 22.12+、JDK 17 和 Maven 3.9+。当前副本带有独立复制的本地前端依赖，可直接构建；全新检出后分别在两个前端目录执行 `npm ci`。构建前设置可控制的临时目录和 npm 缓存到 D 盘：

```powershell
$env:TEMP='D:\CodexData\temp\742-rebrand'
$env:TMP=$env:TEMP
$env:TMPDIR=$env:TEMP
$env:npm_config_cache='D:\CodexData\temp\742-rebrand\npm-cache'
npm run verify:isolation
npm run build:admin
npm run build:h5
Push-Location delta-game
mvn package
Pop-Location
```

使用 Docker Desktop 运行全部服务（需先启动 Docker 引擎）：

```powershell
docker compose --env-file .env.local -f deploy/compose.yml up -d --build
```

MySQL 只在新的 `runtime/mysql` 目录初始化时导入两份 `database/` 脚本。不要挂载原客户的数据目录，也不要导入原项目 SQL。运行文件绑定到本项目 `runtime/`，容器镜像与 Docker 引擎自身的数据位置仍由 Docker Desktop 设置管理。

只运行基础设施并在本地开发：

```powershell
docker compose --env-file .env.local -f deploy/compose.yml up -d mysql redis
.\scripts\Start-Backend.ps1
# 在其他两个终端中分别执行：
npm run dev:admin
npm run dev:h5
```

不用 Docker 时，可手动创建全新的 `client742_game` 数据库并导入根目录 `delta_game.sql`，配置独立 MySQL / Redis 连接后启动。`delta_game.sql` 与两份 `database/` 脚本内容一致，只需选择一种导入方式。

## 微信小程序和上线配置

H5 默认通过同源 `/api` 和 `/ws` 代理访问新后端。小程序不支持同源相对 API 地址；构建前将 `delta-mp/.env.mp-weixin.example` 复制为 `delta-mp/.env.mp-weixin`，填写新客户的 HTTPS API 与 WSS 地址，并在 `manifest.json` 中配置新 AppID，然后执行 `npm run build:mp-weixin`。

支付和短信默认关闭，须使用新客户自己的商户号、密钥、证书、短信账号、模板、回调域名及协议内容。站点名称和 Logo 已配置为 742 客户资料，原有主题保持原样。分类、商品、公告和接单员等级初始为空，由新客户自行录入。

来源文件校验记录见 `docs/clone-manifest.json`；交付检查见 `docs/验证记录.md`。
