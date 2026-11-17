'use client';

import { CheckmarkCircle02Icon, Download04Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useMemo, useState } from 'react';
import { SectionCard } from '@/components/kit/section-card';
import { Segmented } from '@/components/kit/segmented';
import { SwitchRow } from '@/components/pdf-stage';
import { EngineNote, PasswordInput, ToolFrame } from '@/components/pdf-tools';
import { Button } from '@/components/ui/button';
import { OptionField, perFile, useWorkbench } from '@/components/workbench';
import { GHOSTSCRIPT_DOWNLOAD_BYTES, ghostscriptEngine, type GsPdfSettings } from '@/engines/ghostscript';
import {
  COMPRESS_PRESETS,
  type CompressOptions,
  type CompressPreset,
  type CompressStats,
  MUPDF_DOWNLOAD_BYTES,
  mupdfEngine,
} from '@/engines/mupdf';
import { isAbortError } from '@/engines/worker-host';
import { baseName, formatBytes } from '@/lib/files';
import type { ToolProps } from '@/tools/types';

type Level = CompressPreset | 'custom';

type Report = {
  before: number;
  after: number;
  keptOriginal: boolean;
  engine: 'MuPDF' | 'Ghostscript' | null;
  stats: CompressStats | null;
  /** Ghostscript was asked for but not used, and why. */
  gsNote?: string;
};

type Options = {
  settings: CompressOptions;
  level: Level;
  /** Also try Ghostscript and keep whichever file is smaller. */
  maximum: boolean;
  password: string;
  onReport: (id: string, report: Report) => void;
};

const GS_SETTINGS: Record<CompressPreset, GsPdfSettings> = { light: 'printer', balanced: 'ebook', strong: 'screen' };

function gsSettingsFor(level: Level, dpi: number | null): GsPdfSettings {
  if (level !== 'custom') return GS_SETTINGS[level];
  if (dpi === null || dpi >= 220) return 'printer';
  return dpi >= 150 ? 'ebook' : 'screen';
}

const job = perFile<Options>(async (input, options, ctx) => {
  const { file } = input;
  const password = options.password || undefined;
  const share = options.maximum ? 0.6 : 1;
  const { blob, stats } = await mupdfEngine.compress(file, options.settings, {
    signal: ctx.signal,
    password,
    onProgress: (done, total, note) => ctx.onProgress((done / Math.max(1, total)) * share, note),
  });
  let best: Blob | null = blob;
  let engine: Report['engine'] = blob ? 'MuPDF' : null;
  let gsNote: string | undefined;

  if (options.maximum) {
    // Ghostscript would drop the encryption of a protected file, so it only runs on plain files.
    const info = await mupdfEngine.inspect(file, { signal: ctx.signal, password });
    if (info.encryption.encrypted) {
      gsNote = 'Ghostscript was skipped because this PDF is encrypted (it would remove the protection).';
    } else {
      ctx.onProgress(share, 'Trying Ghostscript');
      try {
        const gs = await ghostscriptEngine.compress(
          file,
          {
            settings: gsSettingsFor(options.level, options.settings.maxImageDpi),
            imageDpi: options.settings.recompressImages ? options.settings.maxImageDpi : null,
            grayscale: options.settings.grayscaleImages,
          },
          { signal: ctx.signal },
        );
        if (gs.size < (best?.size ?? file.size)) {
          best = gs;
          engine = 'Ghostscript';
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        gsNote = err instanceof Error ? err.message : 'Ghostscript could not rewrite this PDF.';
      }
    }
  }

  ctx.onProgress(1);
  const keptOriginal = !best || best.size >= file.size;
  options.onReport(input.id, {
    before: file.size,
    after: keptOriginal || !best ? file.size : best.size,
    keptOriginal,
    engine: keptOriginal ? null : engine,
    stats,
    gsNote,
  });
  if (keptOriginal || !best) return { name: `${baseName(file.name)}.pdf`, blob: file };
  return { name: `${baseName(file.name)}-compressed.pdf`, blob: best };
});

const DPI_CHOICES: { value: number; label: string }[] = [
  { value: 72, label: '72' },
  { value: 96, label: '96' },
  { value: 150, label: '150' },
  { value: 220, label: '220' },
  { value: 300, label: '300' },
  { value: 0, label: 'Keep' },
];

const LEVEL_HINT: Record<Level, string> = {
  light: 'Images above 220 dpi are downsampled; quality stays high.',
  balanced: 'Images to 150 dpi at good JPEG quality, metadata removed. Right for most files.',
  strong: 'Images to 96 dpi at lower quality: the smallest file, for reading on screen.',
  custom: 'Your own settings, below.',
};

export default function CompressPdf({ tool }: ToolProps) {
  const [level, setLevel] = useState<Level>('balanced');
  const [settings, setSettings] = useState<CompressOptions>({ ...COMPRESS_PRESETS.balanced });
  const [maximum, setMaximum] = useState(false);
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const onReport = useCallback((id: string, r: Report) => setReports((prev) => ({ ...prev, [id]: r })), []);

  const options = useMemo<Options>(
    () => ({ settings, level, maximum, password, onReport }),
    [settings, level, maximum, password, onReport],
  );
  const wb = useWorkbench({ job, options, accept: tool.accept });

  const chooseLevel = (next: Level) => {
    setLevel(next);
    if (next !== 'custom') setSettings({ ...COMPRESS_PRESETS[next] });
  };
  const edit = (patch: Partial<CompressOptions>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setLevel('custom');
  };

  const rows = wb.results.flatMap((result) => {
    const report = result.sourceId ? reports[result.sourceId] : undefined;
    return report ? [{ result, report }] : [];
  });
  const totalBefore = rows.reduce((s, x) => s + x.report.before, 0);
  const totalAfter = rows.reduce((s, x) => s + x.report.after, 0);

  return (
    <ToolFrame
      wb={wb}
      accept={tool.accept}
      runLabel="Compress"
      optionsPanel={
        <>
          <OptionField label="Compression" hint={LEVEL_HINT[level]}>
            <Segmented<Level>
              label="Compression"
              value={level}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'strong', label: 'Strong' },
                ...(level === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
              ]}
              onChange={chooseLevel}
            />
          </OptionField>

          <button
            type="button"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
            className="self-start text-xs font-medium text-primary hover:underline"
          >
            {advanced ? 'Hide advanced settings' : 'Advanced settings'}
          </button>

          {advanced ? (
            <div className="flex flex-col gap-4 rounded-lg border p-3">
              <SwitchRow
                id="cp-images"
                label="Optimise images"
                checked={settings.recompressImages}
                onChange={(recompressImages) => edit({ recompressImages })}
              />
              {settings.recompressImages ? (
                <>
                  <OptionField label="Maximum image resolution (dpi)" hint="Measured at the size each image is shown on the page.">
                    <Segmented
                      label="Maximum image resolution"
                      value={settings.maxImageDpi ?? 0}
                      options={DPI_CHOICES}
                      onChange={(v) => edit({ maxImageDpi: v === 0 ? null : v })}
                    />
                  </OptionField>
                  <OptionField label="JPEG quality" htmlFor="cp-quality">
                    <div className="flex items-center gap-3">
                      <input
                        id="cp-quality"
                        type="range"
                        min={20}
                        max={95}
                        step={1}
                        value={settings.imageQuality}
                        onChange={(e) => edit({ imageQuality: Number(e.target.value) })}
                        className="h-1.5 flex-1 cursor-pointer accent-primary"
                      />
                      <span className="w-8 text-right font-mono text-xs tabular-nums">{settings.imageQuality}</span>
                    </div>
                  </OptionField>
                  <SwitchRow
                    id="cp-gray"
                    label="Greyscale images"
                    checked={settings.grayscaleImages}
                    onChange={(grayscaleImages) => edit({ grayscaleImages })}
                  />
                </>
              ) : null}
              <SwitchRow
                id="cp-fonts"
                label="Subset fonts"
                hint="Keep only the characters the document uses."
                checked={settings.subsetFonts}
                onChange={(subsetFonts) => edit({ subsetFonts })}
              />
              <SwitchRow
                id="cp-meta"
                label="Remove metadata"
                hint="Title, author, XMP, thumbnails and editor data."
                checked={settings.stripMetadata}
                onChange={(stripMetadata) => edit({ stripMetadata })}
              />
              <SwitchRow
                id="cp-dedupe"
                label="Merge duplicate objects"
                hint="Slower; helps files that repeat the same image or font."
                checked={settings.garbage === 'deduplicate'}
                onChange={(on) => edit({ garbage: on ? 'deduplicate' : 'compact' })}
              />
              <SwitchRow
                id="cp-objstm"
                label="Compress structure"
                hint="Packs small objects into object streams (PDF 1.5)."
                checked={settings.objectStreams}
                onChange={(objectStreams) => edit({ objectStreams })}
              />
              <SwitchRow
                id="cp-clean"
                label="Clean page content"
                checked={settings.cleanContent}
                onChange={(cleanContent) => edit({ cleanContent })}
              />
            </div>
          ) : null}

          <SwitchRow
            id="cp-max"
            label="Maximum: also try Ghostscript"
            hint={`Adds a one-time ${formatBytes(GHOSTSCRIPT_DOWNLOAD_BYTES)} download and keeps the smaller result. Ghostscript rebuilds the whole file and can drop form fields and accessibility tags.`}
            checked={maximum}
            onChange={setMaximum}
          />

          <OptionField
            label="Password"
            htmlFor="cp-password"
            hint="Only for files that need a password to open. The compressed file keeps its protection."
          >
            <PasswordInput id="cp-password" value={password} onChange={setPassword} placeholder="Not protected" />
          </OptionField>

          <EngineNote bytes={MUPDF_DOWNLOAD_BYTES} />
        </>
      }
    >
      {rows.length > 0 ? (
        <SectionCard
          title="Results"
          description={
            totalAfter < totalBefore
              ? `${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} · ${Math.round((1 - totalAfter / totalBefore) * 100)}% smaller`
              : 'No file got smaller'
          }
          contentClassName="p-0"
        >
          <ul className="divide-y">
            {rows.map(({ result, report }) => {
              const saved = report.before > 0 ? 1 - report.after / report.before : 0;
              const details = [
                report.engine ? `Compressed with ${report.engine}` : null,
                report.stats && report.engine === 'MuPDF' && report.stats.imagesRecompressed > 0
                  ? `${report.stats.imagesRecompressed} of ${report.stats.imagesTotal} images re-encoded${
                      report.stats.imagesDownsampled ? `, ${report.stats.imagesDownsampled} downsampled` : ''
                    }`
                  : null,
              ].filter(Boolean);
              return (
                <li key={result.id} className="flex min-w-0 flex-col gap-2 px-5 py-3" data-compress-result>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={result.name}>
                        {result.name}
                      </p>
                      <p className="font-mono text-[0.7rem] text-muted-foreground" data-sizes>
                        {formatBytes(report.before)} → {formatBytes(report.after)}
                        {report.keptOriginal ? ' · unchanged' : ` · ${Math.round(saved * 100)}% smaller`}
                      </p>
                    </div>
                    <Button asChild size="sm">
                      <a href={result.url} download={result.name}>
                        <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                        Download
                      </a>
                    </Button>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, Math.round((report.after / Math.max(1, report.before)) * 100))}%` }}
                    />
                  </div>
                  {report.keptOriginal ? (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-kept-original>
                      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
                      Compressing would not make this PDF smaller, so the original is kept unchanged.
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0 text-success" />
                      {details.join(' · ')}
                    </p>
                  )}
                  {report.gsNote ? <p className="text-xs text-muted-foreground">{report.gsNote}</p> : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}
    </ToolFrame>
  );
}
