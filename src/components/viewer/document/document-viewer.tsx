'use client';

import { TextFontIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { ChipButton, ToolbarSep, ViewerLoading, ViewerProblem } from '../bits';
import { useViewer, type ViewerProps } from '../context';
import { PdfView } from '../pdf/pdf-view';

type Kind = 'docx' | 'pptx' | 'book';
type Theme = 'light' | 'sepia' | 'dark';

const MAGIC: Record<string, string> = {
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook',
  mobi: 'application/x-mobipocket-ebook',
  xhtml: 'application/xhtml+xml',
};
const SIZES = [
  { id: 's', label: 'Small', pt: 10 },
  { id: 'm', label: 'Medium', pt: 12 },
  { id: 'l', label: 'Large', pt: 14.5 },
  { id: 'xl', label: 'Extra large', pt: 18 },
] as const;
type SizeId = (typeof SIZES)[number]['id'];
const THEMES: Record<Theme, { background: string; foreground: string } | null> = {
  light: null,
  sepia: { background: '#f4ecd8', foreground: '#433422' },
  dark: { background: '#16181a', foreground: '#d6d6d0' },
};

function kindOf(ext: string): Kind | null {
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx') return 'docx';
  if (ext === 'pptx' || ext === 'ppsx' || ext === 'potx') return 'pptx';
  if (ext in MAGIC) return 'book';
  return null;
}

/**
 * Word, PowerPoint and e-books, laid out as pages by the typeset engine
 * (MuPDF, in a worker) and shown in the PDF reader, so they get the same
 * search, thumbnails and outline. E-books get a reading size and a theme.
 */
export default function DocumentViewer({ file, sniff }: ViewerProps) {
  const kind = kindOf(sniff.ext);
  const { viewAs } = useViewer();
  const [size, setSize] = useState<SizeId>('m');
  const [theme, setTheme] = useState<Theme>('light');
  const [state, setState] = useState<{ key: string; pdf: Blob | null; error: string | null; notes: string[] } | null>(null);
  const [progress, setProgress] = useState<{ key: string; f: number; note?: string } | null>(null);
  const key = `${kind}:${kind === 'book' ? size : ''}`;

  useEffect(() => {
    if (!kind) return;
    const ctrl = new AbortController();
    const onProgress = (done: number, total: number, note?: string) =>
      setProgress({ key, f: total > 0 ? done / total : done, note });
    (async () => {
      const { typesetEngine, pageGeometry, defaultPageSize } = await import('@/engines/typeset');
      const notes: string[] = [];
      if (kind === 'docx') {
        const { prepareDocx } = await import('@/components/doc-tools/prepare');
        const p = await prepareDocx(file, { ownPage: true });
        const r = await typesetEngine.render(
          {
            blocks: p.blocks,
            css: p.css,
            page: p.page ?? pageGeometry(defaultPageSize(), 'portrait', 'normal'),
            fontSize: p.fontSize,
            tableFontSize: p.tableFontSize,
            outline: true,
            pageNumbers: false,
            title: p.title,
            lang: p.lang,
            header: p.header,
            footer: p.footer,
            footnotes: p.footnotes,
          },
          { signal: ctrl.signal, onProgress },
        );
        notes.push('Laid out from the document; line and page breaks can differ slightly from Word.');
        return { pdf: r.blob, notes };
      }
      if (kind === 'pptx') {
        const { readPptx } = await import('@/components/doc-tools/pptx');
        const { request } = readPptx(await file.arrayBuffer(), { includeHidden: false });
        const r = await typesetEngine.slides({ ...request, outline: true }, { signal: ctrl.signal, onProgress });
        return { pdf: r.blob, notes };
      }
      const pt = SIZES.find((s) => s.id === size)!.pt;
      const r = await typesetEngine.reflow(
        file,
        {
          page: { width: 420, height: 620, margin: { top: 40, right: 36, bottom: 40, left: 36 } },
          fontSize: pt,
          outline: true,
          pageNumbers: false,
          magic: MAGIC[sniff.ext] ?? 'application/epub+zip',
          css: 'body{line-height:1.5}',
        },
        { signal: ctrl.signal, onProgress },
      );
      return { pdf: r.blob, notes };
    })().then(
      ({ pdf, notes }) => setState({ key, pdf, error: null, notes }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ key, pdf: null, error: msg, notes: [] });
      },
    );
    return () => ctrl.abort();
  }, [file, kind, key, size, sniff.ext]);

  if (!kind) {
    return (
      <ViewerProblem
        title={`${sniff.format} files cannot be shown here yet`}
        actions={
          <Button variant="outline" size="lg" onClick={() => viewAs('archive')}>
            Show what is inside
          </Button>
        }
      >
        Word (.docx), PowerPoint (.pptx) and e-books (EPUB, FB2, MOBI) open here. OpenDocument files are ZIP archives; you can look at their parts.
      </ViewerProblem>
    );
  }

  const current = state?.key === key ? state : null;
  if (current?.error) {
    return (
      <ViewerProblem title="This document could not be laid out">
        {current.error} It may be damaged, password-protected, or saved in an older format.
      </ViewerProblem>
    );
  }
  if (!current?.pdf) {
    const p = progress?.key === key ? progress : null;
    return (
      <ViewerLoading
        label={`${p?.note ?? (kind === 'book' ? 'Laying out the book' : kind === 'pptx' ? 'Drawing the slides' : 'Laying out the pages')}… The page engine (about ${formatBytes(10_550_000)}) loads once.`}
        progress={p?.f}
      />
    );
  }

  return (
    <PdfView
      key={`${key}:${theme}`}
      file={current.pdf}
      label={`Pages of ${file.name}`}
      defaultSidebar={kind === 'book' ? 'outline' : 'thumbs'}
      pageColors={kind === 'book' ? THEMES[theme] : null}
      toolbarExtra={
        kind === 'book' ? (
          <>
            <ToolbarSep />
            <label className="inline-flex h-8 items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon icon={TextFontIcon} strokeWidth={2} className="size-4" />
              <span className="sr-only">Text size</span>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as SizeId)}
                aria-label="Text size"
                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
              >
                {SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {(['light', 'sepia', 'dark'] as Theme[]).map((t) => (
              <ChipButton key={t} pressed={theme === t} onClick={() => setTheme(t)} aria-label={`${t} theme`} className="capitalize">
                <span
                  aria-hidden
                  className={cn('size-3 rounded-full border', t === 'light' ? 'bg-white' : t === 'sepia' ? 'bg-[#f4ecd8]' : 'bg-[#16181a]')}
                />
                <span className="max-md:hidden">{t}</span>
              </ChipButton>
            ))}
          </>
        ) : null
      }
      footerExtra={
        <>
          <span>{sniff.format}</span>
          {current.notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </>
      }
    />
  );
}
