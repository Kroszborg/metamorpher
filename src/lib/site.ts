/** Public facts about the site, used by metadata, the sitemap and the footer. */

/**
 * Absolute origin for canonical URLs and the sitemap. Set NEXT_PUBLIC_SITE_URL
 * in production; on Vercel the production domain is picked up automatically.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/$/, '');

export const SITE_NAME = 'Metamorpher';
export const SITE_DESCRIPTION =
  'Private file tools that run in your browser: convert images, video, audio and documents, and work with PDFs. Files never leave your device.';

export const AUTHOR = { name: 'Kroszborg', url: 'https://www.kroszborg.co/' };
export const SOURCE_URL = 'https://github.com/Kroszborg/metamorpher';

/** The link preview card (public/og.png, 1200×630), used by Open Graph and X. */
export const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: `${SITE_NAME}: every file tool, nothing uploaded`,
} as const;
