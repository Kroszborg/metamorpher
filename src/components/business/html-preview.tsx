'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shows a whole HTML document (no scripts) scaled to the width of its
 * container: a live preview of what the PDF engine will lay out.
 * `pageWidth` is the document's width in points.
 */
export function HtmlPreview({
  html,
  pageWidth,
  pageHeight,
  className,
  title = 'Preview',
  maxHeight,
  onMeasure,
}: {
  html: string;
  pageWidth: number;
  /** Draws page-break guides every page height (points). */
  pageHeight?: number;
  className?: string;
  title?: string;
  /** Cap the shown height (CSS px) and scroll inside. */
  maxHeight?: number;
  /** The document's full height in CSS pixels, after each load. */
  onMeasure?: (heightPx: number) => void;
}) {
  const deferred = useDeferredValue(html);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.5);
  const pagePx = pageHeight ? (pageHeight * 4) / 3 : 0;
  const [height, setHeight] = useState(pagePx || 800);
  const px = (pageWidth * 4) / 3;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1.25, el.clientWidth / px)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [px]);

  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    // The body's own box (padding = page margins), not the scroll height, which never shrinks below the frame.
    const h = Math.ceil(doc.body.getBoundingClientRect().height);
    onMeasure?.(h);
    setHeight(pagePx ? Math.max(pagePx, Math.ceil((h - 2) / pagePx) * pagePx) : h);
  };

  const shown = height * scale;
  const breaks = pagePx ? Math.max(0, Math.round(height / pagePx) - 1) : 0;
  return (
    <div
      ref={box}
      className={cn('w-full rounded-lg border bg-white shadow-sm', maxHeight ? 'overflow-y-auto' : 'overflow-hidden', className)}
      style={{ height: maxHeight ? Math.min(maxHeight, shown) : shown }}
    >
      <div className="relative overflow-hidden" style={{ height: shown }}>
        <iframe
          ref={frame}
          title={title}
          srcDoc={deferred}
          sandbox="allow-same-origin"
          onLoad={measure}
          className="absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{ width: px, height, transform: `scale(${scale})` }}
          tabIndex={-1}
        />
        {Array.from({ length: breaks }, (_, i) => (
          <div
            key={i}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-neutral-300"
            style={{ top: (i + 1) * pagePx * scale }}
          />
        ))}
      </div>
    </div>
  );
}
