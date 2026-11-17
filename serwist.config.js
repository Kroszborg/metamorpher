// Service worker build (Serwist configurator mode, which works with Turbopack).
// `npm run build` runs `next build` and then `serwist build`, which bundles
// src/sw.ts with a precache manifest into public/sw.js (gitignored).
import { serwist } from '@serwist/next/config';

export default serwist({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  // The engines (ffmpeg core ~31 MB, pdf.js data) are cached on first use instead
  // of being precached; see the runtime rule in src/sw.ts.
  globIgnores: ['public/vendor/**'],
  // Tools load workers and chunks on demand; allow the larger ones to be precached.
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
});
