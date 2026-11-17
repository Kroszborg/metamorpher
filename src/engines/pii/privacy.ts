// What a PDF reveals besides its visible pages, and how to remove it.
// Operations on an open MuPDF document; run inside the PII worker.
import type * as M from 'mupdf';
import { type Doc, type Mupdf, type Obj, nameOf, stripMetadata, walkXObjects } from '../mupdf/ops/common';
import { forEachJpeg, jpegMetadata, removeHiddenLayers, stripJpegMetadata } from './layers';
import { splitTextArrays } from './split-tj';
import type { CleanOptions, PrivacyReport } from './types';

const text = (o: Obj): string => {
  if (o.isString()) return o.asString();
  if (o.isName()) return o.asName();
  if (o.isNumber()) return String(o.asNumber());
  if (o.isStream()) {
    try {
      const buf = o.readStream();
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(buf.asUint8Array());
      } finally {
        buf.destroy();
      }
    } catch {
      return '';
    }
  }
  return '';
};

/** "D:20230314101500+05'30'" → ISO-ish text, or the raw value. */
export function pdfDate(raw: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(raw);
  if (!m) return raw;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz, th, tm] = m;
  const zone = tz && tz.toUpperCase() !== 'Z' && th ? `${tz}${th}:${tm ?? '00'}` : tz ? 'Z' : '';
  return `${y}-${mo}-${d} ${h}:${mi}:${s}${zone ? ` ${zone}` : ''}`;
}

/** Simple XMP fields: elements with text, rdf:li lists and attribute values (namespaced keys only). */
export function xmpFields(xml: string): { key: string; value: string }[] {
  const out = new Map<string, string>();
  const skip = /^(rdf|x|xmlns|xml)[:]/;
  // Lists: <dc:creator><rdf:Seq><rdf:li>…</rdf:li></rdf:Seq></dc:creator>
  for (const m of xml.matchAll(/<([A-Za-z][\w-]*:[\w-]+)(?:\s[^>]*)?>\s*<rdf:(?:Seq|Bag|Alt)>([\s\S]*?)<\/rdf:(?:Seq|Bag|Alt)>\s*<\/\1>/g)) {
    const key = m[1] ?? '';
    if (skip.test(key)) continue;
    const lis = [...(m[2] ?? '').matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((x) => (x[1] ?? '').trim()).filter(Boolean);
    if (lis.length && !out.has(key)) out.set(key, lis.join(', '));
  }
  // Plain text elements: <xmp:CreatorTool>…</xmp:CreatorTool>
  for (const m of xml.matchAll(/<([A-Za-z][\w-]*:[\w-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) {
    const key = m[1] ?? '';
    const value = (m[2] ?? '').trim();
    if (skip.test(key) || !value || out.has(key)) continue;
    out.set(key, value);
  }
  for (const m of xml.matchAll(/\s([A-Za-z][\w-]*:[\w-]+)="([^"]*)"/g)) {
    const key = m[1] ?? '';
    if (skip.test(key) || !m[2] || out.has(key)) continue;
    out.set(key, m[2]);
  }
  const history = (xml.match(/<rdf:li[^>]*stEvt:action|stEvt:action=/g) ?? []).length;
  if (history) out.set('xmpMM:History', `${history} recorded ${history === 1 ? 'edit' : 'edits'}`);
  return [...out].map(([key, value]) => ({ key, value: decodeXml(value).slice(0, 300) }));
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Counts saved revisions: each incremental update appends another xref section. */
export function revisionCount(bytes: Uint8Array): number {
  let n = 0;
  const needle = [0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66]; // startxref
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let k = 0; k < needle.length; k += 1) if (bytes[i + k] !== needle[k]) continue outer;
    n += 1;
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (/\/Linearized/.test(head) && n > 1) n -= 1;
  return Math.max(1, n);
}

function jsOf(action: Obj): string | null {
  if (!action.isDictionary()) return null;
  if (nameOf(action.get('S')) !== 'JavaScript') return null;
  return text(action.get('JS')).trim() || '(empty script)';
}

function actionKind(action: Obj): string | null {
  return action.isDictionary() ? nameOf(action.get('S')) : null;
}

const snippet = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s).replace(/\s+/g, ' ');

export function privacyReport(m: Mupdf, doc: Doc, bytes: Uint8Array): Omit<PrivacyReport, 'pii' | 'covered' | 'coverChecked'> {
  const trailer = doc.getTrailer();
  const root = trailer.get('Root');

  const info: { key: string; value: string }[] = [];
  const infoDict = trailer.get('Info');
  if (infoDict.isDictionary()) {
    infoDict.forEach((v, k) => {
      const value = text(v).trim();
      if (value) info.push({ key: String(k), value: /Date$/.test(String(k)) ? pdfDate(value) : value.slice(0, 300) });
    });
  }

  let xmp: PrivacyReport['xmp'] = null;
  const meta = root.get('Metadata');
  if (meta.isStream()) {
    const xml = text(meta);
    xmp = { bytes: xml.length, fields: xmpFields(xml) };
  }

  const ids: string[] = [];
  const id = trailer.get('ID');
  if (id.isArray()) {
    for (let i = 0; i < id.length; i += 1) {
      const v = id.get(i);
      if (v.isString()) ids.push([...v.asByteString()].map((b) => b.toString(16).padStart(2, '0')).join(''));
    }
  }

  const attachments: PrivacyReport['attachments'] = [];
  try {
    const files = doc.getEmbeddedFiles();
    for (const [name, spec] of Object.entries(files)) {
      let size: number | null = null;
      let mime: string | null = null;
      try {
        mime = doc.getFilespecParams(spec).mimetype || null;
        const contents = doc.getEmbeddedFileContents(spec);
        if (contents) {
          size = contents.getLength();
          contents.destroy();
        }
      } catch {
        // unreadable filespec: list the name anyway
      }
      attachments.push({ name, size, mime, page: null });
    }
  } catch {
    // no name tree
  }

  const javascript: PrivacyReport['javascript'] = [];
  const actions: PrivacyReport['actions'] = [];
  try {
    for (const [name, action] of Object.entries(doc.loadNameTree('JavaScript'))) {
      const js = jsOf(action.resolve());
      if (js) javascript.push({ where: `Document script “${name}”`, snippet: snippet(js) });
    }
  } catch {
    // no scripts
  }
  const open = root.get('OpenAction');
  if (open.isDictionary()) {
    const js = jsOf(open);
    if (js) javascript.push({ where: 'Runs when the file opens', snippet: snippet(js) });
    else {
      const kind = actionKind(open);
      if (kind && kind !== 'GoTo') actions.push({ where: 'When the file opens', kind });
    }
  }
  const rootAA = root.get('AA');
  if (rootAA.isDictionary()) {
    rootAA.forEach((a, k) => {
      const js = jsOf(a);
      if (js) javascript.push({ where: `Document event ${String(k)}`, snippet: snippet(js) });
    });
  }

  const layers: PrivacyReport['layers'] = [];
  const ocp = root.get('OCProperties');
  if (ocp.isDictionary()) {
    const off = new Set<number>();
    const offArr = ocp.get('D', 'OFF');
    if (offArr.isArray()) for (let i = 0; i < offArr.length; i += 1) if (offArr.get(i).isIndirect()) off.add(offArr.get(i).asIndirect());
    const ocgs = ocp.get('OCGs');
    if (ocgs.isArray()) {
      for (let i = 0; i < ocgs.length; i += 1) {
        const g = ocgs.get(i);
        layers.push({ name: text(g.get('Name')) || `Layer ${i + 1}`, hidden: g.isIndirect() && off.has(g.asIndirect()) });
      }
    }
  }

  const annotations: PrivacyReport['annotations'] = [];
  const fields: PrivacyReport['fields'] = [];
  const links: PrivacyReport['links'] = [];
  const fonts = new Map<string, PrivacyReport['fonts'][number]>();
  let thumbnails = 0;
  let pieceInfo = root.get('PieceInfo').isDictionary();
  let signatures = 0;
  const seenFonts = new Set<number>();

  const addFonts = (resources: Obj) => {
    const add = (fontDict: Obj) => {
      if (!fontDict.isDictionary()) return;
      fontDict.forEach((f) => {
        if (f.isIndirect()) {
          const num = f.asIndirect();
          if (seenFonts.has(num)) return;
          seenFonts.add(num);
        }
        const base = nameOf(f.get('BaseFont')) ?? '(unnamed)';
        const subtype = nameOf(f.get('Subtype')) ?? '';
        let desc = f.get('FontDescriptor');
        if (subtype === 'Type0') desc = f.get('DescendantFonts', 0, 'FontDescriptor');
        const embedded = desc.isDictionary() && (desc.get('FontFile').isStream() || desc.get('FontFile2').isStream() || desc.get('FontFile3').isStream());
        const name = base.replace(/^[A-Z]{6}\+/, '');
        const key = `${name}|${embedded}`;
        if (!fonts.has(key)) fonts.set(key, { name, type: subtype, embedded, subset: /^[A-Z]{6}\+/.test(base) });
      });
    };
    if (resources.isDictionary()) add(resources.get('Font'));
    walkXObjects(resources, (_n, ref, sub) => {
      if (sub === 'Form') add(ref.get('Resources', 'Font'));
    });
  };

  const pageCount = doc.countPages();
  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = doc.findPage(i);
    if (pageObj.get('Thumb').isStream()) thumbnails += 1;
    if (pageObj.get('PieceInfo').isDictionary()) pieceInfo = true;
    const pageAA = pageObj.get('AA');
    if (pageAA.isDictionary()) {
      pageAA.forEach((a, k) => {
        const js = jsOf(a);
        if (js) javascript.push({ where: `Page ${i + 1} event ${String(k)}`, snippet: snippet(js) });
      });
    }
    addFonts(pageObj.getInheritable('Resources'));
    const page = doc.loadPage(i);
    try {
      for (const annot of page.getAnnotations()) {
        const type = annot.getType();
        const obj = annot.getObject();
        const a = obj.get('A');
        const js = jsOf(a);
        if (js) javascript.push({ where: `Page ${i + 1} ${type} annotation`, snippet: snippet(js) });
        const kind = actionKind(a);
        if (kind && ['Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE'].includes(kind)) {
          actions.push({ where: `Page ${i + 1} ${type} annotation`, kind });
        }
        if (type === 'Link' || type === 'Popup') continue;
        if (type === 'FileAttachment') {
          attachments.push({ name: text(obj.get('FS', 'UF')) || text(obj.get('FS', 'F')) || 'attachment', size: null, mime: null, page: i });
        }
        let date: string | null = null;
        try {
          const d = annot.getModificationDate();
          date = d && !Number.isNaN(d.getTime()) && d.getTime() > 0 ? d.toISOString().slice(0, 16).replace('T', ' ') : null;
        } catch {
          date = null;
        }
        annotations.push({ page: i, type, author: annot.getAuthor?.() ?? '', contents: snippet(annot.getContents?.() ?? ''), date });
      }
      for (const w of page.getWidgets()) {
        const type = w.getFieldType();
        if (type === 'signature') signatures += 1;
        const wObj = w.getObject();
        const aa = wObj.get('AA');
        if (aa.isDictionary()) {
          aa.forEach((a, k) => {
            const js = jsOf(a);
            if (js) javascript.push({ where: `Page ${i + 1} field “${w.getName()}” (${String(k)})`, snippet: snippet(js) });
          });
        }
        const js = jsOf(wObj.get('A'));
        if (js) javascript.push({ where: `Page ${i + 1} field “${w.getName()}”`, snippet: snippet(js) });
        fields.push({ page: i, name: w.getName(), type, value: snippet(w.getValue() ?? '') });
      }
      for (const link of page.getLinks()) {
        if (link.isExternal()) links.push({ page: i, uri: link.getURI() });
      }
    } finally {
      page.destroy();
    }
  }

  // Metadata inside JPEG pictures.
  const imageMeta: PrivacyReport['imageMeta'] = { images: 0, withMeta: 0, details: [] };
  forEachJpeg(doc, (_obj, jpeg) => {
    imageMeta.images += 1;
    const meta = jpegMetadata(jpeg);
    if (meta.exif || meta.xmp || meta.iptc || meta.comment) {
      imageMeta.withMeta += 1;
      const kinds = [meta.exif ? 'EXIF' : '', meta.xmp ? 'XMP' : '', meta.iptc ? 'IPTC' : '', meta.comment ? 'comment' : ''].filter(Boolean).join(', ');
      if (imageMeta.details.length < 12) imageMeta.details.push(`${kinds}${meta.details.length ? `: ${meta.details.join(', ')}` : ''}`);
    }
  });

  return {
    imageMeta,
    pageCount,
    info,
    xmp,
    ids,
    revisions: revisionCount(bytes),
    attachments,
    javascript,
    actions,
    layers,
    annotations,
    fields,
    signatures,
    fonts: [...fonts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    links,
    thumbnails,
    pieceInfo,
  };
}

/** Text of a page's content streams joined (operators may straddle stream boundaries). */
function joinedContents(page: Obj): Uint8Array {
  const contents = page.get('Contents');
  const parts: Uint8Array[] = [];
  const read = (o: Obj) => {
    const buf = o.readStream();
    try {
      parts.push(buf.asUint8Array().slice());
    } finally {
      buf.destroy();
    }
  };
  if (contents.isArray()) {
    for (let i = 0; i < contents.length; i += 1) if (contents.get(i).isStream()) read(contents.get(i));
  } else if (contents.isStream()) read(contents);
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    joined[at + p.length] = 10;
    at += p.length + 1;
  }
  return joined;
}

/**
 * Rewrites the text of `pages` (and their form XObjects) from TJ arrays to Tj
 * strings: same drawing, but MuPDF's redaction then keeps the rest of a line in
 * place. Returns true when anything changed.
 */
export function splitPageText(doc: Doc, pages: Iterable<number>): boolean {
  let changed = false;
  const forms = new Set<number>();
  for (const index of new Set(pages)) {
    if (index < 0 || index >= doc.countPages()) continue;
    const page = doc.findPage(index);
    const split = splitTextArrays(joinedContents(page));
    if (split) {
      page.put('Contents', doc.addStream(split, {}));
      changed = true;
    }
    walkXObjects(page.getInheritable('Resources'), (num, ref, subtype) => {
      if (subtype !== 'Form' || forms.has(num)) return;
      forms.add(num);
      const buf = ref.readStream();
      let data: Uint8Array;
      try {
        data = buf.asUint8Array().slice();
      } finally {
        buf.destroy();
      }
      const out = splitTextArrays(data);
      if (out) {
        ref.writeStream(out);
        changed = true;
      }
    });
  }
  return changed;
}

const COMMENT_KEEP = new Set(['Link', 'Widget', 'Popup']);

/** Deletes matching annotations. The list is fetched again after each delete (a deletion can leave it stale). */
function deleteAnnotations(page: M.PDFPage, match: (a: M.PDFAnnotation) => boolean): number {
  let n = 0;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const victim = page.getAnnotations().find(match);
    if (!victim) break;
    page.deleteAnnotation(victim);
    n += 1;
  }
  return n;
}

/** Removes what `opts` asks for from an open document. Returns sentences describing what was removed. */
export function cleanDocument(_m: Mupdf, doc: Doc, opts: CleanOptions): string[] {
  const done: string[] = [];
  const trailer = doc.getTrailer();
  const root = trailer.get('Root');
  if (opts.metadata) {
    stripMetadata(doc);
    done.push('Document properties, XMP metadata, page thumbnails and private application data');
  }
  if (opts.imageMetadata) {
    let n = 0;
    forEachJpeg(doc, (obj, jpeg) => {
      const clean = stripJpegMetadata(jpeg);
      if (clean) {
        obj.writeRawStream(clean);
        n += 1;
      }
    });
    if (n) done.push(`Camera and editing metadata (EXIF, XMP, IPTC) inside ${n} ${n === 1 ? 'picture' : 'pictures'}`);
  }
  if (opts.hiddenLayers) {
    const { removed, layers } = removeHiddenLayers(doc);
    if (layers) done.push(`${layers} hidden ${layers === 1 ? 'layer' : 'layers'} (${removed} ${removed === 1 ? 'piece' : 'pieces'} of content cut out)`);
  }
  if (opts.attachments) {
    const names = root.get('Names');
    let n = 0;
    if (names.isDictionary() && names.get('EmbeddedFiles').isDictionary()) {
      names.delete('EmbeddedFiles');
      n += 1;
    }
    if (root.get('AF').isArray()) root.delete('AF');
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        n += deleteAnnotations(page, (a) => a.getType() === 'FileAttachment');
      } finally {
        page.destroy();
      }
    }
    if (n) done.push('Attached files');
  }
  if (opts.javascript) {
    const names = root.get('Names');
    if (names.isDictionary()) names.delete('JavaScript');
    const open = root.get('OpenAction');
    if (open.isDictionary() && nameOf(open.get('S')) !== 'GoTo') root.delete('OpenAction');
    root.delete('AA');
    for (let i = 0; i < doc.countPages(); i += 1) {
      doc.findPage(i).delete('AA');
      const page = doc.loadPage(i);
      try {
        for (const a of [...page.getAnnotations(), ...page.getWidgets()]) {
          const obj = a.getObject();
          obj.delete('AA');
          const kind = nameOf(obj.get('A', 'S'));
          if (kind && ['JavaScript', 'Launch', 'SubmitForm', 'ImportData'].includes(kind)) obj.delete('A');
        }
      } finally {
        page.destroy();
      }
    }
    done.push('Scripts and automatic actions (JavaScript, launch and submit actions)');
  }
  if (opts.comments) {
    let n = 0;
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        n += deleteAnnotations(page, (a) => !COMMENT_KEEP.has(a.getType()));
      } finally {
        page.destroy();
      }
    }
    if (n) done.push(`${n} ${n === 1 ? 'comment or markup' : 'comments and markups'}`);
  }
  if (opts.formValues) {
    let n = 0;
    for (let i = 0; i < doc.countPages(); i += 1) {
      const page = doc.loadPage(i);
      try {
        for (const w of page.getWidgets()) {
          if (w.getFieldType() === 'text' && w.getValue()) {
            w.setTextValue('');
            w.update();
            n += 1;
          }
        }
      } finally {
        page.destroy();
      }
    }
    if (n) done.push(`Values of ${n} text ${n === 1 ? 'field' : 'fields'}`);
  }
  // Last, on a fresh trailer: other clean-ups (the metadata pass) can leave the identifier in place.
  if (opts.fileId) {
    const t = doc.getTrailer();
    if (!t.get('ID').isNull()) {
      t.delete('ID');
      done.push('The file identifier');
    }
  }
  // Every save here is a full rewrite: earlier revisions kept by incremental saves are dropped.
  return done;
}

