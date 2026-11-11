'use client';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { analyticsConfig } from '@/lib/analytics-config';

export default function Analytics() {
  const path = usePathname();
  const config = analyticsConfig({
    endpoint: process.env.NEXT_PUBLIC_YILAN_COLLECTOR_URL ?? 'https://yilan-collector.yilan-public-collector.workers.dev',
    siteId: process.env.NEXT_PUBLIC_YILAN_WEBSITE_ID,
  });
  if (/^\/(admin|api)(\/|$)/.test(path)) return null;
  return <><Script id="umami-analytics" strategy="afterInteractive" src="https://cloud.umami.is/script.js" data-website-id="10592750-fb71-440a-8f01-bd7e7233432c" />{config && <Script id="yilan-analytics" strategy="afterInteractive" src={`${config.src}?v=20261111.2.1`} data-website-id={config.siteId} />}</>;
}
