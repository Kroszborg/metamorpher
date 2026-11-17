// Helpers shared by the MuPDF operations. Operations take the loaded MuPDF
// module as their first argument so they can run in the worker and in tests.
import type * as M from 'mupdf';
import type { Box, EncryptionInfo, PermissionSet } from '../types';

export type Mupdf = typeof M;
export type Doc = M.PDFDocument;
export type Obj = M.PDFObject;

/** Thrown when a password is missing or wrong. `name` survives the worker boundary. */
export function passwordError(kind: 'needed' | 'wrong'): Error {
  const err = new Error(
    kind === 'needed'
      ? 'This PDF is password-protected. Enter its password to continue.'
      : 'That password is not correct for this PDF.',
  );
  err.name = kind === 'needed' ? 'PasswordRequiredError' : 'WrongPasswordError';
  return err;
}

export function openPdf(m: Mupdf, bytes: Uint8Array, password?: string): Doc {
  let doc: M.Document;
  try {
    doc = m.Document.openDocument(bytes, 'application/pdf');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`This file could not be read as a PDF (${detail}).`);
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new Error('This file is not a PDF.');
  }
  if (pdf.needsPassword()) {
    if (!password) {
      pdf.destroy();
      throw passwordError('needed');
    }
    if (pdf.authenticatePassword(password) === 0) {
      pdf.destroy();
      throw passwordError('wrong');
    }
  }
  return pdf;
}

/** Copies a MuPDF buffer out of wasm memory into a Blob and frees it. */
export function bufferToBlob(buf: M.Buffer, type = 'application/pdf'): Blob {
  const bytes = buf.asUint8Array().slice();
  buf.destroy();
  return new Blob([bytes], { type });
}

export function bufferToBytes(buf: M.Buffer): Uint8Array<ArrayBuffer> {
  const bytes = buf.asUint8Array().slice();
  buf.destroy();
  return bytes;
}

export function nameOf(obj: Obj): string | null {
  return obj.isName() ? obj.asName() : null;
}

/** The filter names of a stream dictionary, in order. */
export function filtersOf(dict: Obj): string[] {
  const f = dict.get('Filter');
  if (f.isName()) return [f.asName()];
  if (f.isArray()) {
    const out: string[] = [];
    for (let i = 0; i < f.length; i += 1) {
      const n = f.get(i);
      if (n.isName()) out.push(n.asName());
    }
    return out;
  }
  return [];
}

/** Every indirect object number whose object is an image XObject stream. */
export function imageObjects(doc: Doc): number[] {
  const out: number[] = [];
  const n = doc.countObjects();
  for (let num = 1; num < n; num += 1) {
    try {
      const ref = doc.newIndirect(num);
      if (ref.isStream() && nameOf(ref.get('Subtype')) === 'Image') out.push(num);
    } catch {
      // A broken object: skip it.
    }
  }
  return out;
}

/**
 * Stored (still encoded) length of a stream object in bytes, read from
 * /Length when it is a plain number, else measured.
 */
export function storedLength(ref: Obj): number {
  const len = ref.get('Length');
  if (len.isNumber()) return len.asNumber();
  try {
    const raw = ref.readRawStream();
    const n = raw.getLength();
    raw.destroy();
    return n;
  } catch {
    return 0;
  }
}

/** Visits the XObjects (images and forms, recursively) reachable from a resource dictionary. */
export function walkXObjects(resources: Obj, visit: (num: number, ref: Obj, subtype: string) => void, seen = new Set<number>()): void {
  if (!resources.isDictionary()) return;
  const xobjects = resources.get('XObject');
  if (!xobjects.isDictionary()) return;
  xobjects.forEach((ref) => {
    if (!ref.isIndirect()) return;
    const num = ref.asIndirect();
    if (seen.has(num)) return;
    seen.add(num);
    const subtype = nameOf(ref.get('Subtype')) ?? '';
    visit(num, ref, subtype);
    if (subtype === 'Form') walkXObjects(ref.get('Resources'), visit, seen);
  });
}

export function pageResources(page: M.PDFPage): Obj {
  return page.getObject().getInheritable('Resources');
}

export function bounds(page: M.Page): Box {
  const [x0, y0, x1, y1] = page.getBounds();
  return [x0, y0, x1, y1];
}

export const ALL_PERMISSIONS: PermissionSet = {
  print: true,
  printHighQuality: true,
  copy: true,
  edit: true,
  annotate: true,
  fillForms: true,
  accessibility: true,
  assemble: true,
};

/** PDF permission bits (ISO 32000 table 22), as a signed 32-bit /P value. */
export function permissionBits(p: PermissionSet): number {
  let bits = 0xfffff0c0; // reserved bits 7, 8 and 13–32 must be 1
  if (p.print) bits |= 1 << 2;
  if (p.edit) bits |= 1 << 3;
  if (p.copy) bits |= 1 << 4;
  if (p.annotate) bits |= 1 << 5;
  if (p.fillForms) bits |= 1 << 8;
  if (p.accessibility) bits |= 1 << 9;
  if (p.assemble) bits |= 1 << 10;
  if (p.printHighQuality) bits |= 1 << 11;
  return bits | 0;
}

export function permissionsFromBits(p: number): PermissionSet {
  const has = (bit: number) => (p & (1 << (bit - 1))) !== 0;
  return {
    print: has(3),
    edit: has(4),
    copy: has(5),
    annotate: has(6),
    fillForms: has(9),
    accessibility: has(10),
    assemble: has(11),
    printHighQuality: has(3) && has(12),
  };
}

/** Reads /Encrypt from the trailer of an opened document. */
export function encryptionInfo(doc: Doc, needsPassword: boolean): EncryptionInfo {
  const enc = doc.getTrailer().get('Encrypt');
  if (!enc.isDictionary()) {
    return { encrypted: false, needsPassword: false, method: null, permissions: { ...ALL_PERMISSIONS } };
  }
  const v = enc.get('V').isNumber() ? enc.get('V').asNumber() : 0;
  const r = enc.get('R').isNumber() ? enc.get('R').asNumber() : 0;
  const lengthObj = enc.get('Length');
  const length = lengthObj.isNumber() ? lengthObj.asNumber() : 40;
  let method = `RC4-${length}`;
  if (v >= 4) {
    const cfm = nameOf(enc.get('CF', 'StdCF', 'CFM'));
    if (cfm === 'AESV3' || r >= 5) method = 'AES-256';
    else if (cfm === 'AESV2') method = 'AES-128';
    else if (cfm === 'V2') method = 'RC4-128';
  }
  const p = enc.get('P');
  return {
    encrypted: true,
    needsPassword,
    method,
    permissions: p.isNumber() ? permissionsFromBits(p.asNumber()) : { ...ALL_PERMISSIONS },
  };
}

/** Write options for a full rewrite (no incremental update, unused objects dropped). */
export function writeOptions(extra: Record<string, string | boolean | number | undefined> = {}): string {
  const opts: Record<string, string | boolean | number | undefined> = {
    garbage: 'compact',
    compress: 'yes',
    ...extra,
  };
  return Object.entries(opts)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}=${String(v)}`))
    .join(',');
}

/** Removes document metadata: the Info dictionary, XMP, page thumbnails and private app data. */
export function stripMetadata(doc: Doc): void {
  const trailer = doc.getTrailer();
  trailer.delete('Info');
  const root = trailer.get('Root');
  if (root.isDictionary()) {
    root.delete('Metadata');
    root.delete('PieceInfo');
  }
  const pages = doc.countPages();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.findPage(i);
    page.delete('Thumb');
    page.delete('PieceInfo');
    page.delete('Metadata');
  }
  // XMP streams attached to images, forms and fonts.
  const n = doc.countObjects();
  for (let num = 1; num < n; num += 1) {
    try {
      const obj = doc.newIndirect(num);
      if (obj.isDictionary() && obj.get('Metadata').isIndirect()) obj.delete('Metadata');
    } catch {
      // ignore broken objects
    }
  }
}

export function rectsIntersect(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

export function quadBox(q: readonly number[]): Box {
  const xs = [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0];
  const ys = [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function boxContainsPoint(b: Box, x: number, y: number): boolean {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}
