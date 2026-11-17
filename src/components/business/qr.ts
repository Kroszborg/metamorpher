/**
 * QR codes made on this device (uqr, MIT: a port of Nayuki's QR Code generator).
 * The matrix is drawn by us, so PNG, SVG and PDF outputs share one geometry.
 */
import { encode, QrCodeDataType } from 'uqr';

export type Ecc = 'L' | 'M' | 'Q' | 'H';

export type QrMatrix = {
  /** Modules per side, quiet zone included. */
  size: number;
  /** `true` = dark module. */
  dark: boolean[][];
  /** Finder patterns (the three big squares), for styled drawing. */
  finder: boolean[][];
  version: number;
};

/** Encodes text (UTF-8) into a QR matrix with a quiet zone of `border` modules. */
export function qrMatrix(text: string, ecc: Ecc = 'M', border = 4): QrMatrix {
  if (!text) throw new Error('Nothing to encode.');
  let r;
  try {
    r = encode(text, { ecc, border });
  } catch {
    throw new Error('This is too much data for one QR code. Shorten it or lower the error correction.');
  }
  return {
    size: r.size,
    dark: r.data,
    finder: r.types.map((row) => row.map((t) => t === QrCodeDataType.Position)),
    version: r.version,
  };
}

export type QrStyle = {
  fg: string;
  bg: string;
  /** Square, rounded dots or connected rounded modules. */
  shape?: 'square' | 'dots' | 'rounded';
  /** Transparent background (PNG/SVG). */
  transparent?: boolean;
};

/** A cleared square in the middle (fraction of the code's width) for a logo. */
export function logoHole(m: QrMatrix, fraction: number): { x0: number; x1: number } | null {
  if (fraction <= 0) return null;
  const inner = m.size;
  let n = Math.round(inner * fraction);
  if ((inner - n) % 2 !== 0) n += 1;
  const x0 = (inner - n) / 2;
  return { x0, x1: x0 + n };
}

function inHole(hole: { x0: number; x1: number } | null, x: number, y: number): boolean {
  return !!hole && x >= hole.x0 && x < hole.x1 && y >= hole.x0 && y < hole.x1;
}

/** Draws the code onto a 2D context at `px` pixels per module. */
export function drawQr(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  m: QrMatrix,
  px: number,
  style: QrStyle,
  hole: { x0: number; x1: number } | null = null,
): void {
  const W = m.size * px;
  ctx.clearRect(0, 0, W, W);
  if (!style.transparent) {
    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, W, W);
  }
  ctx.fillStyle = style.fg;
  const shape = style.shape ?? 'square';
  for (let y = 0; y < m.size; y++) {
    const row = m.dark[y] as boolean[];
    for (let x = 0; x < m.size; x++) {
      if (!row[x] || inHole(hole, x, y)) continue;
      if (shape === 'square' || m.finder[y]?.[x]) {
        ctx.fillRect(x * px, y * px, px, px);
      } else if (shape === 'dots') {
        ctx.beginPath();
        ctx.arc((x + 0.5) * px, (y + 0.5) * px, px * 0.46, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundedModule(ctx, m, x, y, px);
      }
    }
  }
}

function isDark(m: QrMatrix, x: number, y: number): boolean {
  return !!m.dark[y]?.[x];
}

/** A module whose corners are rounded only where no neighbour continues it. */
function roundedModule(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: QrMatrix, x: number, y: number, px: number) {
  const r = px * 0.5;
  const up = isDark(m, x, y - 1);
  const down = isDark(m, x, y + 1);
  const left = isDark(m, x - 1, y);
  const right = isDark(m, x + 1, y);
  const tl = up || left ? 0 : r;
  const tr = up || right ? 0 : r;
  const br = down || right ? 0 : r;
  const bl = down || left ? 0 : r;
  ctx.beginPath();
  ctx.roundRect(x * px, y * px, px, px, [tl, tr, br, bl]);
  ctx.fill();
}

/** SVG markup for the code (one path, crisp at any size). */
export function qrSvg(m: QrMatrix, style: QrStyle, opts: { size?: number; logo?: { href: string; fraction: number } } = {}): string {
  const hole = opts.logo ? logoHole(m, opts.logo.fraction) : null;
  const shape = style.shape ?? 'square';
  let d = '';
  let dots = '';
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.dark[y]?.[x] || inHole(hole, x, y)) continue;
      if (shape === 'square' || m.finder[y]?.[x]) d += `M${x} ${y}h1v1h-1z`;
      else if (shape === 'dots') dots += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.46"/>`;
      else {
        const r = 0.5;
        const up = isDark(m, x, y - 1);
        const down = isDark(m, x, y + 1);
        const left = isDark(m, x - 1, y);
        const right = isDark(m, x + 1, y);
        const tl = up || left ? 0 : r;
        const tr = up || right ? 0 : r;
        const br = down || right ? 0 : r;
        const bl = down || left ? 0 : r;
        d += `M${x + tl} ${y}h${1 - tl - tr}${tr ? `a${r} ${r} 0 0 1 ${r} ${r}` : ''}v${1 - tr - br}${br ? `a${r} ${r} 0 0 1 ${-r} ${r}` : ''}h${-(1 - br - bl)}${bl ? `a${r} ${r} 0 0 1 ${-r} ${-r}` : ''}v${-(1 - bl - tl)}${tl ? `a${r} ${r} 0 0 1 ${r} ${-r}` : ''}z`;
      }
    }
  }
  const size = opts.size ?? m.size * 10;
  const bg = style.transparent ? '' : `<rect width="${m.size}" height="${m.size}" fill="${style.bg}"/>`;
  let logo = '';
  if (opts.logo && hole) {
    const n = hole.x1 - hole.x0;
    const pad = n * 0.08;
    logo = `<image href="${opts.logo.href}" x="${hole.x0 + pad}" y="${hole.x0 + pad}" width="${n - 2 * pad}" height="${n - 2 * pad}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.size} ${m.size}" width="${size}" height="${size}" shape-rendering="${shape === 'square' ? 'crispEdges' : 'geometricPrecision'}">${bg}<path d="${d}" fill="${style.fg}"/>${dots ? `<g fill="${style.fg}">${dots}</g>` : ''}${logo}</svg>`;
}

/** A PNG data URL of a plain black-on-white code (for documents). */
export function qrPngDataUrl(text: string, { ecc = 'M', px = 8, border = 2, fg = '#000000' }: { ecc?: Ecc; px?: number; border?: number; fg?: string } = {}): string {
  const m = qrMatrix(text, ecc, border);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = m.size * px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  drawQr(ctx, m, px, { fg, bg: '#ffffff' });
  return canvas.toDataURL('image/png');
}

/** `upi://pay` link (NPCI UPI linking specification). Amount in rupees, two decimals. */
export function upiLink({ vpa, name, amount, note, ref }: { vpa: string; name?: string; amount?: number; note?: string; ref?: string }): string {
  // Percent-encoded values, but '@' kept as is: some UPI apps do not decode %40 in the payee address.
  const enc = (s: string) => encodeURIComponent(s).replace(/%40/g, '@');
  const parts = [`pa=${enc(vpa.trim())}`];
  if (name?.trim()) parts.push(`pn=${enc(name.trim())}`);
  if (amount && amount > 0) parts.push(`am=${amount.toFixed(2)}`);
  parts.push('cu=INR');
  if (note?.trim()) parts.push(`tn=${enc(note.trim().slice(0, 80))}`);
  if (ref?.trim()) parts.push(`tr=${enc(ref.trim().slice(0, 35))}`);
  return `upi://pay?${parts.join('&')}`;
}

/** A UPI ID (VPA): handle@provider. */
export function isUpiId(v: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(v.trim());
}
