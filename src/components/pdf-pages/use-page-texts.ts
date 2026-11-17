'use client';

import { useEffect, useState } from 'react';
import { isAbortError } from '@/engines';
import type { PdfPreview } from '@/engines/pdf';

const caches = new WeakMap<PdfPreview, string[]>();

export type PageTexts = {
  /** Text of each page read so far (index = page). */
  texts: readonly string[];
  /** Pages read so far; equals `total` when finished. */
  done: number;
  total: number;
  error: string | null;
};

/**
 * Reads the text of every page of an open document, one page at a time in the
 * background (pdf.js parses in its worker), so a long PDF does not block the
 * tab. Results are cached per document, so remounting or retyping is instant.
 */
export function usePageTexts(preview: PdfPreview | null): PageTexts {
  const total = preview?.numPages ?? 0;
  const [state, setState] = useState<{ preview: PdfPreview | null; done: number; error: string | null }>({
    preview: null,
    done: 0,
    error: null,
  });

  useEffect(() => {
    if (!preview) return;
    const controller = new AbortController();
    let cache = caches.get(preview);
    if (!cache) {
      cache = [];
      caches.set(preview, cache);
    }
    const texts = cache;
    const total = preview.numPages;
    // A few requests in flight keep pdf.js's worker busy without flooding it.
    const prefix = () => {
      let n = 0;
      while (n < total && texts[n] !== undefined) n += 1;
      return n;
    };
    let next = prefix();
    let ready = next; // pages 0..ready-1 are all read
    let last = 0;
    const worker = async () => {
      while (next < total) {
        const i = next;
        next += 1;
        if (texts[i] !== undefined) continue;
        texts[i] = await preview.pageText(i, controller.signal);
        while (ready < total && texts[ready] !== undefined) ready += 1;
        // Re-render at most every ~250 ms while reading.
        const now = performance.now();
        if (now - last > 250) {
          last = now;
          setState({ preview, done: ready, error: null });
        }
      }
    };
    Promise.all(Array.from({ length: 4 }, worker)).then(
      () => setState({ preview, done: total, error: null }),
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState({ preview, done: ready, error: err instanceof Error ? err.message : 'The text could not be read.' });
      },
    );
    return () => controller.abort();
  }, [preview]);

  const texts = preview ? (caches.get(preview) ?? []) : [];
  let cached = 0;
  while (cached < total && texts[cached] !== undefined) cached += 1;
  const done = state.preview === preview ? Math.max(state.done, cached) : cached;
  return { texts, done: Math.min(done, total), total, error: state.preview === preview ? state.error : null };
}

/** Lower-cases (unless `matchCase`) and collapses whitespace, for forgiving phrase search. */
export function normalizeText(text: string, matchCase: boolean): string {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return matchCase ? t : t.toLocaleLowerCase();
}

/**
 * Whether `text` contains `phrase`. Spacing is ignored as a fallback because
 * PDFs often store words in pieces ("INV" "OICE") or with letter spacing.
 */
export function containsPhrase(text: string, phrase: string, matchCase: boolean): boolean {
  const p = normalizeText(phrase, matchCase);
  if (p === '') return false;
  const t = normalizeText(text, matchCase);
  if (t.includes(p)) return true;
  return t.replace(/ /g, '').includes(p.replace(/ /g, ''));
}
