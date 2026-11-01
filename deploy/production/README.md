# 斜阳电竞 742 生产部署

服务器：`103.38.82.146`。项目目录：`/opt/apps/742`。Compose 项目名：`jiangaoshan-742`。

公网入口：

- 管理后台（域名）：`https://jgsapi.kk520yy.com/`
- H5（域名）：`https://jgs.kk520yy.com/`
- 管理后台：`http://103.38.82.146:7420/`
- H5：`http://103.38.82.146:7421/`

MySQL、Redis 和后端只在 Compose 私有网络内通信，不映射宿主机端口。两个入口使用独立 742 端口，不复用原客户或宝塔站点端口。

宝塔反向代理分别指向 `127.0.0.1:7420` 和 `127.0.0.1:7421`。域名必须同时写入后端 `ALLOWED_ORIGINS`，否则 Spring Security 会在登录请求前返回 403 `Invalid CORS request`。

服务器目录结构：

```text
/opt/apps/742/
├── deploy/production/
├── database/
├── delta-admin-ui/dist/
├── delta-mp/dist/build/h5/
├── delta-game/delta-admin/target/delta-admin.jar
├── runtime/mysql/
├── runtime/redis/
├── runtime/uploads/
└── .env
```

首次启动：

```bash
cd /opt/apps/742
docker compose --env-file .env -f deploy/production/compose.yml up -d --build
```

管理员仅在新数据库 `admin` 表为空时创建。已有管理员后，即使引导环境变量仍存在，也不会重置账号。

当前未提供微信支付凭证、短信模板和微信小程序 AppID，因此支付与短信保持关闭。配置新客户资料后须重新启动后端。
