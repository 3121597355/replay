# 下载器检查版本

源工具位于 `K:\work\MangaShelf\video-downloader`。本目录只复制源码、静态页面和测试；浏览器配置、Cookie、下载历史、下载文件和二进制未复制。

## 当前运行范围

这是监听 `127.0.0.1` 的本地工具。使用 Node.js 22.4 或更新版本；当前验证使用 Node.js 24。需要 FFmpeg；处理平台网页时还需要 yt-dlp，浏览器解析使用本机 Chrome/Edge。

```powershell
$env:YTDLP_PATH = '你的 yt-dlp 路径'
$env:FFMPEG_PATH = '你的 ffmpeg 路径'
node server.mjs
```

可配置 `PORT`、`DOWNLOADS_DIR`、`HISTORY_FILE`，默认端口 45210。当前 API 拒绝非回环 Host 和跨站 Origin。

## 此次修复与验证

- 补齐 IPv4 映射 IPv6 的内网地址拦截。
- 防止其他网页及 DNS 重绑定域名调用本机 API。
- 解析子进程 45 秒超时，下载子进程默认 10 分钟超时。
- 单文件默认上限 500 MiB，未完成任务默认最多 20 个，下载并发保持 2。
- 使用明确的 yt-dlp 参数，不读取电脑中可能存在的默认配置。
- 启动不再依赖固定的 K 盘 Node 路径。

测试：`node --test tests/*.test.mjs`。真实下载验证：`node scripts/smoke.mjs https://你拥有使用权限的公开视频.mp4 report.json`。

## 网站接入的发布条件

当前源码还不是面向公众的服务器版本。公网发布需要常驻下载服务、用户任务与文件隔离、服务器鉴权、出站请求防护、总磁盘/流量限制及 HTTPS 接入。Vercel 页面无法直接运行 Windows 的 exe、操作访客电脑的下载目录，或代替常驻下载进程。

电脑自用版可以从网站打开本机伴随工具；访客和手机直接下载需要部署服务器版本。两种接入方式必须先确定，再进行相应集成和生产验证。
