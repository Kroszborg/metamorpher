import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

const PRIVATE = [
  '/recent',
  '/starred',
  '/account',
  '/history',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/admin',
  '/api/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
