'use client';

import { ArrowLeft01Icon, ArrowRight01Icon, Loading03Icon, ZoomInIcon, ZoomOutIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { RenderTask } from 'pdfjs-dist';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  applyMatrix,
  normalizeBox,
  type PageFrame,
  pageFrame,
  userToView,
  viewToUser,
} from '@/engines/pdf-stamp/geometry';
import { cn } from '@/lib/utils';
import { usePdfDocument } from './use-pdf-document';

/** What an overlay needs to know about the displayed page. */
export type StageView = {
  /** Page index (0-based) in the stage's navigation. */
  pageIndex: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /** Displayed page size, CSS pixels. */
  width: number;
  height: number;
  /** Visible box, /Rotate and reader-frame size of the page. */
  frame: PageFrame;
  /** PDF user space → CSS pixels from the page's top-left. */
  toView: (x: number, y: number) => [number, number];
  /** CSS pixels from the page's top-left → PDF user space. */
  toUser: (px: number, py: number) => [number, number];
};

export type PdfStageProps = {
  /** The document to draw. */
  file: Blob | null;
  /** Current page in the navigation, 0-based. */
  page: number;
  onPageChange?: (page: number) => void;
  /** Navigation length when `file` is a one-page preview of a longer document. Defaults to `file`'s page count. */
  pageCount?: number;
  /** Page of `file` to draw. Defaults to `page`. */
  renderPage?: number;
  /** 'hide' leaves form-field widgets out of the drawing (for HTML inputs drawn on top). */
  formFields?: 'draw' | 'hide';
  /** Overlay layer above the page, positioned in CSS pixels (use `view.toView`). */
  overlay?: (view: StageView) => ReactNode;
  /** Pointer down on the page itself (not on an overlay item), in user space. */
  onPagePointerDown?: (point: [number, number], view: StageView) => void;
  /** Extra controls at the right of the toolbar. */
  toolbar?: ReactNode;
  /** Shown instead of the page when there is nothing to draw yet. */
  placeholder?: ReactNode;
  /** Shown over the page while the caller prepares a new `file` (live previews). */
  busy?: boolean;
  /** Error from the caller (for example a failed preview); replaces the page. */
  error?: string | null;
  onDocument?: (info: { pageCount: number }) => void;
  /** Called after each change of the displayed page's geometry or zoom (for tools that place items). */
  onViewChange?: (view: StageView | null) => void;
  className?: string;
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const docIds = new WeakMap<object, number>();
let nextDocId = 1;
/** A stable number per pdf.js document object (for render bookkeeping). */
function docId(doc: object): number {
  let id = docIds.get(doc);
  if (id === undefined) {
    id = nextDocId++;
    docIds.set(doc, id);
  }
  return id;
}
const PAD = 16;

/**
 * A single-page PDF view with page navigation and zoom, rendered with pdf.js.
 * Overlays get a `StageView` that converts between PDF user space and screen
 * pixels, accounting for /Rotate and crop boxes with non-zero origins.
 */
export function PdfStage({
  file,
  page,
  onPageChange,
  pageCount,
  renderPage,
  formFields = 'draw',
  overlay,
  onPagePointerDown,
  toolbar,
  placeholder,
  busy,
  error,
  onDocument,
  onViewChange,
  className,
}: PdfStageProps) {
  const { doc, pageCount: docPages, error: docError, loading } = usePdfDocument(file);
  const total = pageCount ?? docPages;
  const drawIndex = renderPage ?? page;

  const viewport = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  // Which render request finished last, and how.
  const [rendered, setRendered] = useState<{ key: string; error: string | null } | null>(null);

  const onDocumentRef = useRef(onDocument);
  useEffect(() => {
    onDocumentRef.current = onDocument;
  });
  useEffect(() => {
    if (doc) onDocumentRef.current?.({ pageCount: doc.numPages });
  }, [doc]);

  // Track the available area for "fit".
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Page geometry (cheap) before the render (slower). The last frame stays while the next one loads.
  const [frameState, setFrameState] = useState<{ frame: PageFrame | null; error: string | null; key: string } | null>(
    null,
  );
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const index = Math.min(Math.max(0, drawIndex), doc.numPages - 1);
    const key = `${docId(doc)}:${index}`;
    doc.getPage(index + 1).then(
      (p) => {
        if (cancelled) return;
        const [x1, y1, x2, y2] = p.view as [number, number, number, number];
        setFrameState({ frame: pageFrame(normalizeBox(x1, y1, x2, y2), p.rotate), error: null, key });
      },
      () => {
        if (!cancelled) setFrameState((f) => ({ frame: f?.frame ?? null, error: 'This page could not be read.', key }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc, drawIndex]);
  const frame = doc ? (frameState?.frame ?? null) : null;

  const fitScale = frame
    ? Math.max(0.1, Math.min((box.width - PAD * 2) / frame.width, (box.height - PAD * 2) / frame.height))
    : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;

  // Render into a fresh canvas and swap it in when done, so the old page stays up meanwhile.
  const renderKey = doc && frame ? `${docId(doc)}:${drawIndex}:${scale}:${formFields}:${box.width}` : '';
  useEffect(() => {
    if (!doc || !frame || !holder.current || box.width === 0) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    const canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const p = await doc.getPage(Math.min(Math.max(0, drawIndex), doc.numPages - 1) + 1);
      if (cancelled) return;
      const vp = p.getViewport({ scale: scale * dpr });
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      canvas.style.width = `${frame.width * scale}px`;
      canvas.style.height = `${frame.height * scale}px`;
      canvas.style.display = 'block';
      task = p.render({
        canvas,
        viewport: vp,
        background: '#ffffff',
        annotationMode: formFields === 'hide' ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE,
      });
      await task.promise;
      if (cancelled || !holder.current) return;
      holder.current.replaceChildren(canvas);
      setRendered({ key: renderKey, error: null });
    })().catch((err: unknown) => {
      if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return;
      setRendered({ key: renderKey, error: 'This page could not be drawn.' });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, frame, drawIndex, scale, formFields, box.width, renderKey]);
  const rendering = renderKey !== '' && rendered?.key !== renderKey;
  const renderError =
    (frameState?.error ?? null) || (rendered && rendered.key === renderKey ? rendered.error : null);

  // Clear the old drawing when the document goes away.
  useEffect(() => {
    if (!file) holder.current?.replaceChildren();
  }, [file]);

  const view = useMemo<StageView | null>(() => {
    if (!frame) return null;
    const toViewM = userToView(frame, scale);
    const toUserM = viewToUser(frame, scale);
    return {
      pageIndex: page,
      scale,
      width: frame.width * scale,
      height: frame.height * scale,
      frame,
      toView: (x, y) => applyMatrix(toViewM, x, y),
      toUser: (px, py) => applyMatrix(toUserM, px, py),
    };
  }, [frame, scale, page]);

  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  });
  useEffect(() => {
    onViewChangeRef.current?.(view);
  }, [view]);

  const shownError = error ?? docError ?? renderError;
  const zoomIndex = ZOOMS.findIndex((z) => z >= scale - 0.001);
  const zoomOut = () => setZoom(ZOOMS.filter((z) => z < scale - 0.001).at(-1) ?? ZOOMS[0]!);
  const zoomIn = () => setZoom(ZOOMS.find((z) => z > scale + 0.001) ?? ZOOMS.at(-1)!);

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/40', className)}>
      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={!onPageChange || page <= 0}
          onClick={() => onPageChange?.(page - 1)}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <span className="min-w-[5.5rem] text-center font-mono text-xs tabular-nums" aria-live="polite">
          {total > 0 ? `${page + 1} / ${total}` : '–'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={!onPageChange || page >= total - 1}
          onClick={() => onPageChange?.(page + 1)}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!frame || zoomIndex === 0} onClick={zoomOut}>
          <HugeiconsIcon icon={ZoomOutIcon} strokeWidth={2} />
        </Button>
        <button
          type="button"
          onClick={() => setZoom('fit')}
          className={cn(
            'rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums hover:bg-muted',
            zoom === 'fit' && 'text-muted-foreground',
          )}
          title="Fit page"
        >
          {Math.round(scale * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          disabled={!frame || scale >= ZOOMS.at(-1)! - 0.001}
          onClick={zoomIn}
        >
          <HugeiconsIcon icon={ZoomInIcon} strokeWidth={2} />
        </Button>
        {busy || loading || rendering ? (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="ml-1 size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        {toolbar ? <div className="ml-auto flex items-center gap-1">{toolbar}</div> : null}
      </div>
      <div ref={viewport} className="relative h-[min(72vh,52rem)] min-h-80 overflow-auto">
        {shownError ? (
          <div className="absolute inset-0 grid place-items-center p-6">
            <p role="alert" className="max-w-sm text-center text-xs/relaxed text-destructive">
              {shownError}
            </p>
          </div>
        ) : !file ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-muted-foreground">
            {placeholder ?? 'Add a PDF to see it here.'}
          </div>
        ) : null}
        <div
          className={cn('flex min-h-full min-w-full items-center justify-center', shownError && 'invisible')}
          style={{ padding: PAD, width: view ? view.width + PAD * 2 : undefined }}
        >
          <div
            className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/10"
            style={view ? { width: view.width, height: view.height } : { width: 0, height: 0 }}
            data-pdf-stage-page=""
          >
            <div ref={holder} aria-hidden="true" />
            {view ? (
              <div
                className="absolute inset-0"
                data-pdf-stage-overlay=""
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget || !onPagePointerDown) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  onPagePointerDown(view.toUser(e.clientX - r.left, e.clientY - r.top), view);
                }}
              >
                {overlay?.(view)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
