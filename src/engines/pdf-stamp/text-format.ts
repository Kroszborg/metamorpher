/** Page ranges, number formats and text templates. Pure; shared by the UI and the worker. */

/**
 * Parses "1-3, 5, 8-" (1-based, inclusive; "-4" = 1–4, "8-" = 8 to the end)
 * into sorted 0-based page indices. Empty input selects every page.
 * Returns an error message for invalid input.
 */
export function parsePageRange(input: string, pageCount: number): { pages: number[] } | { error: string } {
  const text = input.trim();
  if (!text) return { pages: Array.from({ length: pageCount }, (_, i) => i) };
  const picked = new Set<number>();
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*(?:(-|–|\.\.)\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return { error: `“${part}” is not a page or range.` };
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : Number.POSITIVE_INFINITY) : from;
    if (from < 1 || to < 1) return { error: 'Pages start at 1.' };
    if (from > to) return { error: `“${part}” runs backwards.` };
    for (let p = from; p <= Math.min(to, pageCount); p += 1) picked.add(p - 1);
  }
  return { pages: [...picked].sort((a, b) => a - b) };
}

/** Syntax check without knowing the page count (for inline validation in the UI). */
export function pageRangeError(input: string): string | null {
  const r = parsePageRange(input, 0);
  return 'error' in r ? r.error : null;
}

export function toRoman(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n >= 4000) return String(n);
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = Math.floor(n);
  for (const [value, sym] of table) {
    while (rest >= value) {
      out += sym;
      rest -= value;
    }
  }
  return out;
}

export type NumberStyle = 'arabic' | 'roman-lower' | 'roman-upper';

export function formatNumber(n: number, style: NumberStyle): string {
  if (style === 'roman-lower') return toRoman(n).toLowerCase();
  if (style === 'roman-upper') return toRoman(n);
  return String(n);
}

export type BatesFormat = { prefix: string; suffix: string; digits: number };

export function formatBates(n: number, { prefix, suffix, digits }: BatesFormat): string {
  return `${prefix}${String(n).padStart(Math.max(1, Math.min(12, digits)), '0')}${suffix}`;
}

/** Values for the {tokens} of a header, footer or number template. */
export type TemplateValues = {
  page: string;
  total: string;
  date: string;
  filename: string;
  bates: string;
};

/** Replaces {page}, {total}, {date}, {filename} and {bates} (case-insensitive). Unknown tokens stay. */
export function fillTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{(page|total|date|filename|bates)\}/gi, (_, key: string) => {
    return values[key.toLowerCase() as keyof TemplateValues];
  });
}
