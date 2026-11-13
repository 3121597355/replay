# 免费账号与持续学习

正式站使用流程：公开介绍与学习指南 → 无需登录的示例试学 → 免费注册 → 完整学习台 → 我的学习与收藏复习。没有会员或付费限制。

注册使用 2–24 个字的用户名和至少 8 位密码，支持中文。注册成功显示一次随机恢复码，可复制或下载；忘记密码时用户名与恢复码共同验证，重设密码会撤销旧会话并换新恢复码。登录会话最长 30 天，管理员会话与普通用户账号分开。

视频、字幕、收藏、译文缓存、具体播放位置与自带翻译接口配置保存在本机，各账号使用不同的本地空间。首次注册后可以明确选择关联原有本机记录，保留旧副本。换设备不自动同步素材，也不上传视频。账号服务保存用户名、注册时间和来源、前台有效学习秒数与固定操作分类。

我的学习以每天 5 分钟为目标。当天累计至少 180 秒前台播放或主动复习计为有效学习日；切后台、暂停视频、空复习页不累计。复习计划为 1 / 3 / 7 / 14 / 30 天，不熟的收藏 10 分钟后再出现。客户端计时用于学习参考，可存在网络和多设备误差。

后台“注册与留存”显示真实账号总数、区间新增、近 7 / 30 天学习用户、注册来源柱状图和注册队列。D1 / D7 观察注册后第 1 / 7 个北京时间自然日是否有效学习，完整观察日结束后才进入分母。仅登录不算有效学习；测试账号排除所有正式报表。只有管理员能看到用户名列表，分析平台只拿聚合数据。

只读统计接口新增 `/api/stats/v1/users`、`users-summary`、`users-timeseries`、`users-cohorts`、`users-sources`。沿用后台生成的只读 Bearer 密钥，支持 `start` / `end`（最长 90 天）和分项 `format=csv`；受现有 API / 导出开关控制，完整对象不支持 CSV。普通用户 Cookie 与管理员 Cookie 不能替代只读密钥。`/api/stats/v1/schema` 公开接口定义。

账号服务为独立 Cloudflare Worker + D1，不改动原有共享访问采集器。部署配置与秘密不入 Git；源码、SQL、测试、环境变量示例公开。自行部署可设置 `REPLAY_LOCAL_MODE=1` 直接使用学习台。指南和电影介绍页进入 sitemap，账号与学习私有页不进入搜索索引。

验证命令：

```powershell
node --test scripts/accounts-worker.test.mjs
npx tsx --test scripts/accounts-core.test.ts scripts/learning-session.test.ts
npx tsx --require ./scripts/server-only-test.cjs --test scripts/admin-api.test.ts
npm run typecheck
npm run build
```
