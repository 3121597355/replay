import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07070a',
          900: '#0b0b11',
          850: '#0f0f16',
          800: '#14141d',
          700: '#1c1c28',
          600: '#262635',
          500: '#343446',
        },
        gold: {
          400: '#f0c778',
          500: '#e0a94a',
          600: '#c98f2e',
        },
        violet: {
          400: '#9d8cff',
          500: '#7c6cf0',
          600: '#6152d6',
        },
        mint: {
          400: '#6ee7b7',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        serif: ['Georgia', 'Cambria', 'Songti SC', 'SimSun', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(224,169,74,0.25), 0 12px 40px -12px rgba(224,169,74,0.35)',
        card: '0 18px 50px -24px rgba(0,0,0,0.9)',
      },
      animation: {
        // 基础：小位移
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        // 大标题用：位移更大、时间更长，落定更沉
        'fade-up-lg': 'fadeUpLg 0.85s cubic-bezier(0.16, 1, 0.3, 1) both',
        // 纯透明度：块级内容不要位移，避免整页晃动
        'fade-in': 'fadeIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        // 卡片用：从 0.97 放大，比纯位移有体积感
        'scale-in': 'scaleIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUpLg: {
          '0%': { opacity: '0', transform: 'translateY(22px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.97) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
