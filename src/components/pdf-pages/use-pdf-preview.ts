'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { engines, isAbortError } from '@/engines';
import type { OutlineEntry, PdfPreview } from '@/engines/pdf';
import { releaseThumbnails } from './thumbnails';

export type PdfPreviewState =
  | { status: 'loading'; preview: null; pageCount: 0; outline: []; error: null }
  | { status: 'ready'; preview: PdfPreview; pageCount: number; outline: OutlineEntry[]; error: null }
  | { status: 'error'; preview: null; pageCount: 0; outline: []; error: string };

const LOADING: PdfPreviewState = { status: 'loading', preview: null, pageCount: 0, outline: [], error: null };

type Item = { id: string; file: File };

/**
 * Opens each PDF for thumbnails (pdf.js) and checks it with pdf-lib, keyed by
 * the item's id. Documents are opened once, closed when their item leaves the
 * list or the component unmounts. Encrypted or damaged files end in
 * `status: 'error'` with a readable message.
 */
export function usePdfPreviews(items: readonly Item[]): Record<string, PdfPreviewState> {
  const [states, setStates] = useState<Record<string, PdfPreviewState>>({});
  const live = useRef(new Map<string, { file: File; controller: AbortController; preview?: PdfPreview }>());

  useEffect(() => {
    const map = live.current;
    const wanted = new Map(items.map((i) => [i.id, i.file]));
    for (const [id, entry] of map) {
      if (wanted.get(id) === entry.file) continue;
      entry.controller.abort();
      if (entry.preview) {
        releaseThumbnails(entry.preview);
        entry.preview.close();
      }
      map.delete(id);
    }
    for (const { id, file } of items) {
      if (map.has(id)) continue;
      const controller = new AbortController();
      const entry: { file: File; controller: AbortController; preview?: PdfPreview } = { file, controller };
      map.set(id, entry);
      const { signal } = controller;
      // The pdf-lib check runs without the signal: aborting it would stop the
      // shared worker for every other file too. Its result is simply ignored.
      const opened = engines.pdf.open(file, { signal, name: file.name });
      const checked = engines.pdf.pages.inspect({ name: file.name, blob: file });
      Promise.all([opened, checked]).then(
        ([preview, info]) => {
          if (signal.aborted) {
            preview.close();
            return;
          }
          entry.preview = preview;
          setStates((prev) => ({
            ...prev,
            [id]: { status: 'ready', preview, pageCount: info.pageCount, outline: info.outline, error: null },
          }));
        },
        (err: unknown) => {
          void opened.then((p) => p.close(), () => undefined);
          if (signal.aborted || isAbortError(err)) return;
          const error = err instanceof Error ? err.message : 'This PDF could not be read.';
          setStates((prev) => ({ ...prev, [id]: { status: 'error', preview: null, pageCount: 0, outline: [], error } }));
        },
      );
    }
  }, [items]);

  useEffect(() => {
    const map = live.current;
    return () => {
      for (const entry of map.values()) {
        entry.controller.abort();
        if (entry.preview) {
          releaseThumbnails(entry.preview);
          entry.preview.close();
        }
      }
      map.clear();
    };
  }, []);

  return useMemo(() => {
    const out: Record<string, PdfPreviewState> = {};
    // Ids are unique per added file, so a state never outlives its document.
    for (const { id } of items) out[id] = states[id] ?? LOADING;
    return out;
  }, [items, states]);
}

/** `usePdfPreviews` for a single file (or none). */
export function usePdfPreview(item: Item | undefined): PdfPreviewState {
  const items = useMemo(() => (item ? [item] : []), [item]);
  const states = usePdfPreviews(items);
  return (item && states[item.id]) || LOADING;
}
