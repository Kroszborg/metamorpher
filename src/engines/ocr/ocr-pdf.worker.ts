// MuPDF side of OCR: renders pages for recognition and writes the invisible
// text layer into the document. Holds one open document at a time so a long
// scan is rendered and written page by page; the original page content
// (scanned images, vectors) is kept byte for byte.
import { expose, transfer } from 'comlink';
import type * as M from 'mupdf';
import { type Doc, type Mupdf, bufferToBytes, openPdf, writeOptions } from '../mupdf/ops/common';
import { STEXT_OPTIONS } from '../mupdf/ops/text';
import { FONT_ASCENT, FONT_DESCENT, cidToGidMap, glyphlessTrueType, identityToUnicode } from './glyphless';
import { invertMatrix, textLayerOps } from './text-layer';
import type { LayerLine, OcrPageInfo, OcrRender, PageSheet } from './types';

let lib: Promise<Mupdf> | null = null;
function load(): Promise<Mupdf> {
  lib ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ new URL('/vendor/mupdf/mupdf.js', self.location.origin).href
  ) as Promise<typeof M>;
  return lib;
}

type State = { doc: Doc; font: M.PDFObject | null; fontName: string; layered: number };
let state: State | null = null;

function current(): State {
  if (!state) throw new Error('No document is open for OCR.');
  return state;
}

function close(): void {
  state?.doc.destroy();
  state = null;
}

/** Tesseract handles about 35 megapixels comfortably; larger pages are rendered smaller. */
const MAX_PIXELS = 35_000_000;
const MAX_SIDE = 10_000;

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a);

/** Every image of a file: the pages of a multi-page TIFF, or the one picture of anything else. */
function imagesOf(m: Mupdf, bytes: Uint8Array): M.Image[] {
  if (isTiff(bytes)) {
    let doc: M.Document | null = null;
    try {
      doc = m.Document.openDocument(bytes, 'image/tiff');
      const n = doc.countPages();
      if (n > 1) {
        const images: M.Image[] = [];
        for (let i = 0; i < n; i++) {
          const page = doc.loadPage(i);
          // The page of an image document draws its picture once: catch it.
          const dev = new m.Device({
            fillImage: (image) => {
              if (images.length <= i) images.push(new m.Image(image.toPixmap()));
            },
          });
          try {
            page.run(dev, m.Matrix.identity);
          } finally {
            dev.close();
            dev.destroy();
            page.destroy();
          }
        }
        if (images.length === n) return images;
        for (const im of images) im.destroy();
      }
    } catch {
      // Fall through to reading it as a single image.
    } finally {
      doc?.destroy();
    }
  }
  try {
    return [new m.Image(bytes)];
  } catch {
    throw new Error('This image could not be read.');
  }
}

/** Image inputs become one page each, sized from their resolution (A4-ish when it is missing or odd). */
function imagePage(m: Mupdf, doc: Doc, image: M.Image, sheet?: PageSheet): void {
  try {
    const w = image.getWidth();
    const h = image.getHeight();
    const xres = image.getXResolution();
    const yres = image.getYResolution();
    let pw = (w * 72) / (xres > 0 ? xres : 300);
    let ph = (h * 72) / (yres > 0 ? yres : 300);
    const long = Math.max(pw, ph);
    // 72 dpi photos would make 50-inch pages, tiny icons 1-inch ones: fit the long side to A4 instead.
    if (long > 17 * 72 || long < 3 * 72) {
      const k = 842 / long;
      pw *= k;
      ph *= k;
    }
    // On a fixed sheet: fitted inside the margins and centred.
    let sheetW = pw;
    let sheetH = ph;
    let x = 0;
    let y = 0;
    if (sheet) {
      const k = Math.min((sheet.width - 2 * sheet.margin) / pw, (sheet.height - 2 * sheet.margin) / ph);
      pw *= k;
      ph *= k;
      sheetW = sheet.width;
      sheetH = sheet.height;
      x = (sheetW - pw) / 2;
      y = (sheetH - ph) / 2;
    }
    const ref = doc.addImage(image);
    const resources = doc.addObject({ XObject: { Im0: ref } });
    const contents = `q ${pw.toFixed(3)} 0 0 ${ph.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q`;
    const page = doc.addPage([0, 0, sheetW, sheetH], 0, resources, contents);
    doc.insertPage(-1, page);
  } finally {
    image.destroy();
  }
}

function glyphlessFont(doc: Doc): M.PDFObject {
  const file = doc.addStream(glyphlessTrueType(), { Length1: glyphlessTrueType().length });
  const descriptor = doc.addObject({
    Type: 'FontDescriptor',
    FontName: 'GlyphLessFont',
    Flags: 5,
    FontBBox: [0, -FONT_DESCENT * 1000, 500, FONT_ASCENT * 1000],
    ItalicAngle: 0,
    Ascent: FONT_ASCENT * 1000,
    Descent: -FONT_DESCENT * 1000,
    CapHeight: FONT_ASCENT * 1000,
    StemV: 80,
    FontFile2: file,
  });
  const cidFont = doc.addObject({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'GlyphLessFont',
    CIDSystemInfo: { Registry: '(Adobe)', Ordering: '(Identity)', Supplement: 0 },
    FontDescriptor: descriptor,
    DW: 500,
    CIDToGIDMap: doc.addStream(cidToGidMap(), {}),
  });
  return doc.addObject({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'GlyphLessFont',
    Encoding: 'Identity-H',
    DescendantFonts: [cidFont],
    ToUnicode: doc.addStream(identityToUnicode(), {}),
  });
}

/** A copy of the page's (possibly inherited) resources on the page itself, with a Font dictionary. */
function pageFonts(doc: Doc, pageObj: M.PDFObject): M.PDFObject {
  let resources = pageObj.get('Resources');
  if (!resources.isDictionary()) {
    const inherited = pageObj.getInheritable('Resources');
    resources = doc.newDictionary();
    if (inherited.isDictionary()) inherited.forEach((v, k) => resources.put(k, v));
    pageObj.put('Resources', resources);
  }
  let fonts = resources.get('Font');
  if (!fonts.isDictionary()) {
    fonts = doc.newDictionary();
    resources.put('Font', fonts);
  }
  return fonts;
}

function contentsArray(doc: Doc, pageObj: M.PDFObject): M.PDFObject {
  const contents = pageObj.get('Contents');
  const arr = doc.newArray();
  if (contents.isArray()) for (let i = 0; i < contents.length; i += 1) arr.push(contents.get(i));
  else if (!contents.isNull()) arr.push(contents);
  return arr;
}

function visibleChars(page: M.Page): { chars: number; text: string } {
  const stext = page.toStructuredText(STEXT_OPTIONS);
  try {
    const text = stext.asText();
    return { chars: text.replace(/\s+/g, '').length, text: text.replace(/\s+$/, '') };
  } finally {
    stext.destroy();
  }
}

const api = {
  /** Opens a PDF for OCR. Resolves with the page count. */
  async openPdf(file: Blob, password?: string): Promise<number> {
    close();
    const m = await load();
    const doc = openPdf(m, new Uint8Array(await file.arrayBuffer()), password);
    state = { doc, font: null, fontName: '', layered: 0 };
    return doc.countPages();
  },

  /** Builds a PDF from images (encoded bytes MuPDF reads: JPEG, PNG, GIF, BMP, TIFF), one page each. */
  async openImages(images: Uint8Array[], sheet?: PageSheet): Promise<number> {
    close();
    const m = await load();
    const doc = new m.PDFDocument();
    state = { doc, font: null, fontName: '', layered: 0 };
    for (const bytes of images) for (const image of imagesOf(m, bytes)) imagePage(m, doc, image, sheet);
    return doc.countPages();
  },

  /** Turns a page clockwise by a quarter-turn multiple (its /Rotate). */
  async rotate(index: number, degrees: number): Promise<void> {
    const page = current().doc.loadPage(index);
    try {
      const obj = page.getObject();
      const old = obj.getInheritable('Rotate');
      const now = ((((old.isNumber() ? old.asNumber() : 0) + degrees) % 360) + 360) % 360;
      obj.put('Rotate', now);
    } finally {
      page.destroy();
    }
  },

  async pageInfo(index: number): Promise<OcrPageInfo> {
    const page = current().doc.loadPage(index);
    try {
      const { chars, text } = visibleChars(page);
      return { index, textChars: chars, text };
    } finally {
      page.destroy();
    }
  },

  /** Renders a page in grey for recognition, at `dpi` (smaller for very large pages, to bound memory). */
  async render(index: number, dpi: number): Promise<OcrRender> {
    const m = await load();
    const page = current().doc.loadPage(index);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const pw = Math.max(1, x1 - x0);
      const ph = Math.max(1, y1 - y0);
      const s = Math.min(dpi / 72, MAX_SIDE / pw, MAX_SIDE / ph, Math.sqrt(MAX_PIXELS / (pw * ph)));
      const pix = page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceGray, false, true);
      try {
        const w = pix.getWidth();
        const h = pix.getHeight();
        const stride = pix.getStride();
        const src = pix.getPixels();
        const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
        const image = new Uint8Array(header.length + w * h);
        image.set(header, 0);
        if (stride === w) image.set(src.subarray(0, w * h), header.length);
        else for (let y = 0; y < h; y += 1) image.set(src.subarray(y * stride, y * stride + w), header.length + y * w);
        return transfer({ index, image, width: w, height: h, pageWidth: pw, pageHeight: ph }, [image.buffer]);
      } finally {
        pix.destroy();
      }
    } finally {
      page.destroy();
    }
  },

  /** Adds an invisible text layer to a page. `lines` are in MuPDF page space (points, top-left origin). */
  async addTextLayer(index: number, lines: LayerLine[]): Promise<void> {
    if (lines.length === 0) return;
    const st = current();
    const { doc } = st;
    st.font ??= glyphlessFont(doc);
    const page = doc.loadPage(index);
    try {
      const pageObj = page.getObject();
      const fonts = pageFonts(doc, pageObj);
      let name = 'OcrText';
      for (let n = 1; !fonts.get(name).isNull(); n += 1) name = `OcrText${n}`;
      fonts.put(name, st.font);
      const [a, b, c, d, e, f] = page.getTransform();
      const ops = textLayerOps(lines, name, invertMatrix([a, b, c, d, e, f]));
      // Wrap the existing content in q/Q so its graphics state cannot leak into the layer.
      const arr = contentsArray(doc, pageObj);
      const out = doc.newArray();
      out.push(doc.addStream('q\n', {}));
      for (let i = 0; i < arr.length; i += 1) out.push(arr.get(i));
      out.push(doc.addStream(`\nQ\n${ops}`, {}));
      pageObj.put('Contents', out);
      st.layered += 1;
    } finally {
      page.destroy();
    }
  },

  /** Writes the document (a full rewrite; image streams are copied, not re-encoded) and closes it. */
  async save(): Promise<Blob> {
    const st = current();
    try {
      const bytes = bufferToBytes(st.doc.saveToBuffer(writeOptions({ garbage: 'compact' })));
      return new Blob([bytes], { type: 'application/pdf' });
    } finally {
      close();
    }
  },

  close(): void {
    close();
  },
};

export type OcrPdfWorkerApi = typeof api;

expose(api);
