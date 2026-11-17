import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { activeCategories, AVAILABLE_TOOLS } from '@/tools/registry';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    ...activeCategories().map((c) => ({
      url: `${SITE_URL}/category/${c.id}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...AVAILABLE_TOOLS.map((t) => ({
      url: `${SITE_URL}/tools/${t.slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
