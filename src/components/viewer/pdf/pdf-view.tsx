'use client';

import 'pdfjs-dist/web/pdf_viewer.css';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  BookOpen01Icon,
  GridViewIcon,
  Presentation01Icon,
  RotateClockwiseIcon,
  Search01Icon,
  SquareLock02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { loadPdfJs } from '@/components/pdf-stage/pdfjs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, PanelTitle, Toolbar, ToolbarSep, ViewerLoading, ViewerProblem } from '../bits';
import { type Shortcut, useKeys, useShortcuts } from '../context';

export const PDF_SHORTCUTS: Shortcut[] = [
  { keys: 'Ctrl + F', label: 'Search the text' },
  { keys: 'Enter  Shift + Enter', label: 'Next or previous match (in the search box)' },
  { keys: '+  −', label: 'Zoom in or out' },
  { keys: '0', label: 'Fit the page width' },
  { keys: 'Home  End', label: 'First or last page' },
  { keys: 'R', label: 'Rotate the view' },
  { keys: 'P', label: 'Presentation mode' },
  { keys: '←  →  Space', label: 'Previous or next page (presentation)' },
];

type OutlineItem = { title: string; dest: unknown; items: OutlineItem[] };
type Viewer = { viewer: PDFViewer; bus: EventBus; links: PDFLinkService; find: PDFFindController };
type Sidebar = 'thumbs' | 'outline' | null;

const asset = (path: string) => new URL(`/vendor/pdfjs/${path}`, window.location.origin).href;

/** Renders page thumbnails one at a time, only for those near the view. */
function Thumb({ doc, n, active, onPick }: { doc: PDFDocumentProxy; n: number; active: boolean; onPick: (n: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let url: string | null = null;
    const io = new IntersectionObserver(
      async ([e]) => {
        if (!e?.isIntersecting || url) return;
        io.disconnect();
        try {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          const scale = 220 / vp.width;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport, background: '#ffffff' }).promise;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
          canvas.width = 0;
          if (blob && !cancelled) {
            url = URL.createObjectURL(blob);
            setSrc(url);
          }
        } catch {
          // A page that fails to render keeps its placeholder.
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, n]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPick(n)}
      aria-label={`Page ${n}`}
      aria-current={active ? 'page' : undefined}
      className="group flex flex-col items-center gap-1 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span
        className={cn(
          'block w-full overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-border transition-shadow',
          active ? 'ring-2 ring-primary' : 'group-hover:ring-input',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: thumbnail */}
        {src ? <img src={src} alt="" className="block w-full" /> : <span className="block aspect-[3/4] w-full animate-pulse bg-muted" />}
      </span>
      <span className={cn('text-[0.68rem] tabular-nums', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>{n}</span>
    </button>
  );
}

function OutlineTree({ items, onGo, depth = 0 }: { items: OutlineItem[]; onGo: (dest: unknown) => void; depth?: number }) {
  return (
    <ul>
      {items.map((it, i) => (
        <li key={`${depth}-${i}-${it.title}`}>
          <button
            type="button"
            onClick={() => onGo(it.dest)}
            className="block w-full truncate rounded py-1 pr-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
            style={{ paddingLeft: 8 + depth * 12 }}
            title={it.title}
          >
            {it.title}
          </button>
          {it.items.length ? <OutlineTree items={it.items} onGo={onGo} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * A full PDF reader on pdf.js: continuous pages with selectable text,
 * thumbnails, outline, search with highlights, zoom and fit, rotation, page
 * jump, presentation mode, and a password prompt for protected files.
 */
export function PdfView({
  file,
  label,
  pageColors,
  defaultSidebar = 'thumbs',
  toolbarExtra,
  footerExtra,
  onLoaded,
}: {
  file: Blob;
  label: string;
  /** Recolour pages (e-book themes): pdf.js high-contrast colours. */
  pageColors?: { background: string; foreground: string } | null;
  defaultSidebar?: Sidebar;
  toolbarExtra?: ReactNode;
  footerExtra?: ReactNode;
  onLoaded?: (doc: PDFDocumentProxy) => void;
}) {
  useShortcuts(PDF_SHORTCUTS);
  const wrap = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const v = useRef<Viewer | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<{ retry: boolean; submit: (pw: string) => void } | null>(null);
  const [pw, setPw] = useState('');
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1);
  const [sidebar, setSidebar] = useState<Sidebar>(defaultSidebar);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ current: number; total: number } | null>(null);
  const [presenting, setPresenting] = useState(false);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  }, [onLoaded]);

  // Small screens start without the sidebar.
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) queueMicrotask(() => setSidebar(null));
  }, []);

  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let live = true;
    (async () => {
      const pdfjs = await loadPdfJs();
      (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = pdfjs;
      const { EventBus, PDFLinkService, PDFFindController, PDFViewer, LinkTarget } = await import('pdfjs-dist/web/pdf_viewer.mjs');
      const data = new Uint8Array(await file.arrayBuffer());
      task = pdfjs.getDocument({
        data,
        standardFontDataUrl: asset('standard_fonts/'),
        cMapUrl: asset('cmaps/'),
        wasmUrl: asset('wasm/'),
        iccUrl: asset('iccs/'),
      });
      task.onPassword = (update: (pw: string) => void, reason: number) => {
        if (live) setPassword({ retry: reason === 2, submit: update });
      };
      const d = await task.promise;
      if (!live) return;
      setPassword(null);
      const el = container.current;
      const innerEl = inner.current;
      if (!el || !innerEl) return;
      const bus = new EventBus();
      const links = new PDFLinkService({ eventBus: bus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
      const find = new PDFFindController({ eventBus: bus, linkService: links });
      const viewer = new PDFViewer({
        container: el,
        viewer: innerEl,
        eventBus: bus,
        linkService: links,
        findController: find,
        textLayerMode: 1,
        annotationMode: 2,
        removePageBorders: false,
        pageColors: pageColors ?? undefined,
        enableAutoLinking: true,
      });
      links.setViewer(viewer);
      bus.on('pagesinit', () => {
        viewer.currentScaleValue = el.clientWidth < 700 ? 'page-width' : 'auto';
      });
      bus.on('pagechanging', (e: { pageNumber: number }) => {
        setPage(e.pageNumber);
        setPageInput(String(e.pageNumber));
      });
      bus.on('scalechanging', (e: { scale: number }) => setScale(e.scale));
      bus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => setFound(e.matchesCount));
      bus.on('updatefindcontrolstate', (e: { matchesCount?: { current: number; total: number }; state: number }) => {
        if (e.matchesCount) setFound(e.matchesCount);
      });
      viewer.setDocument(d);
      links.setDocument(d);
      v.current = { viewer, bus, links, find };
      setDoc(d);
      loaded.current?.(d);
      d.getOutline().then(
        (o) => live && setOutline((o as OutlineItem[] | null) ?? []),
        () => live && setOutline([]),
      );
    })().catch((err: unknown) => {
      if (!live) return;
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'InvalidPDFException'
          ? 'This file is not a valid PDF, or it is damaged beyond what the reader can recover.'
          : err instanceof Error
            ? err.message
            : 'This PDF could not be opened.',
      );
    });
    return () => {
      live = false;
      const cur = v.current;
      v.current = null;
      cur?.viewer.setDocument(null as unknown as PDFDocumentProxy);
      void task?.destroy();
    };
    // pageColors is applied on open; a theme change re-opens through the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const goTo = useCallback((n: number) => {
    const cur = v.current;
    if (!cur || !doc) return;
    cur.viewer.currentPageNumber = Math.max(1, Math.min(doc.numPages, n));
  }, [doc]);

  const zoom = useCallback((factor: number | string) => {
    const cur = v.current;
    if (!cur) return;
    if (typeof factor === 'string') cur.viewer.currentScaleValue = factor;
    else cur.viewer.currentScale = Math.max(0.1, Math.min(10, cur.viewer.currentScale * factor));
  }, []);

  const rotate = useCallback(() => {
    const cur = v.current;
    if (cur) cur.viewer.pagesRotation = (cur.viewer.pagesRotation + 90) % 360;
  }, []);

  const runFind = useCallback((again: boolean, previous = false) => {
    const cur = v.current;
    if (!cur) return;
    cur.bus.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }, [query]);

  useEffect(() => {
    if (!doc) return;
    if (!query) {
      v.current?.bus.dispatch('find', { source: null, type: '', query: '', highlightAll: true });
      queueMicrotask(() => setFound(null));
      return;
    }
    const t = setTimeout(() => runFind(false), 250);
    return () => clearTimeout(t);
  }, [query, doc, runFind]);

  // Presentation: fullscreen, one page at a time, fit to the screen.
  const present = useCallback(() => {
    const el = wrap.current;
    const cur = v.current;
    if (!el || !cur) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void el.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onChange = () => {
      const on = !!wrap.current && document.fullscreenElement === wrap.current;
      setPresenting(on);
      const cur = v.current;
      if (!cur) return;
      const page = cur.viewer.currentPageNumber;
      cur.viewer.scrollMode = on ? 3 : 0;
      requestAnimationFrame(() => {
        cur.viewer.currentScaleValue = on ? 'page-fit' : 'auto';
        cur.viewer.currentPageNumber = page;
      });
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const cur = v.current;
      if (!cur || !doc) return false;
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        searchBox.current?.focus();
        searchBox.current?.select();
        return true;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (presenting && (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown')) {
        cur.viewer.nextPage();
        return true;
      }
      if (presenting && (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp')) {
        cur.viewer.previousPage();
        return true;
      }
      switch (e.key) {
        case '+':
        case '=':
          zoom(1.15);
          return true;
        case '-':
          zoom(1 / 1.15);
          return true;
        case '0':
          zoom('page-width');
          return true;
        case 'Home':
          goTo(1);
          return true;
        case 'End':
          goTo(doc.numPages);
          return true;
        case 'r':
        case 'R':
          rotate();
          return true;
        case 'p':
        case 'P':
          present();
          return true;
        default:
          return false;
      }
    },
    [doc, presenting, zoom, goTo, rotate, present],
  );
  useKeys(onKey);

  // Ctrl + wheel zooms the pages instead of the browser.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  if (error) return <ViewerProblem title="This PDF could not be opened">{error}</ViewerProblem>;

  const numPages = doc?.numPages ?? 0;
  return (
    <div ref={wrap} className={cn('flex h-full min-h-0 flex-col bg-background', presenting && 'bg-black')}>
      {!presenting ? (
        <Toolbar>
          <IconButton icon={GridViewIcon} label="Page thumbnails" pressed={sidebar === 'thumbs'} onClick={() => setSidebar((s) => (s === 'thumbs' ? null : 'thumbs'))} />
          <IconButton
            icon={BookOpen01Icon}
            label="Outline"
            pressed={sidebar === 'outline'}
            disabled={!outline?.length}
            onClick={() => setSidebar((s) => (s === 'outline' ? null : 'outline'))}
          />
          <ToolbarSep />
          <form
            className="flex items-center gap-1 text-xs text-muted-foreground"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(pageInput, 10);
              if (Number.isFinite(n)) goTo(n);
            }}
          >
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => setPageInput(String(page))}
              aria-label="Page number"
              inputMode="numeric"
              className="h-8 w-12 rounded-md border border-input bg-background px-1.5 text-center text-xs text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <span className="tabular-nums">of {numPages || '…'}</span>
          </form>
          <ToolbarSep />
          <IconButton icon={ZoomOutAreaIcon} label="Zoom out (−)" onClick={() => zoom(1 / 1.15)} />
          <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
          <IconButton icon={ZoomInAreaIcon} label="Zoom in (+)" onClick={() => zoom(1.15)} />
          <ChipButton onClick={() => zoom('page-width')} className="max-sm:hidden">
            Width
          </ChipButton>
          <ChipButton onClick={() => zoom('page-fit')} className="max-sm:hidden">
            Page
          </ChipButton>
          <IconButton icon={RotateClockwiseIcon} label="Rotate the view (R)" onClick={rotate} />
          <IconButton icon={Presentation01Icon} label="Presentation mode (P)" onClick={present} />
          {toolbarExtra}
          <span className="flex-1" />
          <form
            className="flex min-w-0 items-center gap-1 max-sm:basis-full"
            onSubmit={(e) => {
              e.preventDefault();
              runFind(true);
            }}
          >
            <div className="relative min-w-0 flex-1 sm:w-56">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchBox}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    runFind(true, true);
                  }
                }}
                placeholder="Search the text"
                aria-label="Search the text"
                className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            {query && found ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {found.total ? `${found.current} of ${found.total.toLocaleString()}` : 'No match'}
              </span>
            ) : null}
            <IconButton icon={ArrowUp01Icon} label="Previous match" disabled={!found?.total} onClick={() => runFind(true, true)} />
            <IconButton icon={ArrowDown01Icon} label="Next match" disabled={!found?.total} onClick={() => runFind(true)} />
          </form>
        </Toolbar>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        {sidebar && doc && !presenting ? (
          <aside
            data-viewer-panel
            aria-label={sidebar === 'thumbs' ? 'Thumbnails' : 'Outline'}
            className="flex w-44 shrink-0 flex-col border-r bg-card max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-[12px_0_32px_-16px_rgb(0_0_0/0.4)] lg:w-52"
          >
            <PanelTitle>{sidebar === 'thumbs' ? 'Pages' : 'Outline'}</PanelTitle>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {sidebar === 'thumbs' ? (
                <div className="grid gap-1">
                  {Array.from({ length: numPages }, (_, i) => (
                    <Thumb key={i} doc={doc} n={i + 1} active={page === i + 1} onPick={goTo} />
                  ))}
                </div>
              ) : (
                <OutlineTree items={outline ?? []} onGo={(dest) => void v.current?.links.goToDestination(dest as string)} />
              )}
            </div>
          </aside>
        ) : null}
        <div className="relative min-h-0 flex-1">
          <div
            ref={container}
            tabIndex={0}
            aria-label={label}
            className={cn(
              'absolute inset-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset',
              presenting ? 'bg-black' : 'bg-muted/60',
              '[&_.pdfViewer_.page]:shadow-[0_1px_3px_rgb(0_0_0/0.18),0_8px_24px_-12px_rgb(0_0_0/0.35)] [&_.pdfViewer_.page]:[border:none] [&_.pdfViewer_.page]:my-3',
            )}
          >
            <div ref={inner} className="pdfViewer" />
          </div>
          {!doc && !password ? <div className="absolute inset-0"><ViewerLoading label="Opening the PDF…" /></div> : null}
          {password ? (
            <div className="absolute inset-0 grid place-items-center bg-background/95 p-6">
              <form
                className="flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-card p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  password.submit(pw);
                  setPw('');
                }}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={SquareLock02Icon} strokeWidth={2} className="size-5 text-primary" />
                  <p className="text-sm font-semibold">This PDF is protected</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {password.retry ? 'That password is not right. Try again.' : 'Enter its password to open it. The password stays on this device.'}
                </p>
                <input
                  type="password"
                  autoFocus
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  aria-label="Password"
                  aria-invalid={password.retry || undefined}
                  className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive"
                />
                <Button type="submit" size="lg" disabled={!pw}>
                  Open
                </Button>
              </form>
            </div>
          ) : null}
          {presenting ? (
            <p className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 tabular-nums">
              {page} / {numPages} · Esc to exit
            </p>
          ) : null}
        </div>
      </div>
      {!presenting && footerExtra ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">{footerExtra}</footer>
      ) : null}
    </div>
  );
}
