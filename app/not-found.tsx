import Link from 'next/link';
import { works } from '@/lib/data';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[720px] flex-col justify-center px-4 py-20 sm:px-6">
      <p className="text-[14px] font-semibold text-[var(--text-faint)]">404</p>
      <h1 className="mt-2 text-[32px] font-bold tracking-[-0.03em] text-[var(--text)]">页面不存在</h1>
      <p className="mt-3 max-w-lg text-[15px] leading-[1.7] text-[var(--text-dim)]">
        链接可能有误，或这部作品还没有进入片单。目前共有 {works.length} 部作品可以浏览。
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">返回首页</Link>
        <Link href="/#catalog" className="btn btn-secondary">浏览片单</Link>
      </div>
    </div>
  );
}
