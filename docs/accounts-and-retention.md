# 免费账号与持续学习

正式站使用流程：公开介绍与学习指南 → 无需登录的示例试学 → 免费注册 → 完整学习台 → 我的学习与收藏复习。没有会员或付费限制。

注册使用 2–24 个字的用户名、邮箱验证码和至少 8 位密码，支持中文。注册成功直接进入学习台，不再显示恢复码。邮箱或旧用户名均可登录；找回密码需验证已绑定邮箱，会撤销旧会话。旧账号在“我的学习 → 账号安全与邮箱”用当前密码和邮件验证码绑定，保留原账号 ID 与本地空间。登录会话最长 30 天，管理员会话与普通用户账号分开。

视频、字幕、收藏、译文缓存、具体播放位置与自带翻译接口配置保存在本机，各账号使用不同的本地空间。首次注册后可以明确选择关联原有本机记录，保留旧副本。换设备不自动同步素材，也不上传视频。账号服务保存用户名、已验证邮箱、注册时间和来源、前台有效学习秒数与固定操作分类。

我的学习以每天 5 分钟为目标。当天累计至少 180 秒前台播放或主动复习计为有效学习日；切后台、暂停视频、空复习页不累计。复习计划为 1 / 3 / 7 / 14 / 30 天，不熟的收藏 10 分钟后再出现。客户端计时用于学习参考，可存在网络和多设备误差。

年度学习日历按北京时间自然年展示 1–12 月，右侧可切换最近五年及有历史记录的更早年份。颜色使用固定时长档位：未学习、不到 5 分钟、5–15 分钟、15–30 分钟、30 分钟及以上；有效学习天数仍按满 3 分钟计算。空年份显示灰色，未来日期不可选；手机在日历内部横向滑动，日期支持点击和方向键查看。登录用户的 `/api/account/summary?year=2026` 返回该年的 `history`（year / years / today / start / end / timeZone / days），原最近七天和累计指标不受年份筛选影响，仅能读取本人记录。数据每 20 秒及回到前台时刷新，切年份不会重置，失败时提示记录未更新。

注册、登录与找回页复用首页无声影视混剪和海报，模糊背景与表单遮罩适配浅深主题；系统减少动效、首页动效偏好或省流量模式保留静态画面，不加载影片，离开前台暂停。

后台“注册与留存”显示真实账号总数、区间新增、近 7 / 30 天学习用户、注册来源柱状图和注册队列。D1 / D7 观察注册后第 1 / 7 个北京时间自然日是否有效学习，完整观察日结束后才进入分母。仅登录不算有效学习；测试账号排除所有正式报表。只有管理员能看到用户名列表，分析平台只拿聚合数据。

只读统计接口新增 `/api/stats/v1/users`、`users-summary`、`users-timeseries`、`users-cohorts`、`users-sources`。沿用后台生成的只读 Bearer 密钥，支持 `start` / `end`（最长 90 天）和分项 `format=csv`；受现有 API / 导出开关控制，完整对象不支持 CSV。普通用户 Cookie 与管理员 Cookie 不能替代只读密钥。`/api/stats/v1/schema` 公开接口定义。

账号服务为独立 Cloudflare Worker + D1，不改动原有共享访问采集器。部署配置与秘密不入 Git；源码、SQL、测试、环境变量示例公开。自行部署可设置 `REPLAY_LOCAL_MODE=1` 直接使用学习台。指南和电影介绍页进入 sitemap，账号与学习私有页不进入搜索索引。

验证命令：

```powershell
node --test scripts/accounts-worker.test.mjs
npx tsx --test scripts/accounts-core.test.ts scripts/learning-session.test.ts scripts/learning-calendar.test.ts
npx tsx --require ./scripts/server-only-test.cjs --test scripts/admin-api.test.ts
npm run typecheck
npm run build
```

## 邮箱服务与验证码

Next 服务端使用 `RESEND_API_KEY` / `RESEND_EMAIL_DOMAIN` 调用 Resend。独立账号 Worker 的 additive SQL 增加 `account_emails` / `email_challenges`，不改变旧用户表和 ID。邮件只用于账号操作。验证码 6 位、10 分钟、最多 5 次错误尝试，60 秒重发冷却，邮箱每小时 5 封 / 每日 10 封，来源每小时 10 次，全站每日最多 90 封以留出免费计划余量。服务端记录 HMAC 摘要；发信成功后才激活；正确码以 D1 事务条件消费，与注册、绑定或重设原子执行。过期记录在后续发送时清理；注销清除相关绑定与挑战。找回请求对未绑定邮箱返回相同提示，不发邮件。不再对浏览器开放恢复码接口。

测试：`node --test scripts/accounts-worker.test.mjs` 与 `node node_modules/tsx/dist/cli.mjs --require ./scripts/server-only-test.cjs --test scripts/accounts-api.test.ts`。
