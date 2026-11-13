import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { guides } from '@/lib/guides';
export function generateStaticParams() { return guides.map(guide => ({ slug: guide.slug })); }
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const guide = guides.find(item => item.slug === params.slug);
  if (!guide) return { title: '找不到这篇指南', robots: { index: false } };
  return { title: guide.title, description: guide.description, alternates: { canonical: `/guides/${guide.slug}` }, openGraph: { title: `${guide.title} · 剧说英语`, description: guide.description, url: `/guides/${guide.slug}` } };
}
export default async function GuidePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const guide = guides.find(item => item.slug === params.slug);if (!guide) notFound();
  return <article className="mx-auto max-w-[800px] px-5 py-12"><nav className="mb-7 text-sm text-[var(--text-dim)]"><Link href="/">首页</Link> / <Link href="/guides">学习指南</Link></nav><h1 className="text-[30px] font-bold leading-snug sm:text-[38px]">{guide.title}</h1><p className="mt-5 text-[16px] leading-8 text-[var(--text-dim)]">{guide.description}</p>{guide.sections.map((section, index) => <section key={section.title} className="mt-9"><h2 className="text-xl font-semibold">{index + 1}. {section.title}</h2><p className="mt-4 text-[15px] leading-8 text-[var(--text-dim)]">{section.text}</p></section>)}<div className="account-button-row border-t border-[var(--line)] pt-7 mt-10"><Link href="/learn?trial=1" className="btn btn-primary">免费试学一段</Link><Link href="/learn" className="btn btn-secondary">开始完整学习</Link></div><h2 className="mt-8 mb-4 text-lg font-semibold">继续阅读</h2><div className="grid gap-3">{guides.filter(item => item.slug !== guide.slug).map(item => <Link key={item.slug} href={`/guides/${item.slug}`} className="account-text-link">{item.title} →</Link>)}</div></article>;
}
