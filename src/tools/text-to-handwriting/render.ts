/**
 * Typed text → handwritten-looking pages on a canvas. Layout is in points
 * (1/72 in); drawing scales to any resolution. A seeded random generator
 * gives each word a little wobble (baseline, angle, size, spacing, ink), so
 * the same seed always draws the same page.
 */
import { handFamily, type HandId, HANDS } from './fonts';

export type Paper = 'ruled' | 'plain' | 'grid' | 'dotted';
export type PaperSize = 'a4' | 'letter';

export type HandOptions = {
  hand: HandId;
  ink: string;
  paper: Paper;
  size: PaperSize;
  /** Letter size in points. */
  fontSize: number;
  /** Distance between lines (and ruled lines) in points. */
  lineGap: number;
  /** Page margin in millimetres. */
  margin: number;
  /** Red margin line on ruled paper. */
  marginLine: boolean;
  /** 0 (typeset) … 1 (very loose). */
  jitter: number;
  /** Forward slant in degrees. */
  slant: number;
  seed: number;
  /** Cream paper instead of white. */
  cream: boolean;
};

export const PAGE: Record<PaperSize, { w: number; h: number; label: string }> = {
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  letter: { w: 612, h: 792, label: 'Letter' },
};

const MM = 72 / 25.4;

export type Word = { text: string; x: number; y: number; rot: number; scale: number; alpha: number };
export type PageLayout = { words: Word[]; lines: number };

/** mulberry32: small, fast, seeded. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function geometry(o: HandOptions) {
  const page = PAGE[o.size];
  const m = o.margin * MM;
  const left = m + (o.paper === 'ruled' && o.marginLine ? 14 : 0);
  const right = page.w - m;
  const top = m + o.lineGap * 0.9;
  const bottom = page.h - m;
  const linesPerPage = Math.max(1, Math.floor((bottom - top) / o.lineGap) + 1);
  return { page, m, left, right, top, bottom, linesPerPage };
}

export function fontCss(o: HandOptions, sizePt: number): string {
  const hand = HANDS.find((h) => h.id === o.hand) ?? HANDS[0]!;
  return `${(sizePt * hand.scale).toFixed(2)}px "${handFamily(o.hand)}", cursive`;
}

/** Lays the text out into pages of words (positions in points). `measure` returns a width in points. */
export function layout(text: string, o: HandOptions, measure: (s: string) => number): PageLayout[] {
  const g = geometry(o);
  const r = rng(o.seed);
  const j = Math.max(0, Math.min(1, o.jitter));
  const space = measure(' ');
  const width = g.right - g.left;
  const pages: PageLayout[] = [];
  let page: PageLayout = { words: [], lines: 0 };
  let line = 0;
  let lineDrift = 0;
  let lineSlope = 0;
  let x = 0;
  const newLine = () => {
    line += 1;
    x = 0;
    lineDrift = (r() - 0.5) * 2.4 * j;
    lineSlope = (r() - 0.5) * 0.012 * j;
    if (line >= g.linesPerPage) {
      page.lines = line;
      pages.push(page);
      page = { words: [], lines: 0 };
      line = 0;
    }
  };
  const indent = () => (r() - 0.5) * 4 * j;
  const place = (word: string, w: number) => {
    const y = g.top + line * o.lineGap + lineDrift + lineSlope * x + (r() - 0.5) * 1.6 * j;
    page.words.push({
      text: word,
      x: g.left + x,
      y,
      rot: ((r() - 0.5) * 2.2 * j * Math.PI) / 180,
      scale: 1 + (r() - 0.5) * 0.07 * j,
      alpha: 0.86 + r() * 0.14 - j * 0.05 * r(),
    });
    x += w + space * (1 + (r() - 0.5) * 0.6 * j);
  };
  const paragraphs = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  paragraphs.forEach((para, pi) => {
    if (pi > 0) newLine();
    x = Math.max(0, indent());
    const words = para.split(/ +/).filter((w, i, a) => w !== '' || (i === 0 && a.length === 1));
    for (const word of words) {
      if (!word) continue;
      let w = measure(word);
      if (x > 0 && x + w > width) newLine();
      // A word longer than the line is split by characters.
      if (w > width) {
        let chunk = '';
        for (const ch of word) {
          if (measure(chunk + ch) > width - x && chunk) {
            place(chunk, measure(chunk));
            newLine();
            chunk = '';
          }
          chunk += ch;
        }
        w = measure(chunk);
        place(chunk, w);
        continue;
      }
      place(word, w);
    }
  });
  page.lines = line + 1;
  pages.push(page);
  return pages;
}

/** Draws the paper and the words of one page; `scale` is pixels per point. */
export function drawPage(ctx: CanvasRenderingContext2D, p: PageLayout, o: HandOptions, scale: number): void {
  const g = geometry(o);
  const W = g.page.w * scale;
  const H = g.page.h * scale;
  ctx.save();
  ctx.fillStyle = o.cream ? '#fbf8ef' : '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.scale(scale, scale);
  // Paper
  ctx.lineWidth = 0.6;
  if (o.paper === 'ruled') {
    ctx.strokeStyle = 'rgba(96,140,204,0.45)';
    for (let k = 0; k < g.linesPerPage; k++) {
      const y = g.top + k * o.lineGap + 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(g.page.w, y);
      ctx.stroke();
    }
    if (o.marginLine) {
      ctx.strokeStyle = 'rgba(214,82,82,0.55)';
      ctx.lineWidth = 0.8;
      const mx = g.left - 8;
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, g.page.h);
      ctx.stroke();
    }
  } else if (o.paper === 'grid' || o.paper === 'dotted') {
    const step = 5 * MM;
    ctx.strokeStyle = 'rgba(120,140,170,0.28)';
    ctx.fillStyle = 'rgba(110,125,150,0.45)';
    for (let x = step; x < g.page.w; x += step) {
      for (let y = step; y < g.page.h; y += step) {
        if (o.paper === 'dotted') {
          ctx.beginPath();
          ctx.arc(x, y, 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (o.paper === 'grid') {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, g.page.h);
        ctx.stroke();
      }
    }
    if (o.paper === 'grid') {
      for (let y = step; y < g.page.h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(g.page.w, y);
        ctx.stroke();
      }
    }
  }
  // Ink
  ctx.fillStyle = o.ink;
  ctx.textBaseline = 'alphabetic';
  const slant = Math.tan((o.slant * Math.PI) / 180);
  for (const w of p.words) {
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.rot);
    ctx.transform(1, 0, -slant, 1, 0, 0);
    ctx.globalAlpha = Math.max(0.5, Math.min(1, w.alpha));
    ctx.font = fontCss(o, o.fontSize * w.scale);
    ctx.fillText(w.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** A text measurer in points for the current options (uses an offscreen 2D context). */
export function measurer(o: HandOptions): (s: string) => number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return (s) => s.length * o.fontSize * 0.5;
  const k = 10;
  ctx.font = fontCss(o, o.fontSize * k);
  const cache = new Map<string, number>();
  return (s) => {
    let v = cache.get(s);
    if (v === undefined) {
      v = ctx.measureText(s).width / k;
      cache.set(s, v);
    }
    return v;
  };
}
