// Hidden layers (optional content that is off by default) and picture
// metadata (EXIF, XMP, IPTC inside JPEG images): found for the privacy
// report and removed by the clean-up. Hidden layer content is cut out of the
// content streams (marked-content sections and XObjects that belong to an off
// layer), so it cannot be switched back on or extracted.
import type { Doc, Obj } from '../mupdf/ops/common';

// ── Content stream tokens ──────────────────────────────────────────────────

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

type Token = { start: number; end: number; kind: 'op' | 'name' | 'other'; text: string };

/** Tokens of a content stream (bytes as a latin-1 string), inline image data skipped whole. */
function* tokens(s: string): Generator<Token> {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (c === 0x25) {
      // comment
      while (i < n && s.charCodeAt(i) !== 0x0a && s.charCodeAt(i) !== 0x0d) i += 1;
      continue;
    }
    if (c === 0x28) {
      let depth = 0;
      for (; i < n; i++) {
        const d = s.charCodeAt(i);
        if (d === 0x5c) i += 1;
        else if (d === 0x28) depth += 1;
        else if (d === 0x29) {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
      }
      yield { start, end: i, kind: 'other', text: '' };
      continue;
    }
    if (c === 0x3c) {
      if (s.charCodeAt(i + 1) === 0x3c) {
        i += 2;
        yield { start, end: i, kind: 'other', text: '<<' };
        continue;
      }
      while (i < n && s.charCodeAt(i) !== 0x3e) i += 1;
      i += 1;
      yield { start, end: i, kind: 'other', text: '' };
      continue;
    }
    if (c === 0x3e) {
      i += s.charCodeAt(i + 1) === 0x3e ? 2 : 1;
      yield { start, end: i, kind: 'other', text: '>>' };
      continue;
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i += 1;
      yield { start, end: i, kind: 'other', text: s[start] as string };
      continue;
    }
    if (c === 0x2f) {
      i += 1;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i += 1;
      yield { start, end: i, kind: 'name', text: s.slice(start + 1, i) };
      continue;
    }
    while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i += 1;
    if (i === start) i += 1;
    const text = s.slice(start, i);
    const isNumber = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
    if (!isNumber && text !== 'true' && text !== 'false' && text !== 'null') {
      if (text === 'ID') {
        // Inline image data: up to whitespace + EI + whitespace.
        i += 1;
        const m = /\sEI(?=[\s\0]|$)/g;
        m.lastIndex = i;
        const hit = m.exec(s);
        i = hit ? hit.index + hit[0].length : n;
        yield { start, end: i, kind: 'op', text: 'ID' };
        continue;
      }
      yield { start, end: i, kind: 'op', text };
    } else yield { start, end: i, kind: 'other', text };
  }
}

/**
 * Cuts out marked content of hidden layers (`/OC /name BDC … EMC` with a
 * hidden property name) and `Do` of hidden XObjects. Returns the new
 * content and how many pieces were removed.
 */
export function stripHiddenContent(s: string, hiddenProps: ReadonlySet<string>, hiddenXObjects: ReadonlySet<string>): { content: string; removed: number } {
  let out = '';
  let copied = 0;
  let removed = 0;
  let operands: Token[] = [];
  const stack: boolean[] = [];
  let skipFrom = -1;
  let skipDepth = -1;
  for (const t of tokens(s)) {
    if (t.kind !== 'op') {
      operands.push(t);
      continue;
    }
    const first = operands[0];
    const opStart = first ? first.start : t.start;
    if (t.text === 'BDC' || t.text === 'BMC') {
      const hidden = t.text === 'BDC' && operands[0]?.kind === 'name' && operands[0].text === 'OC' && operands[1]?.kind === 'name' && hiddenProps.has(operands[1].text);
      stack.push(hidden);
      if (hidden && skipFrom < 0) {
        skipFrom = opStart;
        skipDepth = stack.length;
      }
    } else if (t.text === 'EMC') {
      if (skipFrom >= 0 && stack.length === skipDepth) {
        out += s.slice(copied, skipFrom);
        copied = t.end;
        skipFrom = -1;
        skipDepth = -1;
        removed += 1;
      }
      stack.pop();
    } else if (t.text === 'Do' && skipFrom < 0) {
      const name = operands[operands.length - 1];
      if (name?.kind === 'name' && hiddenXObjects.has(name.text)) {
        out += s.slice(copied, opStart);
        copied = t.end;
        removed += 1;
      }
    }
    operands = [];
  }
  // An unclosed hidden section runs to the end.
  if (skipFrom >= 0) {
    out += s.slice(copied, skipFrom);
    copied = s.length;
    removed += 1;
  }
  out += s.slice(copied);
  return { content: out, removed };
}

// ── Optional content ───────────────────────────────────────────────────────

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const bytesOf = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

/** Object numbers of the layers that are off in the default view. */
export function hiddenLayers(doc: Doc): Set<number> {
  const off = new Set<number>();
  const ocp = doc.getTrailer().get('Root', 'OCProperties');
  if (!ocp.isDictionary()) return off;
  const d = ocp.get('D');
  const offArr = d.get('OFF');
  if (offArr.isArray()) for (let i = 0; i < offArr.length; i++) if (offArr.get(i).isIndirect()) off.add(offArr.get(i).asIndirect());
  // BaseState /OFF: everything not listed in ON is off.
  if (d.get('BaseState').isName() && d.get('BaseState').asName() === 'OFF') {
    const on = new Set<number>();
    const onArr = d.get('ON');
    if (onArr.isArray()) for (let i = 0; i < onArr.length; i++) if (onArr.get(i).isIndirect()) on.add(onArr.get(i).asIndirect());
    const all = ocp.get('OCGs');
    if (all.isArray()) for (let i = 0; i < all.length; i++) if (all.get(i).isIndirect() && !on.has(all.get(i).asIndirect())) off.add(all.get(i).asIndirect());
  }
  return off;
}

/** Whether an /OC value (a layer or a membership dictionary) is hidden by `off`. */
function ocHidden(oc: Obj, off: ReadonlySet<number>): boolean {
  if (oc.isNull()) return false;
  if (oc.isIndirect() && off.has(oc.asIndirect())) return true;
  const r = oc.resolve();
  if (r.isDictionary() && r.get('Type').isName() && r.get('Type').asName() === 'OCMD') {
    const ocgs = r.get('OCGs');
    const list: Obj[] = [];
    if (ocgs.isArray()) for (let i = 0; i < ocgs.length; i++) list.push(ocgs.get(i));
    else if (!ocgs.isNull()) list.push(ocgs);
    if (list.length === 0) return false;
    const policy = r.get('P').isName() ? r.get('P').asName() : 'AnyOn';
    const hidden = list.map((g) => g.isIndirect() && off.has(g.asIndirect()));
    if (policy === 'AllOn') return hidden.some(Boolean);
    if (policy === 'AnyOff') return !hidden.some(Boolean);
    if (policy === 'AllOff') return !hidden.every(Boolean);
    return hidden.every(Boolean);
  }
  return false;
}

function namesHidden(dict: Obj, off: ReadonlySet<number>, test: (v: Obj) => boolean): Set<string> {
  const names = new Set<string>();
  if (!dict.isDictionary()) return names;
  dict.forEach((v, k) => {
    if (typeof k === 'string' && test(v)) names.add(k);
  });
  void off;
  return names;
}

function streamContent(doc: Doc, contents: Obj): string {
  if (contents.isArray()) {
    let s = '';
    for (let i = 0; i < contents.length; i++) s += `${latin1(contents.get(i).readStream().asUint8Array())}\n`;
    return s;
  }
  return contents.isStream() ? latin1(contents.readStream().asUint8Array()) : '';
}

/**
 * Removes the content of layers that are off by default from every page,
 * form XObject and annotation, then drops those layers from the document's
 * layer list. Returns the number of pieces of content removed.
 */
export function removeHiddenLayers(doc: Doc): { removed: number; layers: number } {
  const off = hiddenLayers(doc);
  if (off.size === 0) return { removed: 0, layers: 0 };
  let removed = 0;
  const doneForms = new Set<number>();
  const filterStream = (holder: Obj, contents: Obj, resources: Obj, replace: (bytes: Uint8Array) => void) => {
    const props = namesHidden(resources.get('Properties'), off, (v) => ocHidden(v, off));
    const xobjs = namesHidden(resources.get('XObject'), off, (v) => ocHidden(v.get('OC'), off));
    void holder;
    if (props.size || xobjs.size) {
      const { content, removed: r } = stripHiddenContent(streamContent(doc, contents), props, xobjs);
      if (r) {
        removed += r;
        replace(bytesOf(content));
      }
      // Pictures and forms of a hidden layer are no longer drawn: drop them from the file too.
      const xo = resources.get('XObject');
      for (const name of xobjs) xo.delete(name);
    }
    // Forms drawn here may have hidden sections of their own.
    const xo = resources.get('XObject');
    if (xo.isDictionary()) {
      xo.forEach((ref) => {
        if (!ref.isIndirect() || doneForms.has(ref.asIndirect())) return;
        doneForms.add(ref.asIndirect());
        if (!(ref.get('Subtype').isName() && ref.get('Subtype').asName() === 'Form')) return;
        const res = ref.get('Resources');
        filterStream(ref, ref, res.isDictionary() ? res : resources, (bytes) => ref.writeStream(bytes));
      });
    }
  };
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const pageObj = doc.findPage(i);
    const resources = pageObj.getInheritable('Resources');
    const contents = pageObj.get('Contents');
    if (resources.isDictionary()) {
      filterStream(pageObj, contents, resources, (bytes) => {
        if (contents.isArray()) pageObj.put('Contents', doc.addStream(bytes, {}));
        else contents.writeStream(bytes);
      });
    }
    // Annotations on a hidden layer.
    const annots = pageObj.get('Annots');
    if (annots.isArray()) {
      for (let k = annots.length - 1; k >= 0; k--) {
        if (ocHidden(annots.get(k).get('OC'), off)) {
          annots.delete(k);
          removed += 1;
        }
      }
    }
  }
  // The layer list without the removed layers.
  const ocp = doc.getTrailer().get('Root', 'OCProperties');
  const prune = (arr: Obj) => {
    if (!arr.isArray()) return;
    for (let k = arr.length - 1; k >= 0; k--) {
      const v = arr.get(k);
      if (v.isIndirect() && off.has(v.asIndirect())) arr.delete(k);
      else if (v.isArray()) prune(v);
    }
  };
  prune(ocp.get('OCGs'));
  const d = ocp.get('D');
  if (d.isDictionary()) {
    for (const key of ['ON', 'OFF', 'Order', 'RBGroups', 'Locked']) prune(d.get(key));
    if (d.get('AS').isArray()) d.delete('AS');
  }
  ocp.delete('Configs');
  const left = ocp.get('OCGs');
  if (!left.isArray() || left.length === 0) doc.getTrailer().get('Root').delete('OCProperties');
  return { removed, layers: off.size };
}

// ── Picture metadata ───────────────────────────────────────────────────────

export type ImageMeta = { exif: boolean; xmp: boolean; iptc: boolean; comment: boolean; details: string[] };

/** APP segments of a JPEG (up to the image data). */
function* jpegSegments(b: Uint8Array): Generator<{ marker: number; start: number; end: number; data: Uint8Array }> {
  if (b[0] !== 0xff || b[1] !== 0xd8) return;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return;
    const marker = b[i + 1] as number;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return;
    const len = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
    if (len < 2 || i + 2 + len > b.length) return;
    yield { marker, start: i, end: i + 2 + len, data: b.subarray(i + 4, i + 2 + len) };
    i += 2 + len;
  }
}

const ascii = (d: Uint8Array, n: number) => String.fromCharCode(...d.subarray(0, n));

/** A few identifying EXIF fields: camera, software, date, GPS. */
function exifDetails(d: Uint8Array): string[] {
  const out: string[] = [];
  const t = 6; // after "Exif\0\0"
  if (d.length < t + 8) return out;
  const little = d[t] === 0x49;
  const u16 = (o: number) => (little ? (d[o] ?? 0) | ((d[o + 1] ?? 0) << 8) : ((d[o] ?? 0) << 8) | (d[o + 1] ?? 0));
  const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2)) >>> 0;
  const str = (count: number, valueAt: number) => {
    const at = count > 4 ? t + u32(valueAt) : valueAt;
    let s = '';
    for (let k = 0; k < count - 1 && at + k < d.length; k++) s += String.fromCharCode(d[at + k] as number);
    return s.replace(/\0+$/, '').trim();
  };
  const ifd = t + u32(t + 4);
  const count = u16(ifd);
  for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= d.length; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    const n = u32(e + 4);
    if (tag === 0x010f) out.push(`camera make ${str(n, e + 8)}`);
    else if (tag === 0x0110) out.push(`model ${str(n, e + 8)}`);
    else if (tag === 0x0131) out.push(`software ${str(n, e + 8)}`);
    else if (tag === 0x0132) out.push(`taken ${str(n, e + 8)}`);
    else if (tag === 0x013b) out.push(`artist ${str(n, e + 8)}`);
    else if (tag === 0x8825) out.push('GPS location');
  }
  return out;
}

export function jpegMetadata(b: Uint8Array): ImageMeta {
  const meta: ImageMeta = { exif: false, xmp: false, iptc: false, comment: false, details: [] };
  for (const seg of jpegSegments(b)) {
    if (seg.marker === 0xe1 && ascii(seg.data, 6) === 'Exif\0\0') {
      meta.exif = true;
      meta.details.push(...exifDetails(seg.data));
    } else if (seg.marker === 0xe1 && ascii(seg.data, 28).startsWith('http://ns.adobe.com/xap/1.0/')) meta.xmp = true;
    else if (seg.marker === 0xed) meta.iptc = true;
    else if (seg.marker === 0xfe) meta.comment = true;
  }
  return meta;
}

/** The JPEG without EXIF, XMP, IPTC and comment segments (pixels, colour profile and Adobe marker kept). */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  const drop: [number, number][] = [];
  for (const seg of jpegSegments(b)) {
    const isExifOrXmp = seg.marker === 0xe1;
    if (isExifOrXmp || seg.marker === 0xed || seg.marker === 0xfe || (seg.marker >= 0xe3 && seg.marker <= 0xec) || seg.marker === 0xef) drop.push([seg.start, seg.end]);
  }
  if (drop.length === 0) return null;
  const out = new Uint8Array(b.length - drop.reduce((n, [s, e]) => n + e - s, 0));
  let at = 0;
  let from = 0;
  for (const [s, e] of drop) {
    out.set(b.subarray(from, s), at);
    at += s - from;
    from = e;
  }
  out.set(b.subarray(from), at);
  return out;
}

/** Every JPEG image stream of the document (DCTDecode only, so the raw bytes are the JPEG file). */
export function forEachJpeg(doc: Doc, visit: (obj: Obj, bytes: Uint8Array) => void): void {
  const n = doc.countObjects();
  for (let num = 1; num < n; num++) {
    try {
      const obj = doc.newIndirect(num);
      if (!obj.isStream()) continue;
      const sub = obj.get('Subtype');
      if (!(sub.isName() && sub.asName() === 'Image')) continue;
      const f = obj.get('Filter');
      const dct = (f.isName() && f.asName() === 'DCTDecode') || (f.isArray() && f.length === 1 && f.get(0).asName() === 'DCTDecode');
      if (!dct) continue;
      visit(obj, obj.readRawStream().asUint8Array());
    } catch {
      // broken object: skip
    }
  }
}
