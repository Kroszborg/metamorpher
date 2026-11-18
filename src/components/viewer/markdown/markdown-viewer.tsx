'use client';

import { Download04Icon, LeftToRightListBulletIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Segmented } from '@/components/kit/segmented';
import { baseName, downloadBlob } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, IconButton, PanelTitle, Toolbar, ViewerLoading, ViewerProblem } from '../bits';
import { CodeView } from '../code/code-view';
import { type Shortcut, useShortcuts, type ViewerProps } from '../context';
import { encodingFromSniff, readPart } from '../text/parts';

const SHORTCUTS: Shortcut[] = [{ keys: 'Ctrl + F', label: 'Search (in the source view)' }];

type Heading = { id: string; level: number; text: string };
type Rendered = { html: string; headings: Heading[]; blocked: number; front: [string, string][] };

const PROSE = [
  'max-w-3xl text-[15px]/7 text-foreground',
  '[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1:first-child]:mt-0',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_h6]:text-muted-foreground',
  '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li.task]:list-none [&_li.task]:-ml-5',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_hr]:my-8 [&_hr]:border-border',
  '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-card [&_pre]:p-4 [&_pre]:text-[13px]/6 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:px-3 [&_td]:py-1.5',
  '[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-md [&_.mm-blocked]:my-2 [&_.mm-blocked]:inline-flex [&_.mm-blocked]:rounded-md [&_.mm-blocked]:border [&_.mm-blocked]:border-dashed [&_.mm-blocked]:px-2 [&_.mm-blocked]:py-1 [&_.mm-blocked]:text-xs [&_.mm-blocked]:text-muted-foreground',
  '[&_h1]:scroll-mt-4 [&_h2]:scroll-mt-4 [&_h3]:scroll-mt-4 [&_h4]:scroll-mt-4',
].join(' ');

/** Markdown → sanitised HTML. Remote images, styles, frames and scripts never load: nothing leaves the device. */
async function render(source: string): Promise<Rendered> {
  const [{ markdownToHtml }, DOMPurify] = await Promise.all([
    import('@/components/doc-tools/markdown'),
    import('dompurify').then((m) => m.default),
  ]);
  const front: [string, string][] = [];
  const fm = /^(?:﻿)?(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1/.exec(source);
  if (fm) {
    for (const line of fm[2]!.split(/\r?\n/)) {
      const m = /^([\w-]+)\s*[:=]\s*(.*)$/.exec(line);
      if (m) front.push([m[1]!, m[2]!.replace(/^["']|["']$/g, '')]);
    }
  }
  const { html } = await markdownToHtml(source);
  let blocked = 0;
  const purify = DOMPurify(window);
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!/^data:image\//i.test(src)) {
        blocked++;
        const span = node.ownerDocument.createElement('span');
        span.className = 'mm-blocked';
        span.textContent = `Image not loaded (${node.getAttribute('alt') || src.split('/').pop() || 'image'}): only images inside the file are shown.`;
        node.replaceWith(span);
      }
      node.removeAttribute('srcset');
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!href.startsWith('#')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
  const clean = purify.sanitize(html, {
    FORBID_TAGS: ['style', 'link', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'source', 'picture', 'track', 'form', 'input', 'button', 'base', 'meta', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset', 'ping', 'background', 'poster', 'formaction'],
  });
  const headings: Heading[] = [];
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
  doc.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if (h.id) headings.push({ id: h.id, level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' });
  });
  return { html: clean, headings, blocked, front };
}

type Mode = 'preview' | 'source' | 'split';

export default function MarkdownViewer({ file, sniff }: ViewerProps) {
  const [source, setSource] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('preview');
  const [outline, setOutline] = useState(true);
  // On narrow screens the outline covers the page: start with it closed.
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) queueMicrotask(() => setOutline(false));
  }, []);
  const [active, setActive] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useShortcuts(SHORTCUTS);

  useEffect(() => {
    let live = true;
    readPart(file, 0, encodingFromSniff(sniff.encoding))
      .then(async (p) => {
        if (!live) return;
        setSource(p.text);
        const r = await render(p.text);
        if (live) setRendered(r);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'The file could not be read.'));
    return () => {
      live = false;
    };
  }, [file, sniff.encoding]);

  // The heading in view, for the outline.
  useEffect(() => {
    const root = scroller.current;
    const el = body.current;
    if (!root || !el || !rendered?.headings.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    );
    el.querySelectorAll('h1[id], h2[id], h3[id], h4[id]').forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [rendered, mode]);

  const words = useMemo(() => (source ? source.split(/\s+/).filter(Boolean).length : 0), [source]);

  if (error) return <ViewerProblem title="This file could not be read">{error}</ViewerProblem>;
  if (source === null || !rendered) return <ViewerLoading label="Rendering…" />;

  const preview = (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-background">
      {rendered.front.length ? (
        <dl className="mx-5 mt-6 grid max-w-3xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-xs sm:mx-8 lg:mx-auto lg:w-[calc(100%-4rem)]">
          {rendered.front.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <article
        ref={body}
        className={cn(PROSE, 'mx-auto px-5 py-6 sm:px-8 sm:py-8')}
        // Sanitised with DOMPurify above; remote resources are removed.
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          label="View"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'preview', label: 'Preview' },
            { value: 'source', label: 'Source' },
            { value: 'split', label: 'Side by side' },
          ]}
        />
        {mode !== 'source' && rendered.headings.length ? (
          <IconButton icon={LeftToRightListBulletIcon} label="Outline" pressed={outline} onClick={() => setOutline((v) => !v)}>
            <span className="max-sm:hidden">Outline</span>
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <ChipButton
          onClick={() =>
            downloadBlob(
              new Blob(
                [
                  `<!doctype html><meta charset="utf-8"><title>${baseName(file.name)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}pre{overflow:auto;background:#f4f4f4;padding:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3rem .6rem}</style>${rendered.html}`,
                ],
                { type: 'text/html;charset=utf-8' },
              ),
              `${baseName(file.name)}.html`,
            )
          }
        >
          <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
          <span className="max-sm:hidden">HTML</span>
        </ChipButton>
      </Toolbar>
      <div className="relative flex min-h-0 flex-1">
        {mode !== 'source' && outline && rendered.headings.length ? (
          <nav
            aria-label="Outline"
            className="flex w-60 shrink-0 flex-col border-r bg-card max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:shadow-[12px_0_32px_-16px_rgb(0_0_0/0.4)]"
          >
            <PanelTitle>Outline</PanelTitle>
            <ul className="min-h-0 flex-1 overflow-auto py-1.5">
              {rendered.headings.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      body.current?.querySelector(`#${CSS.escape(h.id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                      if (window.matchMedia('(max-width: 1023px)').matches) setOutline(false);
                    }}
                    className={cn(
                      'block w-full truncate py-1 pr-3 text-left text-xs outline-none hover:text-foreground focus-visible:bg-muted',
                      active === h.id ? 'font-medium text-primary' : 'text-muted-foreground',
                    )}
                    style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {mode === 'source' ? (
          <CodeView text={source} language="plain" wrap label={`Source of ${file.name}`} />
        ) : mode === 'split' ? (
          <div className="flex min-h-0 flex-1 max-md:flex-col">
            <div className="min-h-0 flex-1 border-r max-md:border-r-0 max-md:border-b">
              <CodeView text={source} language="plain" wrap label={`Source of ${file.name}`} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{preview}</div>
          </div>
        ) : (
          preview
        )}
      </div>
      <footer className="flex flex-wrap gap-x-3 border-t bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {words.toLocaleString()} words · about {Math.max(1, Math.round(words / 230))} min read · {rendered.headings.length} headings
        </span>
        {rendered.blocked ? (
          <span>{rendered.blocked} remote image{rendered.blocked === 1 ? '' : 's'} not loaded, so nothing leaves this device</span>
        ) : null}
      </footer>
    </div>
  );
}
