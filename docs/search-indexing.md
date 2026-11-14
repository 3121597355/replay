# 搜索引擎收录与站点验证

正式网址：`https://www.replayen.com/`。

## 百度所有权验证

首页的 `metadata.verification.other` 输出 `baidu-site-verification` 标签，值为 `codeva-CqsB4eQIWj`。

原始下载文件逐字节保存在 `public/baidu_verify_codeva-CqsB4eQIWj.html`，发布后可通过 `https://www.replayen.com/baidu_verify_codeva-CqsB4eQIWj.html` 直接读取。文件内容与标签值不同，分别按百度提供的原值使用。验证成功后持续保留文件与标签，不要将该文件加入学习内容或 sitemap。

网站发布并确认响应正常后，在百度搜索资源平台对应站点点击“完成验证”。代码发布本身不代表平台验证成功，也不代表搜索引擎已经收录。

## 链接提交与收录检查

站点地图：`https://www.replayen.com/sitemap.xml`，只列公开介绍与指南页面。使用站长账号当前开放的 sitemap 或普通链接提交入口。先提交首页和重要指南，再通过平台抓取、索引报告核查结果。

Bing 与 Google 需要各自的站点验证信息；百度验证不能替代其他平台的验证。站长平台的提交密钥、账号凭据不得写入源码。
