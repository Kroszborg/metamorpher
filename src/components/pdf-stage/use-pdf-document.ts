'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';
import { type OpenedPdf, openPdfDocument } from './pdfjs';

export type PdfDocumentState = {
  doc: PDFDocumentProxy | null;
  pageCount: number;
  error: string | null;
  /** True while `file` is being opened. The previous document stays available meanwhile. */
  loading: boolean;
};

type Loaded = { file: Blob; opened: OpenedPdf | null; error: string | null };

/**
 * Opens `file` with pdf.js for rendering. While a new file opens, the previous
 * document is still returned (so a live preview does not flash); it is
 * destroyed once the new one is committed, and the last one on unmount.
 */
export function usePdfDocument(file: Blob | null): PdfDocumentState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    openPdfDocument(file).then(
      (opened) => {
        if (cancelled) void opened.destroy();
        else setLoaded({ file, opened, error: null });
      },
      (err: unknown) => {
        if (!cancelled) {
          setLoaded({ file, opened: null, error: err instanceof Error ? err.message : 'This PDF could not be opened.' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Destroy each document after the next one (or unmount) has been committed.
  useEffect(() => {
    const opened = loaded?.opened;
    return () => {
      void opened?.destroy();
    };
  }, [loaded]);

  if (!file) return { doc: null, pageCount: 0, error: null, loading: false };
  const fresh = loaded?.file === file;
  const doc = loaded?.opened?.doc ?? null;
  return {
    doc,
    pageCount: doc?.numPages ?? 0,
    error: fresh ? (loaded?.error ?? null) : null,
    loading: !fresh,
  };
}
