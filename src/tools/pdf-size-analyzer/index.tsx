'use client';

import { ArrowRight01Icon, Idea01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { StatTile } from '@/components/kit/stat-tile';
import { EngineNote, PasswordInput, ToolFrame } from '@/components/pdf-tools';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { MUPDF_DOWNLOAD_BYTES, mupdfEngine, type SizeCategory, type SizeReport } from '@/engines/mupdf';
import { formatBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import type { ToolProps } from '@/tools/types';

type Options = { password: string; onReport: (id: string, r: SizeReport) => void };

const job = perFile<Options>(async (input, o, ctx) => {
  const report = await mupdfEngine.analyzeSize(input.file, {
    signal: ctx.signal,
    password: o.password || undefined,
    onProgress: (done, total, note) => ctx.onProgress(done / Math.max(1, total), note),
  });
  o.onReport(input.id, report);
  return [];
});

// Categorical slots in fixed order (validated palette: light / dark steps).
const CATEGORY: Record<SizeCategory, { label: string; swatch: string }> = {
  images: { label: 'Images', swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  fonts: { label: 'Fonts', swatch: 'bg-[#eb6834] dark:bg-[#d95926]' },
  content: { label: 'Page content', swatch: 'bg-[#1baf7a] dark:bg-[#199e70]' },
  metadata: { label: 'Metadata & thumbnails', swatch: 'bg-[#eda100] dark:bg-[#c98500]' },
  forms: { label: 'Forms & annotations', swatch: 'bg-[#e87ba4] dark:bg-[#d55181]' },
  attachments: { label: 'Attachments', swatch: 'bg-[#008300] dark:bg-[#008300]' },
  structure: { label: 'Structure (objects, links, index)', swatch: 'bg-[#6250d6] dark:bg-[#9085e9]' },
  other: { label: 'Other', swatch: 'bg-[#e34948] dark:bg-[#e66767]' },
};
const ORDER = Object.keys(CATEGORY) as SizeCategory[];

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctLabel = (part: number, whole: number) => {
  const p = pct(part, whole);
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

function pageList(pages: number[]): string {
  if (pages.length === 0) return '—';
  if (pages.length > 6) return `${pages.length} pages`;
  return `p. ${pages.map((p) => p + 1).join(', ')}`;
}

type Suggestion = { text: string; tool?: { slug: string; label: string } };

function suggestions(r: SizeReport): Suggestion[] {
  const out: Suggestion[] = [];
  const compress = { slug: 'compress-pdf', label: 'Compress PDF' };
  const images = r.categories.images;
  if (r.highDpiImages > 0) {
    out.push({
      text: `${r.highDpiImages} ${r.highDpiImages === 1 ? 'image is' : 'images are'} stored above 300 dpi for the size shown on the page. Downsampling to 150 dpi usually cuts image weight by half or more with no visible loss on screen.`,
      tool: compress,
    });
  } else if (pct(images, r.fileBytes) > 50) {
    out.push({ text: `Images are ${pctLabel(images, r.fileBytes)} of the file. Re-encoding them at a lower JPEG quality will shrink it most.`, tool: compress });
  }
  if (r.fullFonts.length > 0) {
    const total = r.fullFonts.reduce((s, f) => s + f.bytes, 0);
    out.push({
      text: `${r.fullFonts.length} ${r.fullFonts.length === 1 ? 'font is' : 'fonts are'} embedded in full (${formatBytes(total)}: ${r.fullFonts
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ')}${r.fullFonts.length > 3 ? '…' : ''}). Subsetting keeps only the characters the document uses.`,
      tool: compress,
    });
  }
  if (pct(r.categories.metadata, r.fileBytes) > 5) {
    out.push({ text: `Metadata and page thumbnails take ${formatBytes(r.categories.metadata)}. Removing them is safe for most uses.`, tool: compress });
  }
  if (r.unusedBytes > Math.max(20_000, r.fileBytes * 0.03) || r.revisions > 1) {
    out.push({
      text: `${r.revisions > 1 ? `The file was saved ${r.revisions} times as incremental updates. ` : ''}${formatBytes(r.unusedBytes)} belong to objects nothing uses any more. Rewriting the file drops them.`,
      tool: compress,
    });
  }
  if (!r.hasObjectStreams && pct(r.categories.structure, r.fileBytes) > 15) {
    out.push({
      text: `The file structure itself is ${pctLabel(r.categories.structure, r.fileBytes)} of the size. Packing it into compressed object streams typically saves a good part of that.`,
      tool: compress,
    });
  }
  if (r.categories.attachments > 0) {
    out.push({ text: `Attached files add ${formatBytes(r.categories.attachments)}. They are not visible on the pages; remove them if the reader does not need them.` });
  }
  if (out.length === 0) out.push({ text: 'Nothing stands out: this PDF is already reasonably compact.' });
  return out;
}

function Report({ name, r }: { name: string; r: SizeReport }) {
  const used = ORDER.filter((c) => r.categories[c] > 0);
  const heaviest = [...r.pages].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
  const maxPage = heaviest[0]?.bytes ?? 1;
  const tips = suggestions(r);

  return (
    <div className="flex flex-col gap-4" data-report="size">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="File size" value={formatBytes(r.fileBytes)} note={name} />
        <StatTile label="Pages" value={String(r.pageCount)} note={`${formatBytes(r.fileBytes / Math.max(1, r.pageCount))} per page on average`} />
        <StatTile
          label="Largest part"
          value={CATEGORY[used.reduce((a, b) => (r.categories[b] > r.categories[a] ? b : a), used[0] ?? 'other')].label}
          note={pctLabel(Math.max(...used.map((c) => r.categories[c]), 0), r.fileBytes)}
        />
      </div>

      <SectionCard title="Where the bytes go" description="Stored (compressed) size of each kind of content.">
        <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="Size by category">
          {used.map((c) => (
            <div
              key={c}
              className={cn('h-full first:rounded-l-sm last:rounded-r-sm', CATEGORY[c].swatch)}
              style={{ width: `${pct(r.categories[c], r.fileBytes)}%`, minWidth: 2 }}
              title={`${CATEGORY[c].label}: ${formatBytes(r.categories[c])} (${pctLabel(r.categories[c], r.fileBytes)})`}
            />
          ))}
        </div>
        <table className="mt-4 w-full text-xs">
          <tbody>
            {used.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2.5 shrink-0 rounded-[3px]', CATEGORY[c].swatch)} aria-hidden />
                    {CATEGORY[c].label}
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">{formatBytes(r.categories[c])}</td>
                <td className="w-14 py-1.5 text-right font-mono text-muted-foreground tabular-nums">
                  {pctLabel(r.categories[c], r.fileBytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Suggestions">
        <ul className="flex flex-col gap-3">
          {tips.map((t) => (
            <li key={t.text} className="flex items-start gap-2 text-xs/relaxed" data-suggestion="">
              <HugeiconsIcon icon={Idea01Icon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                {t.text}
                {t.tool ? (
                  <>
                    {' '}
                    <Link href={`/tools/${t.tool.slug}`} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
                      {t.tool.label}
                      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SectionCard title="Largest objects" contentClassName="p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-5 py-2 font-medium">Object</th>
                <th className="py-2 font-medium">Used on</th>
                <th className="px-5 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {r.largest.slice(0, 12).map((o) => (
                <tr key={o.num} className="border-b last:border-0">
                  <td className="max-w-0 px-5 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('size-2.5 shrink-0 rounded-[3px]', CATEGORY[o.category].swatch)} aria-hidden />
                      <span className="truncate" title={o.label}>
                        {o.label}
                        {o.dpi ? <span className="text-muted-foreground"> · {o.dpi} dpi</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">{pageList(o.pages)}</td>
                  <td className="px-5 py-1.5 text-right font-mono tabular-nums">{formatBytes(o.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title="Heaviest pages" description="Shared images and fonts are split between the pages that use them.">
          <ul className="flex flex-col gap-2">
            {heaviest.map((p) => (
              <li key={p.index} className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-xs" title={`Images ${formatBytes(p.images)} · fonts ${formatBytes(p.fonts)} · content ${formatBytes(p.content)}`}>
                <span className="font-mono text-muted-foreground tabular-nums">p. {p.index + 1}</span>
                <span className="flex h-3 gap-0.5" aria-hidden>
                  {(['images', 'fonts', 'content'] as const).map((k) =>
                    p[k] > 0 ? (
                      <span
                        key={k}
                        className={cn('h-full first:rounded-l-sm last:rounded-r-sm', CATEGORY[k].swatch)}
                        style={{ width: `${(p[k] / maxPage) * 100}%`, minWidth: 2 }}
                      />
                    ) : null,
                  )}
                </span>
                <span className="text-right font-mono tabular-nums">{formatBytes(p.bytes)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
            {(['images', 'fonts', 'content'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-[2px]', CATEGORY[k].swatch)} aria-hidden />
                {CATEGORY[k].label}
              </span>
            ))}
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

export default function PdfSizeAnalyzer({ tool }: ToolProps) {
  const [password, setPassword] = useState('');
  const [reports, setReports] = useState<Record<string, SizeReport>>({});
  const onReport = useCallback((id: string, r: SizeReport) => setReports((p) => ({ ...p, [id]: r })), []);
  const options = useMemo<Options>(() => ({ password, onReport }), [password, onReport]);
  const wb = useWorkbench({ job, options, accept: tool.accept, multiple: false });
  const input = wb.files[0];
  const report = input && wb.statuses[input.id]?.state === 'done' ? reports[input.id] : undefined;

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      multiple={false}
      runLabel="Analyze"
      optionsPanel={
        <>
          <p className="text-xs/relaxed text-muted-foreground">
            Breaks the file down into images, fonts, page content and the rest, finds the largest objects and pages, and
            suggests what would shrink it.
          </p>
          <OptionField label="Password" htmlFor="sa-password" hint="Only for files that need a password to open.">
            <PasswordInput id="sa-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>
          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      {report && input ? <Report name={input.file.name} r={report} /> : null}
    </ToolFrame>
  );
}
