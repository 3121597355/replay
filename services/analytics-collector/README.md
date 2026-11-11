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

旧 visits 协议的访问摘要按站点、日期、IP/UA 的 HMAC 计算，不存原始 IP/UA，不跨日识别用户。来源只保存域名，设备/浏览器只保存分类。功能事件只接受固定事件名，不接收字幕、视频、文件名、单词、API Key 或自由文本参数。管理页和 API 不参与访问统计。事件 ID 重试去重，功能事件不增加 PV。原始事件保存 400 天。

旧学习表现和汇总接口用“访客日”表示每日访客估算之和，不伪装为跨日去重用户。来源、设备和功能事件从升级后开始采集，不补造历史数据。

## 停留与离开统计

2026.11.11.2 新增 `page_engagement` 表。先运行幂等 `schema.sql`，再部署 Worker；迁移只增加表和索引。网站统计脚本按版本更新缓存，只有 Replay 开启前台停留采集，其他站点原协议保持不变。

页面访问使用只在内存中的随机 ID，每 15 秒发送累计前台可见毫秒数；离页用 sendBeacon，失败时回退 keepalive。后台不累计，BFCache 恢复继续原访问且不增加 PV。数据库采用累计最大值、序号和固定操作标记，容忍重复、丢失心跳与乱序。视频、字幕、单词和文件名仍不上传。停留采集跟随 `eventsEnabled` 开关。

站内切页结束一条页面停留，但不算网站离开。关闭 / 刷新无法完全区分，因此用“离开 / 中断”。前台 2 分钟没有心跳、后台 30 分钟未返回时推断中断；后续恢复快照会自动修正。按最后信号的北京时间归入结束日期和小时；尚未结束的访问不参与平均值与短时离页比例。统计是页面访问次数，不能当作独立人数，也不是次日留存率。

`report.engagement` 新增汇总、页面、24 小时离开分布、停留与离开时长分段、设备对比、学习台操作与采集口径。原字段和 schemaVersion 1 保持兼容。网站只读 API 增加 `/engagement`（完整 JSON）、`/engagement-pages`、`/engagement-hours`、`/engagement-durations`、`/engagement-devices`，分项支持 CSV 并继续受导出开关约束。管理员报告仍需管理员登录，只读密钥仍不能进入管理页面。


## 访问质量概览（2026.11.11.3）

新增 traffic_pages（仅 CREATE 表及索引），保存与实际 PV 关联的短期会话、页面顺序、累计快照与匿名摘要。旧 visits、product_events、page_engagement、summary 和一览 status/data 全部保留。

同标签页连续浏览和刷新沿用 sessionStorage 中的随机访问 ID。前台活动持续更新有效期，30 分钟没有活动后开始新访问；同页恢复过期访问也会新建 PV。关闭标签页后不留长期浏览器 ID，不用 cookie。禁用存储时退回内存，跨整页导航无法关联。普通独立标签页会分别开始访问；复制标签页可能继承会话，这是一项浏览器存储口径限制。尊重 DNT/GPC，管理页和 API 不采集。页面 ID 仍不持久化，BFCache 继续原 PV，但提升活动顺序，避免旧页面的延迟离页信号误判新页面已结束。

新版访客使用独立用途的 HMAC(traffic-v1 + siteId + IP + UA)，只存站点专属匿名摘要，支持所选访问范围内跨日去重估算。原始 IP/UA、学习视频、字幕、生词等不落库。匿名 UV 不能保证精确人数：同网络同浏览器可能合并，设备或网络变化可能重复。旧按日摘要和原一览连接不受影响。

五项全部使用新版关联访问范围，按访问开始日期归入北京时间：访客为摘要去重数；访问次数为会话数；浏览量为这些会话内实际 PV 数（心跳先到也不计 PV）。关闭留 15 秒等待刷新或返回，回来可修正；没有离页信号时 30 分钟无活动推断结束。站内切页不立即结束会话。跳出率和平均时长仅使用已结束、各页均有快照的有效访问样本，缺失或未结束不伪造 0，分母在界面和接口给出。跳出需单页、前台少于 10 秒且没有播放/查词/收藏/循环/导出标记；平均时长为各页前台可见时间之和按访问平均，不计后台或休眠，不等于学习时长。

report.traffic 提供 summary、points、entries、sources、firstSeen、coverageStart 和 definitions。独立只读 API 新增 traffic（完整 JSON）、traffic-summary、traffic-timeseries、traffic-entries、traffic-sources；分项支持 CSV，仍受鉴权和导出开关限制。无时长样本返回 null；页面显示 —。旧历史无法补算会话，单独保留，不能与新会话访客混用。停留快照受 eventsEnabled 设置控制，关闭后基础 PV/会话仍记录，缺失的时长不进入分母。

浏览器源代码采用字符串字面量，禁止通过函数 toString 注入（Wrangler 会引入不可用的闭包辅助函数）。发布必须在 Wrangler dry-run 后从实际打包 Worker 获取 tracker.js，使用 REPLAY_TRACKER_BUNDLE_FILE 跑生命周期测试。
