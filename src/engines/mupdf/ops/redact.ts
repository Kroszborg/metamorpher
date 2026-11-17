// True redaction (content under the boxes is removed, not covered) and the
// fake-redaction checker.
import type * as M from 'mupdf';
import { splitPageText } from '@/engines/pii/privacy';
import type {
  Box,
  FakeRedaction,
  RedactionCheck,
  RedactionCheckerReport,
  RedactionRegion,
  RedactOptions,
} from '../types';
import {
  type Doc,
  type Mupdf,
  type Obj,
  boxContainsPoint,
  bufferToBytes,
  openPdf,
  quadBox,
  rectsIntersect,
  stripMetadata,
  writeOptions,
} from './common';
import { STEXT_OPTIONS } from './text';

type Char = { c: string; box: Box; cx: number; cy: number; color: M.Color };

function pageChars(page: M.Page, options = STEXT_OPTIONS): Char[] {
  const stext = page.toStructuredText(options);
  const chars: Char[] = [];
  try {
    stext.walk({
      onChar(c, _origin, _font, _size, quad, color) {
        const box = quadBox(quad);
        chars.push({ c, box, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, color });
      },
      endLine() {
        chars.push({ c: '\n', box: [0, 0, 0, 0], cx: -1e9, cy: -1e9, color: [0] });
      },
    });
  } finally {
    stext.destroy();
  }
  return chars;
}

/** Text of the characters whose centres fall inside `box`, lines joined by spaces. */
function textIn(chars: Char[], box: Box): string {
  let s = '';
  let lastIn = false;
  for (const ch of chars) {
    if (ch.c === '\n') {
      if (lastIn) s += ' ';
      lastIn = false;
      continue;
    }
    const inside = boxContainsPoint(box, ch.cx, ch.cy);
    if (inside) s += ch.c;
    else if (lastIn) s += ' ';
    lastIn = inside;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** The bounding box of `box` mapped through matrix `t`. */
function transformBox(box: Box, t: readonly number[]): Box {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = t;
  const pts = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/** Drops `num` from the AcroForm field tree (Fields and every Kids array). */
function removeFieldRefs(doc: Doc, num: number): void {
  const prune = (arr: Obj, depth: number) => {
    if (!arr.isArray() || depth > 32) return;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      const item = arr.get(i);
      if (item.isIndirect() && item.asIndirect() === num) arr.delete(i);
      else prune(item.get('Kids'), depth + 1);
    }
  };
  prune(doc.getTrailer().get('Root', 'AcroForm', 'Fields'), 0);
}

/** Removes a form-field widget and every copy of its value (V, default value, appearance). */
function removeWidget(doc: Doc, page: M.PDFPage, widget: M.PDFWidget): void {
  const obj = widget.getObject();
  const num = obj.isIndirect() ? obj.asIndirect() : -1;
  // The value may sit on the widget or on its parent field; clear both.
  let field: Obj = obj;
  for (let depth = 0; depth < 8 && field.isDictionary(); depth += 1) {
    field.delete('V');
    field.delete('DV');
    field.delete('RV');
    field = field.get('Parent');
  }
  obj.delete('AP');
  obj.delete('MK');
  page.deleteAnnotation(widget);
  if (num > 0) {
    const parent = obj.get('Parent');
    if (parent.isDictionary()) {
      const kids = parent.get('Kids');
      if (kids.isArray()) {
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          const k = kids.get(i);
          if (k.isIndirect() && k.asIndirect() === num) kids.delete(i);
        }
      }
    }
    removeFieldRefs(doc, num);
  }
}

/** Removes scripts, attachments and other content that is not on the page. */
function stripHiddenContent(doc: Doc): void {
  stripMetadata(doc);
  const root = doc.getTrailer().get('Root');
  if (root.isDictionary()) {
    root.delete('OpenAction');
    root.delete('AA');
    const names = root.get('Names');
    if (names.isDictionary()) {
      names.delete('JavaScript');
      names.delete('EmbeddedFiles');
    }
  }
  const pages = doc.countPages();
  for (let i = 0; i < pages; i += 1) doc.findPage(i).delete('AA');
}

export function redactPdf(
  m: Mupdf,
  bytes: Uint8Array,
  regions: RedactionRegion[],
  opts: RedactOptions,
  password?: string,
  progress?: (done: number, total: number, note?: string) => void,
): { bytes: Uint8Array<ArrayBuffer>; check: RedactionCheck } {
  const removed: { page: number; text: string }[] = [];
  const doc = openPdf(m, bytes, password);
  const byPage = new Map<number, Box[]>();
  let out: Uint8Array<ArrayBuffer>;
  try {
    const pageCount = doc.countPages();
    for (const r of regions) {
      if (r.page < 0 || r.page >= pageCount) continue;
      let box = r.box;
      if (r.space === 'user') {
        const page = doc.loadPage(r.page);
        try {
          box = transformBox(box, page.getTransform());
        } finally {
          page.destroy();
        }
      }
      byPage.set(r.page, [...(byPage.get(r.page) ?? []), box]);
    }
    // MuPDF shifts the rest of a line when it removes text from the middle of a
    // TJ array; one string per Tj keeps everything after the removed run in place.
    splitPageText(doc, byPage.keys());
    let done = 0;
    for (const [index, boxes] of byPage) {
      if (index < 0 || index >= pageCount) continue;
      progress?.(done, byPage.size + 1, `Redacting page ${index + 1}`);
      const page = doc.loadPage(index);
      try {
        const chars = pageChars(page);
        for (const box of boxes) {
          const text = textIn(chars, box);
          if (text) removed.push({ page: index, text });
        }
        // Form fields over a box keep their value outside the page content, so the
        // redaction itself would not touch them: remove them (value, appearance, field entry).
        for (const widget of page.getWidgets()) {
          const r = widget.getBounds();
          if (!boxes.some((b) => rectsIntersect(b, [r[0], r[1], r[2], r[3]]))) continue;
          const value = widget.getValue();
          if (value) removed.push({ page: index, text: value });
          removeWidget(doc, page, widget);
        }
        // Comments, highlights and links over a redacted area can carry the same text.
        // Re-read the list after every delete: deleting while iterating skips entries.
        for (;;) {
          const victim = page.getAnnotations().find((annot) => {
            const rect = annot.getBounds();
            return boxes.some((b) => rectsIntersect(b, [rect[0], rect[1], rect[2], rect[3]]));
          });
          if (!victim) break;
          page.deleteAnnotation(victim);
        }
        for (const box of boxes) {
          const annot = page.createAnnotation('Redact');
          annot.setRect(box);
          annot.update();
        }
        page.applyRedactions(
          opts.fillBlack,
          m.PDFPage.REDACT_IMAGE_PIXELS,
          m.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          m.PDFPage.REDACT_TEXT_REMOVE,
        );
      } finally {
        page.destroy();
      }
      done += 1;
    }
    if (opts.stripHidden) stripHiddenContent(doc);
    progress?.(done, byPage.size + 1, 'Writing the redacted file');
    // A full rewrite: no incremental update keeps the old content around.
    out = bufferToBytes(doc.saveToBuffer(writeOptions({ garbage: 'deduplicate', encrypt: 'no' })));
  } finally {
    doc.destroy();
  }

  // Post-check on the output, independent of the edit above.
  const check = verifyRedaction(m, out, byPage, removed);
  progress?.(1, 1);
  return { bytes: out, check };
}

function verifyRedaction(
  m: Mupdf,
  bytes: Uint8Array,
  byPage: Map<number, Box[]>,
  removed: { page: number; text: string }[],
): RedactionCheck {
  const doc = openPdf(m, bytes);
  try {
    const leftInBoxes: { page: number; text: string }[] = [];
    let allText = '';
    const pages = doc.countPages();
    for (let i = 0; i < pages; i += 1) {
      const page = doc.loadPage(i);
      try {
        const boxes = byPage.get(i);
        if (boxes) {
          const chars = pageChars(page);
          for (const box of boxes) {
            const text = textIn(chars, box);
            if (text) leftInBoxes.push({ page: i, text });
          }
          // Text kept outside the page content: form-field values and comments over a box.
          for (const w of page.getWidgets()) {
            const r = w.getBounds();
            const value = w.getValue();
            if (value && boxes.some((b) => rectsIntersect(b, [r[0], r[1], r[2], r[3]]))) leftInBoxes.push({ page: i, text: value });
          }
          for (const a of page.getAnnotations()) {
            const r = a.getBounds();
            const contents = a.getContents();
            if (contents && a.getType() !== 'Redact' && boxes.some((b) => rectsIntersect(b, [r[0], r[1], r[2], r[3]]))) {
              leftInBoxes.push({ page: i, text: contents });
            }
          }
        }
        const stext = page.toStructuredText(STEXT_OPTIONS);
        allText += `${stext.asText()}\n`;
        stext.destroy();
      } finally {
        page.destroy();
      }
    }
    const haystack = normalise(allText);
    // Matched case-insensitively; reported in the case it had under the box.
    const unique = new Map<string, string>();
    for (const r of removed) {
      const key = normalise(r.text);
      if (key.length >= 3 && !unique.has(key)) unique.set(key, r.text.replace(/\s+/g, ' ').trim());
    }
    const elsewhere = [...unique]
      .map(([key, text]) => ({ text, count: countOccurrences(haystack, key) }))
      .filter((e) => e.count > 0);
    return { removed, leftInBoxes, elsewhere, passed: leftInBoxes.length === 0 };
  } finally {
    doc.destroy();
  }
}

// ── Fake redaction checker ───────────────────────────────────────────────

const isDark = (c: readonly number[]) => c.length > 0 && Math.max(...c.slice(0, 3)) < 0.25;

function annotDark(annot: M.PDFAnnotation): boolean {
  // Both getters throw on annotation types without that property (e.g. Text notes).
  const read = (get: () => number[] | undefined): readonly number[] => {
    try {
      return get() ?? [];
    } catch {
      return [];
    }
  };
  const fill = read(() => annot.getInteriorColor?.());
  const stroke = read(() => annot.getColor?.());
  const darkColor = (c: readonly number[]) =>
    c.length === 4 ? (c[3] ?? 0) > 0.75 : c.length > 0 && isDark(c);
  return darkColor(fill) || (annot.getType() === 'Highlight' && darkColor(stroke));
}

/** Fraction of pixels darker than mid-grey inside `box` on a grey pixmap. */
function darkFraction(pix: M.Pixmap, box: Box, scale: number): number {
  const ox = pix.getX();
  const oy = pix.getY();
  const w = pix.getWidth();
  const h = pix.getHeight();
  const stride = pix.getStride();
  const data = pix.getPixels();
  const x0 = Math.max(0, Math.floor(box[0] * scale - ox) + 1);
  const y0 = Math.max(0, Math.floor(box[1] * scale - oy) + 1);
  const x1 = Math.min(w, Math.ceil(box[2] * scale - ox) - 1);
  const y1 = Math.min(h, Math.ceil(box[3] * scale - oy) - 1);
  if (x1 <= x0 || y1 <= y0) return 0;
  let dark = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += 1;
      if ((data[y * stride + x] ?? 255) < 80) dark += 1;
    }
  }
  return total ? dark / total : 0;
}

export function checkRedactions(
  m: Mupdf,
  bytes: Uint8Array,
  password?: string,
  progress?: (done: number, total: number) => void,
): RedactionCheckerReport {
  const doc = openPdf(m, bytes, password);
  const findings: FakeRedaction[] = [];
  let cleanBoxes = 0;
  try {
    const pages = doc.countPages();
    const dpi = 96;
    const scale = dpi / 72;
    for (let i = 0; i < pages; i += 1) {
      const page = doc.loadPage(i);
      try {
        const candidates: { box: Box; kind: FakeRedaction['kind'] }[] = [];
        const stext = page.toStructuredText(`${STEXT_OPTIONS},vectors`);
        try {
          stext.walk({
            onVector(bbox, flags, color) {
              const f = flags as { isStroked?: boolean; isRectangle?: boolean };
              if (f.isRectangle && !f.isStroked && isDark(color)) {
                candidates.push({ box: [bbox[0], bbox[1], bbox[2], bbox[3]], kind: 'vector-box' });
              }
            },
          });
        } finally {
          stext.destroy();
        }
        const unapplied: Box[] = [];
        for (const annot of page.getAnnotations()) {
          const r = annot.getBounds();
          const box: Box = [r[0], r[1], r[2], r[3]];
          if (annot.getType() === 'Redact') unapplied.push(box);
          else if (annotDark(annot)) candidates.push({ box, kind: 'annotation' });
        }

        // Spaces are kept so recovered text reads naturally; only visible characters count as findings.
        const chars = pageChars(page, STEXT_OPTIONS).filter((c) => c.c !== '\n');
        const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceGray, false, true);
        try {
          const hidden = chars.filter((c) => darkFraction(pix, c.box, scale) > 0.9);
          const claimed = new Set<Char>();
          for (const cand of candidates) {
            const under = hidden.filter((c) => boxContainsPoint(cand.box, c.cx, c.cy));
            if (!under.some(visible)) {
              const anyText = chars.some((c) => visible(c) && boxContainsPoint(cand.box, c.cx, c.cy));
              if (!anyText && (cand.box[2] - cand.box[0]) * (cand.box[3] - cand.box[1]) > 20) cleanBoxes += 1;
              continue;
            }
            for (const c of under) claimed.add(c);
            findings.push({ page: i, box: cand.box, text: joinChars(under), kind: cand.kind });
          }
          for (const box of unapplied) {
            const under = chars.filter((c) => boxContainsPoint(box, c.cx, c.cy));
            if (under.some(visible)) findings.push({ page: i, box, text: joinChars(under), kind: 'unapplied-redaction' });
          }
          // Hidden text not explained by a box we recognised (e.g. covered by a shape or a picture).
          const rest = hidden.filter((c) => !claimed.has(c));
          for (const group of groupByLine(rest).filter((g) => g.some(visible))) {
            const box: Box = [
              Math.min(...group.map((c) => c.box[0])),
              Math.min(...group.map((c) => c.box[1])),
              Math.max(...group.map((c) => c.box[2])),
              Math.max(...group.map((c) => c.box[3])),
            ];
            findings.push({ page: i, box, text: joinChars(group), kind: 'covered' });
          }
        } finally {
          pix.destroy();
        }
      } finally {
        page.destroy();
      }
      progress?.(i + 1, pages);
    }
    return { pageCount: pages, findings, cleanBoxes };
  } finally {
    doc.destroy();
  }
}

const visible = (c: Char) => c.c.trim().length > 0;

function joinChars(chars: Char[]): string {
  let s = '';
  let prev: Char | null = null;
  for (const c of chars) {
    if (prev && (Math.abs(prev.cy - c.cy) > (prev.box[3] - prev.box[1]) / 2 || c.box[0] - prev.box[2] > (c.box[3] - c.box[1]) * 0.25)) s += ' ';
    s += /\s/.test(c.c) ? ' ' : c.c;
    prev = c;
  }
  return s.replace(/\s+/g, ' ').trim();
}

function groupByLine(chars: Char[]): Char[][] {
  const groups: Char[][] = [];
  for (const c of chars) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && Math.abs(last.cy - c.cy) < (c.box[3] - c.box[1]) / 2 && c.box[0] - last.box[2] < (c.box[3] - c.box[1]) * 2) g.push(c);
    else groups.push([c]);
  }
  return groups;
}
