import Script from 'next/script';
import { analyticsConfig } from '@/lib/analytics-config';

export default function Analytics() {
  const config = analyticsConfig({
    endpoint: process.env.NEXT_PUBLIC_YILAN_COLLECTOR_URL ?? 'https://yilan-collector.yilan-public-collector.workers.dev',
    siteId: process.env.NEXT_PUBLIC_YILAN_WEBSITE_ID,
  });
  if (!config) return null;
  return <Script id="yilan-analytics" strategy="afterInteractive" src={config.src} data-website-id={config.siteId} />;
}
