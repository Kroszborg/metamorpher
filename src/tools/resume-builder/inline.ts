/**
 * The little rich-text syntax of the résumé form: **bold**, *italic*,
 * [label](link), and lines starting with "- " for bullets. Shared by the
 * HTML/PDF renderer and the LaTeX generator.
 */

export type Segment = { text: string; bold?: boolean; italic?: boolean; href?: string };

const TOKEN = /\*\*(.+?)\*\*|(?<![\w*])\*(?![\s*])(.+?)(?<!\s)\*(?![\w*])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], italic: true });
    else out.push({ text: m[3] as string, href: m[4] as string });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** A bullet line: "- x", "• x", "* x" (a space after the star, so *italic* is not a bullet). */
export const BULLET = /^(?:[-•▪◦]\s*|\*\s+)(.*)$/;

/** A link target the documents may use (web or mail). */
export function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}
