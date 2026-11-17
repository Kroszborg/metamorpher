// Rewrites `[(…) n (…)] TJ` text arrays as `(…) Tj [n] TJ (…) Tj`, which
// draws exactly the same thing. MuPDF 1.28's redaction loses the advance of
// the first removed glyph when the removed run starts inside a TJ string after
// kept glyphs, so the rest of the line slides left (into the redaction box).
// With one string per Tj it keeps every position. Pure, no imports.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

type Token = { kind: 'string' | 'hex' | 'name' | 'open' | 'close' | 'dict' | 'regular' | 'other'; start: number; end: number };

function isRegular(b: number | undefined): boolean {
  return b !== undefined && !WS.has(b) && !DELIM.has(b);
}

/** Next token at or after `i`, skipping whitespace and comments. Null at the end. */
function nextToken(s: Uint8Array, i: number): Token | null {
  const n = s.length;
  for (;;) {
    while (i < n && WS.has(s[i] ?? 0)) i += 1;
    if (i >= n) return null;
    if (s[i] === 0x25) {
      while (i < n && s[i] !== 10 && s[i] !== 13) i += 1;
      continue;
    }
    break;
  }
  const start = i;
  const b = s[i];
  if (b === 0x28) {
    let depth = 0;
    for (; i < n; i += 1) {
      const c = s[i];
      if (c === 0x5c) {
        i += 1;
        continue;
      }
      if (c === 0x28) depth += 1;
      else if (c === 0x29) {
        depth -= 1;
        if (depth === 0) return { kind: 'string', start, end: i + 1 };
      }
    }
    return { kind: 'string', start, end: n };
  }
  if (b === 0x3c) {
    if (s[i + 1] === 0x3c) return { kind: 'dict', start, end: i + 2 };
    while (i < n && s[i] !== 0x3e) i += 1;
    return { kind: 'hex', start, end: Math.min(n, i + 1) };
  }
  if (b === 0x3e) return { kind: 'dict', start, end: s[i + 1] === 0x3e ? i + 2 : i + 1 };
  if (b === 0x5b) return { kind: 'open', start, end: i + 1 };
  if (b === 0x5d) return { kind: 'close', start, end: i + 1 };
  if (b === 0x2f) {
    i += 1;
    while (isRegular(s[i])) i += 1;
    return { kind: 'name', start, end: i };
  }
  if (isRegular(b)) {
    while (isRegular(s[i])) i += 1;
    return { kind: 'regular', start, end: i };
  }
  return { kind: 'other', start, end: i + 1 };
}

const text = (s: Uint8Array, t: Token) => String.fromCharCode(...s.subarray(t.start, t.end));

/** End of inline image data that starts after the `ID` operator at `i`. */
function skipInlineImage(s: Uint8Array, i: number): number {
  const n = s.length;
  for (let j = i + 1; j < n - 1; j += 1) {
    if (s[j] === 0x45 && s[j + 1] === 0x49 && WS.has(s[j - 1] ?? 0) && (j + 2 >= n || WS.has(s[j + 2] ?? 0))) return j + 2;
  }
  return n;
}

/**
 * The content stream with every TJ array split into Tj strings and
 * number-only TJ moves, or null when it has no TJ arrays with strings.
 */
export function splitTextArrays(s: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [];
  let copied = 0;
  let changed = false;
  let i = 0;
  const pushRange = (a: number, b: number) => {
    if (b > a) out.push(s.subarray(a, b));
  };
  const pushText = (t: string) => {
    out.push(Uint8Array.from(t, (c) => c.charCodeAt(0)));
  };
  for (;;) {
    const t = nextToken(s, i);
    if (!t) break;
    i = t.end;
    if (t.kind === 'regular' && t.end - t.start === 2 && text(s, t) === 'ID') {
      i = skipInlineImage(s, i);
      continue;
    }
    if (t.kind !== 'open') continue;
    // Collect a flat array of strings and numbers.
    const items: Token[] = [];
    let flat = true;
    let j = i;
    let close: Token | null = null;
    for (;;) {
      const u = nextToken(s, j);
      if (!u) break;
      j = u.end;
      if (u.kind === 'close') {
        close = u;
        break;
      }
      if (u.kind === 'string' || u.kind === 'hex' || (u.kind === 'regular' && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text(s, u)))) {
        items.push(u);
      } else {
        flat = false;
        if (u.kind === 'open') break;
      }
    }
    if (!close || !flat) continue;
    const op = nextToken(s, close.end);
    if (!op || op.kind !== 'regular' || text(s, op) !== 'TJ' || op.end - op.start !== 2) {
      i = close.end;
      continue;
    }
    if (!items.some((x) => x.kind === 'string' || x.kind === 'hex')) {
      i = op.end;
      continue;
    }
    // Replace `[ … ] TJ` with Tj strings and number-only TJ moves.
    pushRange(copied, t.start);
    let pending = 0;
    let hasPending = false;
    const flush = () => {
      if (hasPending && pending !== 0) pushText(`[${Number(pending.toFixed(4))}] TJ\n`);
      pending = 0;
      hasPending = false;
    };
    for (const item of items) {
      if (item.kind === 'regular') {
        pending += Number(text(s, item));
        hasPending = true;
      } else {
        flush();
        pushRange(item.start, item.end);
        pushText(' Tj\n');
      }
    }
    flush();
    copied = op.end;
    i = op.end;
    changed = true;
  }
  if (!changed) return null;
  pushRange(copied, s.length);
  const result = new Uint8Array(out.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of out) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
