# 剧说英语账号服务

独立 Cloudflare Worker + D1，不共用或修改匿名统计采集器的数据库。网站通过服务端代理访问，浏览器不会取得服务密钥或密码哈希。

## 部署

使用自己的 Cloudflare 账号创建 D1 数据库，复制 `wrangler.example.json` 为不入库的 `wrangler.local.json`，填写新数据库 ID。

```sh
npx wrangler d1 create jushuo-accounts --location apac
npx wrangler d1 execute jushuo-accounts --remote --config wrangler.local.json --file schema.sql
npx wrangler deploy --config wrangler.local.json
npx wrangler secret put ACCOUNT_SECRET --config wrangler.local.json
```

最后一步输入高熵随机服务密钥。在网站服务端配置 `REPLAY_ACCOUNTS_URL`、`REPLAY_ACCOUNTS_SECRET`，后者与 Worker 密钥一致；邮箱功能还需 `RESEND_API_KEY` 与验证通过的 `RESEND_EMAIL_DOMAIN`。更新已有数据库时，`schema.sql` 只创建缺失的表和索引，不修改旧用户 ID；更新 Worker 时保留已有密钥。不得使用 `NEXT_PUBLIC_` 存放密钥。自部署只需要本地学习时设置 `REPLAY_LOCAL_MODE=1`，不启用注册。

## 数据与权限

- 用户名、邮箱与邮件验证码注册；密码在 Next.js Node 服务端使用 scrypt N=32768,r=8,p=3、独立随机盐与 32 字节输出。数据库保存算法、参数、盐和哈希，不保存明文密码。
- 邮件验证码具有 6 位随机数，10 分钟有效，只保存 HMAC 摘要，最多 5 次错误尝试；发送成功才激活，在 D1 事务中与账号写入一起单次消费。新注册不生成恢复码。旧账号支持原用户名登录，绑定邮箱保留账号 ID；重设密码撤销所有账号会话。恢复码内部接口只保留旧服务兼容，Next 公共接口已取消。
- 登录令牌为随机 256 位值，Cookie 使用 HttpOnly、SameSite=Lax，HTTPS 上使用 Secure。D1 只保存令牌摘要，有效期 30 天。
- 写操作由 Next.js 检查同源 Origin 与请求大小。账号 Worker 所有数据接口要求独立服务密钥，只有 `/health` 公开；不为浏览器开放跨域数据访问。
- 账号学习记录只有日期、实际前台时间和固定操作名。视频、字幕、文件名、翻译密钥和收藏内容不进入账号数据库。
- 限流分开处理注册、登录、恢复和学习记录。所有客户端指标都只是浏览器报告，不应宣传成不可伪造的学习效果证明。
- 用户注销删除该账号的云端资料、邮箱、验证码、会话和活动。不会删除浏览器缓存或电脑原文件。
- 管理员访问由现有独立后台鉴权确认；普通用户令牌不能访问后台。统计只读 API 只输出聚合账号数量、队列、趋势和来源，不输出用户名或用户 ID。

## 指标

有效学习日为北京时间自然日累计至少 180 秒前台视频播放或主动复习。周/近 30 天活跃为对应范围至少一天有效学习的独立账号。D1 / D7 使用注册后第 1 / 7 个自然日；只有完整观察日已经结束的注册队列进入分母。新功能不会补造历史用户。测试账号通过内部管理接口标记，排除在所有管理统计之外。

同一账号、同一个活动事件 ID 重试只保存一次。播放时间受服务端会话经过时间和每次 60 秒上限约束；个人分钟数以客户端实际前台计时为基础，后台挂页不累计。

## 验证

`node --test scripts/accounts-worker.test.mjs`（Node 24）检查 D1 SQL、数据隔离、会话撤销、重试、留存分母与测试账户排除。`npx tsx --test scripts/accounts-core.test.ts` 检查密码验证、跳转限制和本机账号隔离。最终还需要真实 HTTP 与浏览器走通注册、试学、恢复和继续学习。
