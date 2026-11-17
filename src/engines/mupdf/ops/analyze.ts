// "Why is my PDF so big": attributes stored stream bytes to images, fonts,
// page content, metadata and so on, per object and per page.
import type { ProgressFn, SizeCategory, SizeObject, SizeReport } from '../types';
import { type Doc, type Mupdf, type Obj, filtersOf, nameOf, openPdf, storedLength } from './common';
import { placementDpi } from './compress';

const CATEGORIES: SizeCategory[] = [
  'images',
  'fonts',
  'content',
  'metadata',
  'forms',
  'attachments',
  'structure',
  'other',
];

/** Keys that lead away from a page's own resources (other pages, outlines, the page tree). */
const SKIP_KEYS = new Set([
  'Parent',
  'P',
  'Dest',
  'D',
  'A',
  'Next',
  'Prev',
  'First',
  'Last',
  'B',
  'StructParent',
  'StructParents',
  'Popup',
  'IRT',
]);

/** Indirect references directly inside `obj` (not following them). */
function refsIn(obj: Obj, out: number[], skip: Set<string> | null, depth = 0): void {
  if (depth > 32) return;
  if (obj.isIndirect()) {
    out.push(obj.asIndirect());
    return;
  }
  if (obj.isArray() || obj.isDictionary()) {
    obj.forEach((val, key) => {
      if (skip && typeof key === 'string' && skip.has(key)) return;
      refsIn(val, out, skip, depth + 1);
    });
  }
}

/** Object numbers reachable from `start`, without crossing into other pages when `pageMode`. */
function reachable(doc: Doc, start: Obj[], pageMode: boolean): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [];
  // Start from the entries of each start object (a page would otherwise be skipped as "another page").
  for (const s of start) {
    const dict = s.resolve();
    if (dict.isDictionary())
      dict.forEach((val, key) => {
        if (!(pageMode && typeof key === 'string' && SKIP_KEYS.has(key)))
          refsIn(val, stack, pageMode ? SKIP_KEYS : null);
      });
    else refsIn(s, stack, pageMode ? SKIP_KEYS : null);
  }
  while (stack.length) {
    const num = stack.pop() as number;
    if (seen.has(num)) continue;
    seen.add(num);
    let obj: Obj;
    try {
      obj = doc.newIndirect(num).resolve();
    } catch {
      continue;
    }
    if (pageMode && nameOf(obj.get('Type')) === 'Page') continue;
    refsIn(obj, stack, pageMode ? SKIP_KEYS : null);
  }
  return seen;
}

type Classified = { category: SizeCategory; label: string };

function fontLabel(desc: Obj): string {
  const name = desc.get('FontName');
  return name.isName() ? name.asName() : 'Unnamed font';
}

/** Category of every stream object worth classifying, from the objects that point at it. */
function classify(doc: Doc): Map<number, Classified> {
  const out = new Map<number, Classified>();
  const n = doc.countObjects();
  const set = (ref: Obj, c: Classified) => {
    if (ref.isIndirect() && !out.has(ref.asIndirect())) out.set(ref.asIndirect(), c);
  };
  for (let num = 1; num < n; num += 1) {
    let ref: Obj;
    try {
      ref = doc.newIndirect(num);
      if (!ref.isDictionary()) continue;
    } catch {
      continue;
    }
    const type = nameOf(ref.get('Type'));
    const subtype = nameOf(ref.get('Subtype'));
    if (ref.isStream()) {
      if (subtype === 'Image') {
        const w = ref.get('Width');
        const h = ref.get('Height');
        const f = filtersOf(ref);
        const kind = f.includes('DCTDecode')
          ? 'JPEG'
          : f.includes('JPXDecode')
            ? 'JPEG 2000'
            : f.includes('JBIG2Decode')
              ? 'JBIG2'
              : f.includes('CCITTFaxDecode')
                ? 'CCITT'
                : f.length
                  ? 'Flate'
                  : 'uncompressed';
        const isMask = ref.get('ImageMask').isBoolean() && ref.get('ImageMask').asBoolean();
        set(ref, {
          category: 'images',
          label: `${isMask ? 'Mask' : 'Image'} ${w.isNumber() ? w.asNumber() : '?'}×${h.isNumber() ? h.asNumber() : '?'} ${kind}`,
        });
      } else if (type === 'Metadata' || subtype === 'XML') set(ref, { category: 'metadata', label: 'XMP metadata' });
      else if (type === 'ObjStm') set(ref, { category: 'structure', label: 'Object stream' });
      else if (type === 'XRef') set(ref, { category: 'structure', label: 'Cross-reference stream' });
      else if (type === 'EmbeddedFile') set(ref, { category: 'attachments', label: 'Attached file' });
      else if (!subtype && ref.get('N').isNumber() && !ref.get('Length1').isNumber())
        set(ref, { category: 'other', label: 'Colour profile (ICC)' });
    }
    // /Type is often missing on descriptors (pdfTeX), so recognise them by their font file keys too.
    const isDescriptor =
      type === 'FontDescriptor' || ['FontFile', 'FontFile2', 'FontFile3'].some((k) => ref.get(k).isStream());
    if (isDescriptor) {
      const label = fontLabel(ref);
      for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
        const ff = ref.get(key);
        // A missing key yields MuPDF.js's shared Null object, whose get() throws.
        if (!ff.isStream()) continue;
        const what =
          key === 'FontFile2' ? 'TrueType' : key === 'FontFile3' ? (nameOf(ff.get('Subtype')) ?? 'CFF') : 'Type 1';
        set(ff, { category: 'fonts', label: `Font ${label} (${what})` });
      }
      set(ref.get('CIDSet'), {
        category: 'fonts',
        label: `CID set of ${label}`,
      });
    }
    if (type === 'Font') {
      set(ref.get('ToUnicode'), { category: 'fonts', label: 'ToUnicode map' });
      set(ref.get('CIDToGIDMap'), { category: 'fonts', label: 'CIDToGID map' });
      const procs = ref.get('CharProcs');
      if (procs.isDictionary()) procs.forEach((v) => set(v, { category: 'fonts', label: 'Type 3 glyph' }));
    }
    if (type === 'Page') {
      set(ref.get('Thumb'), { category: 'metadata', label: 'Page thumbnail' });
      const contents = ref.get('Contents');
      if (contents.isArray()) contents.forEach((c) => set(c, { category: 'content', label: 'Page content' }));
      else set(contents, { category: 'content', label: 'Page content' });
      const annots = ref.get('Annots');
      if (annots.isArray()) {
        annots.forEach((a) => {
          if (!a.isDictionary()) return;
          const ap = a.get('AP');
          if (!ap.isDictionary()) return;
          ap.forEach((state) => {
            if (state.isStream()) set(state, { category: 'forms', label: 'Annotation appearance' });
            else if (state.isDictionary())
              state.forEach((s) => set(s, { category: 'forms', label: 'Annotation appearance' }));
          });
        });
      }
    }
    if (ref.isStream() && subtype === 'Form' && !out.has(num)) set(ref, { category: 'content', label: 'Form XObject' });
  }
  return out;
}

export function analyzeSize(m: Mupdf, bytes: Uint8Array, password?: string, progress?: ProgressFn): SizeReport {
  const doc = openPdf(m, bytes, password);
  try {
    const fileBytes = bytes.byteLength;
    const pageCount = doc.countPages();
    progress?.(0, 4, 'Classifying objects');
    const classes = classify(doc);
    const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<SizeCategory, number>;

    const n = doc.countObjects();
    const sizes = new Map<number, number>();
    let hasObjectStreams = false;
    for (let num = 1; num < n; num += 1) {
      try {
        const ref = doc.newIndirect(num);
        if (!ref.isStream()) continue;
        const bytesOf = storedLength(ref);
        sizes.set(num, bytesOf);
        const cls = classes.get(num);
        if (cls?.label === 'Object stream') hasObjectStreams = true;
        categories[cls?.category ?? 'other'] += bytesOf;
      } catch {
        // broken object
      }
    }
    const streamTotal = [...sizes.values()].reduce((a, b) => a + b, 0);
    // Dictionaries, the xref table and whitespace: everything outside stream data.
    categories.structure += Math.max(0, fileBytes - streamTotal);

    progress?.(1, 4, 'Finding unused objects');
    const trailer = doc.getTrailer();
    const used = reachable(doc, [trailer], false);
    let unusedBytes = 0;
    for (const [num, size] of sizes) if (!used.has(num)) unusedBytes += size;

    progress?.(2, 4, 'Measuring image resolution');
    const dpi = placementDpi(m, doc);

    progress?.(3, 4, 'Weighing pages');
    const users = new Map<number, number[]>();
    for (let i = 0; i < pageCount; i += 1) {
      let page: Obj;
      try {
        page = doc.findPage(i);
      } catch {
        continue;
      }
      for (const num of reachable(doc, [page], true)) {
        if (!sizes.has(num)) continue;
        const list = users.get(num);
        if (list) list.push(i);
        else users.set(num, [i]);
      }
    }
    const pages = Array.from({ length: pageCount }, (_, index) => ({
      index,
      bytes: 0,
      images: 0,
      fonts: 0,
      content: 0,
    }));
    for (const [num, list] of users) {
      const share = (sizes.get(num) ?? 0) / list.length;
      const cat = classes.get(num)?.category ?? 'other';
      for (const p of list) {
        const entry = pages[p];
        if (!entry) continue;
        entry.bytes += share;
        if (cat === 'images') entry.images += share;
        else if (cat === 'fonts') entry.fonts += share;
        else if (cat === 'content') entry.content += share;
      }
    }
    for (const p of pages) {
      p.bytes = Math.round(p.bytes);
      p.images = Math.round(p.images);
      p.fonts = Math.round(p.fonts);
      p.content = Math.round(p.content);
    }

    const objects: SizeObject[] = [...sizes.entries()].map(([num, size]) => {
      const cls = classes.get(num);
      const d = dpi.get(num);
      return {
        num,
        category: cls?.category ?? 'other',
        bytes: size,
        label: cls?.label ?? 'Other stream',
        pages: users.get(num) ?? [],
        ...(d !== undefined ? { dpi: Math.round(d) } : {}),
      };
    });
    objects.sort((a, b) => b.bytes - a.bytes);

    const fullFonts: { name: string; bytes: number }[] = [];
    for (const o of objects) {
      if (o.category !== 'fonts' || !o.label.startsWith('Font ')) continue;
      const name = o.label.slice(5).replace(/\s*\(.*\)$/, '');
      // Subset fonts carry a six-letter tag: ABCDEF+Name.
      if (!/^[A-Z]{6}\+/.test(name)) fullFonts.push({ name, bytes: o.bytes });
    }
    let highDpiImages = 0;
    for (const o of objects) if (o.category === 'images' && (o.dpi ?? 0) > 300) highDpiImages += 1;

    progress?.(4, 4);
    return {
      fileBytes,
      pageCount,
      categories,
      largest: objects.slice(0, 20),
      pages,
      fullFonts,
      highDpiImages,
      unusedBytes,
      revisions: doc.countVersions(),
      hasObjectStreams,
    };
  } finally {
    doc.destroy();
  }
}
