/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * 构建指纹。
   * 每次 build 都会变，打在学习台角落上——刷新后一眼就能确认
   * 浏览器里跑的是不是最新代码，不用再来回猜缓存。
   */
  env: {
    BUILD_STAMP: new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  },

  async headers() {
    return [
      {
        // ffmpeg.wasm / SharedArrayBuffer 需要跨域隔离
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        // Only the local-file receiver needs a cross-origin opener. The player
        // gets its isolated document back after the full /learn navigation.
        source: '/download',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' }],
      },
    ];
  },
};

export default nextConfig;
