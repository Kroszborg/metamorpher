// Handwriting fonts for typed signatures (SIL Open Font License). next/font downloads them at
// build time and serves them from this app's own origin; the browser never contacts Google.
import { Caveat, Dancing_Script, Great_Vibes } from 'next/font/google';

const dancing = Dancing_Script({ subsets: ['latin', 'latin-ext'], weight: '500', display: 'swap' });
const vibes = Great_Vibes({ subsets: ['latin', 'latin-ext'], weight: '400', display: 'swap' });
const caveat = Caveat({ subsets: ['latin', 'latin-ext'], weight: '500', display: 'swap' });

export type ScriptFont = { id: string; label: string; className: string; fontFamily: string };

export const SCRIPT_FONTS: readonly ScriptFont[] = [
  { id: 'dancing', label: 'Dancing Script', className: dancing.className, fontFamily: dancing.style.fontFamily },
  { id: 'vibes', label: 'Great Vibes', className: vibes.className, fontFamily: vibes.style.fontFamily },
  { id: 'caveat', label: 'Caveat', className: caveat.className, fontFamily: caveat.style.fontFamily },
];
