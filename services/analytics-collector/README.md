# Replay / 一览统计采集服务

此版本沿用用户一览项目的访问采集器，扩展 Replay 管理后台、功能事件、来源/设备与只读统计 API。原 `GET /v1/websites/:id/status` 和 `data` 保持版本 1 的返回格式，现有一览同步连接无需更换。

所有后台鉴权与设置保存在 Cloudflare 服务和 D1，Vercel 只代理同源请求；不要用 Vercel 临时磁盘保存设置。生产入口 `/admin`，管理会话 8 小时，只读密钥不能登录管理页面。

部署时复制 `wrangler.example.json` 为 `wrangler.local.json`，填入已有 D1 ID。先执行 `schema.sql`，它仅新增表和索引；然后设置管理员秘密并部署 Worker。现有 READ_TOKEN、VISITOR_SALT 保持不变，避免影响一览和当日访客口径。

新增秘密：

- `REPLAY_ADMIN_SECRET`：至少 32 字符随机值，签名管理会话。
- `REPLAY_ADMIN_PASSWORD_HASH`：`随机盐:PBKDF2-SHA256摘要`，100000 次迭代；密码本身不上传、不入库。

管理员账号为 `admin`。可以在后台“账户安全”验证当前密码后修改，密码摘要保存在 D1，所有旧管理员会话立即失效，只读统计密钥保持有效。新密码需为 12～128 个字符，密码本身不入库、不提交 Git。

应急密码重置：重新生成盐与摘要并更新 `REPLAY_ADMIN_PASSWORD_HASH`，同时轮换 `REPLAY_ADMIN_SECRET`；如果管理员曾在页面改过密码，还需从 `admin_settings.data` 删除 `passwordHash` 字段，让环境中的摘要重新生效。该修改只针对 Replay 站点，保留其统计开关和 tokenHash，使用 D1 JSON 字段更新避免覆盖其他设置。

新接口：`/v1/websites/:id/admin/login`、`report`、`settings`、`token`、`password`。登录之外均需管理员签名会话；只有 `report` 可使用独立统计只读密钥。统计 API 开关和只读密钥摘要存入 `admin_settings`，轮换立即使旧密钥失效。密码变更提升数据库 sessionVersion，旧签名会话的版本检查不通过；设置更新按 JSON 字段合并，避免覆盖密码摘要或其他权限字段。

访问摘要按站点、日期、IP/UA 的 HMAC 计算，不存原始 IP/UA，不跨日识别用户。来源只保存域名，设备/浏览器只保存分类。功能事件只接受固定事件名，不接收字幕、视频、文件名、单词、API Key 或自由文本参数。管理页和 API 不参与访问统计。事件 ID 重试去重，功能事件不增加 PV。原始事件保存 400 天。

界面用“访客日”表示每日访客估算之和，不伪装为跨日去重用户。来源、设备和功能事件从升级后开始采集，不补造历史数据。
