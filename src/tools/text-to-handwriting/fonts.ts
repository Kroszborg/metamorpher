/**
 * Handwriting typefaces, self-hosted in /vendor/handwriting (copied from
 * @fontsource by scripts/copy-runtime-assets.mjs) and registered with the
 * FontFace API when this tool first draws. OFL-1.1, Homemade Apple Apache-2.0.
 */

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const DEVANAGARI = 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF,U+11B00-11B09';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const RANGES: Record<string, string> = { latin: LATIN, 'latin-ext': LATIN_EXT, devanagari: DEVANAGARI, cyrillic: CYRILLIC };

export type HandId = 'caveat' | 'kalam' | 'patrick-hand' | 'indie-flower' | 'homemade-apple' | 'shadows-into-light';

export type Hand = {
  id: HandId;
  label: string;
  note: string;
  subsets: string[];
  /** Size multiplier so the hands look about equally big at one setting. */
  scale: number;
  /** Joined-up script: words are drawn whole (no per-letter wobble). */
  cursive: boolean;
};

export const HANDS: readonly Hand[] = [
  { id: 'caveat', label: 'Caveat', note: 'Quick, casual', subsets: ['latin', 'latin-ext', 'cyrillic'], scale: 1.18, cursive: false },
  { id: 'kalam', label: 'Kalam', note: 'Neat; also Hindi/Marathi', subsets: ['latin', 'latin-ext', 'devanagari'], scale: 1, cursive: false },
  { id: 'patrick-hand', label: 'Patrick Hand', note: 'Clear print', subsets: ['latin', 'latin-ext'], scale: 1.04, cursive: false },
  { id: 'indie-flower', label: 'Indie Flower', note: 'Round and friendly', subsets: ['latin', 'latin-ext'], scale: 1, cursive: false },
  { id: 'shadows-into-light', label: 'Shadows Into Light', note: 'Light, slanted', subsets: ['latin', 'latin-ext'], scale: 1.08, cursive: false },
  { id: 'homemade-apple', label: 'Homemade Apple', note: 'Joined-up cursive', subsets: ['latin'], scale: 0.84, cursive: true },
];

export function handFamily(id: HandId): string {
  return `mm-hand-${id}`;
}

const loaded = new Map<HandId, Promise<void>>();

/** Registers and loads every subset of a hand. */
export function loadHand(id: HandId): Promise<void> {
  let p = loaded.get(id);
  if (!p) {
    const hand = HANDS.find((h) => h.id === id);
    if (!hand) return Promise.reject(new Error('Unknown handwriting style.'));
    p = Promise.all(
      hand.subsets.map(async (subset) => {
        const face = new FontFace(handFamily(id), `url(/vendor/handwriting/${id}-${subset}-400-normal.woff2) format('woff2')`, {
          unicodeRange: RANGES[subset],
          display: 'block',
        });
        await face.load();
        document.fonts.add(face);
      }),
    ).then(() => undefined);
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}

/** Characters of the text that the hand has no glyphs for (a few examples). */
export function unsupported(text: string, id: HandId): string[] {
  const hand = HANDS.find((h) => h.id === id);
  if (!hand) return [];
  const has = (cp: number) =>
    cp < 0x2b0 ||
    (cp >= 0x2000 && cp <= 0x206f) ||
    (hand.subsets.includes('latin-ext') && ((cp >= 0x1e00 && cp <= 0x1eff) || (cp >= 0x20a0 && cp <= 0x20c0))) ||
    (hand.subsets.includes('devanagari') && ((cp >= 0x900 && cp <= 0x97f) || cp === 0x20b9 || cp === 0x200c || cp === 0x200d)) ||
    (hand.subsets.includes('cyrillic') && cp >= 0x400 && cp <= 0x52f);
  const out = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x20 || has(cp)) continue;
    out.add(ch);
    if (out.size >= 8) break;
  }
  return [...out];
}
