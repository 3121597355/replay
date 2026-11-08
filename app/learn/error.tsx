'use client';

export default function LearnError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">学习台暂时无法加载</h1>
      <p className="my-4 text-sm text-[var(--text-dim)]">请重新加载。也可以将网址复制到 Safari、Chrome 或 Edge 中打开。</p>
      <button className="btn btn-primary" onClick={reset}>重试学习台</button>
      <a className="ml-4 text-sm underline" href="/">返回首页</a>
    </div>
  );
}
