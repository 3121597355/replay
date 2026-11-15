'use client';
import { useLanguage } from '@/components/LanguageProvider';

export default function LearnError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">{t('学习台暂时无法加载')}</h1>
      <p className="my-4 text-sm text-[var(--text-dim)]">{t('请重新加载。也可以将网址复制到 Safari、Chrome 或 Edge 中打开。')}</p>
      <button className="btn btn-primary" onClick={reset}>{t('重试学习台')}</button>
      <a className="ml-4 text-sm underline" href="/">{t('返回首页')}</a>
    </div>
  );
}
