/**
 * Text extraction for the document AI tools: PDFs page by page (MuPDF), and
 * TXT / Markdown / DOCX split into sections. Runs entirely on this device.
 */
import { isPasswordError, mupdfEngine } from '@/engines/mupdf';
import { extensionOf } from '@/lib/files';
import { type SourceDoc, sectionText } from './rag';

export const DOC_ACCEPT = [
  '.pdf',
  'application/pdf',
  '.txt',
  'text/plain',
  '.md',
  '.markdown',
  'text/markdown',
  '.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type LoadedDoc = SourceDoc & {
  file: File;
  kind: 'pdf' | 'text';
  chars: number;
  /** PDF pages without any text (scanned images). */
  emptyPages: number;
};

export class DocumentError extends Error {
  readonly scanned: boolean;
  constructor(message: string, scanned = false) {
    super(message);
    this.name = 'DocumentError';
    this.scanned = scanned;
  }
}

/** Reads one document into per-page text. Rejects with a DocumentError people can act on. */
export async function loadDocument(
  file: File,
  id: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<LoadedDoc> {
  const ext = extensionOf(file.name).toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') {
    let pages: string[];
    try {
      pages = await mupdfEngine.extractText(file, 'plain', {
        signal,
        onProgress: (done, total) => onProgress?.(done / Math.max(1, total)),
      });
    } catch (err) {
      if (isPasswordError(err)) {
        throw new DocumentError(`${file.name} is password-protected. Unlock it first with the Unlock PDF tool.`);
      }
      throw err;
    }
    const emptyPages = pages.filter((p) => p.trim().length < 20).length;
    const chars = pages.reduce((n, p) => n + p.trim().length, 0);
    if (chars < 40 * Math.max(1, pages.length) && emptyPages >= pages.length * 0.8) {
      throw new DocumentError(
        `${file.name} has no readable text: its pages are probably scanned images. Run it through OCR / searchable PDF first, then add the result here.`,
        true,
      );
    }
    return { id, name: file.name, unit: 'page', pages, file, kind: 'pdf', chars, emptyPages };
  }

  let text: string;
  if (ext === 'docx') {
    const { docxToHtml } = await import('@/components/doc-tools/docx');
    const { html } = await docxToHtml(await file.arrayBuffer());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const el of doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, tr, br')) el.append('\n\n');
    text = doc.body.textContent ?? '';
  } else {
    const { decodeText } = await import('@/components/doc-tools/text');
    text = (await decodeText(file)).text;
  }
  onProgress?.(1);
  const pages = sectionText(text);
  const chars = text.trim().length;
  if (chars === 0) throw new DocumentError(`${file.name} contains no text.`);
  return { id, name: file.name, unit: 'section', pages, file, kind: 'text', chars, emptyPages: 0 };
}
