import type { MetadataRoute } from 'next';
import { works } from '@/lib/data';
import { siteUrl } from '@/lib/site';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/guides', '/guides/watch-and-speak', '/guides/subtitle-sync', '/guides/anki', ...works.map(work => `/movie/${work.slug}`)].map(path => ({ url: new URL(path, siteUrl).href }));
}
