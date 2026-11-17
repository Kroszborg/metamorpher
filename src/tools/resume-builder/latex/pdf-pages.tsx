'use client';

import { useEffect, useRef, useState } from 'react';
import { openPdfDocument } from '@/components/pdf-stage';

/**
 * Draws every page of a PDF (pdf.js) into canvases sized to the container.
 * The previous pages stay on screen until the new ones are drawn.
 */
export function PdfPages({ pdf, className }: { pdf: Blob | null; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!pdf || !el || width < 50) return;
    let cancelled = false;
    let opened: Awaited<ReturnType<typeof openPdfDocument>> | null = null;
    (async () => {
      try {
        opened = await openPdfDocument(pdf);
        if (cancelled) return;
        const { doc } = opened;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.style.width = '100%';
          canvas.className = 'block rounded-sm bg-white shadow-sm';
          canvas.setAttribute('aria-label', `Page ${i}`);
          await page.render({ canvas, viewport, background: '#ffffff' }).promise;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases);
        setPages(doc.numPages);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The PDF could not be shown.');
      } finally {
        void opened?.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, width]);

  return (
    <div className={className}>
      {error ? <p className="p-3 text-xs text-destructive">{error}</p> : null}
      <div ref={box} className="flex flex-col gap-3" data-pdf-pages={pages} />
    </div>
  );
}
