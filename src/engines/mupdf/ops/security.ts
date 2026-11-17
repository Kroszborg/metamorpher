// Document information and decryption with MuPDF.
import type { PdfInfo } from '../types';
import { type Doc, type Mupdf, bufferToBytes, encryptionInfo, openPdf, passwordError, writeOptions } from './common';

const META_KEYS = ['format', 'encryption', 'info:Title', 'info:Author', 'info:Subject', 'info:Keywords', 'info:Creator', 'info:Producer', 'info:CreationDate', 'info:ModDate'];

export function docInfo(doc: Doc, needsPassword: boolean): PdfInfo {
  const metadata: Record<string, string> = {};
  for (const key of META_KEYS) {
    const v = doc.getMetaData(key);
    if (v) metadata[key.replace(/^info:/, '')] = v;
  }
  return {
    pageCount: doc.countPages(),
    version: (metadata.format ?? '').replace(/^PDF\s*/i, ''),
    encryption: encryptionInfo(doc, needsPassword),
    metadata,
    repaired: doc.wasRepaired(),
  };
}

/**
 * Opens far enough to report encryption without a password. Other details
 * (page count, metadata) are only filled in once the file is readable.
 */
export function inspect(m: Mupdf, bytes: Uint8Array, password?: string): PdfInfo {
  try {
    const doc = openPdf(m, bytes, password);
    try {
      return docInfo(doc, false);
    } finally {
      doc.destroy();
    }
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'PasswordRequiredError') throw err;
    const doc = m.Document.openDocument(bytes, 'application/pdf').asPDF();
    if (!doc) throw err;
    try {
      return {
        pageCount: 0,
        version: '',
        encryption: encryptionInfo(doc, true),
        metadata: {},
        repaired: doc.wasRepaired(),
      };
    } finally {
      doc.destroy();
    }
  }
}

export function isEncrypted(m: Mupdf, bytes: Uint8Array): boolean {
  const doc = m.Document.openDocument(bytes, 'application/pdf').asPDF();
  if (!doc) return false;
  try {
    return doc.needsPassword() || doc.getTrailer().get('Encrypt').isDictionary();
  } finally {
    doc.destroy();
  }
}

/**
 * Writes an unencrypted copy. `password` may be the open or the owner
 * password; a file with only permission restrictions needs none.
 */
export function decrypt(m: Mupdf, bytes: Uint8Array, password = ''): Uint8Array<ArrayBuffer> {
  const doc = openPdf(m, bytes, password || undefined);
  try {
    if (doc.needsPassword() && password === '') throw passwordError('needed');
    return bufferToBytes(doc.saveToBuffer(writeOptions({ encrypt: 'no' })));
  } finally {
    doc.destroy();
  }
}
